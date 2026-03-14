use crate::application::calendar_window::parse_datetime_input;
use crate::application::calendar_setup::{BlocksCalendarInitializer, EnsureBlocksCalendarResult};
use crate::application::calendar_sync::CalendarSyncService;
use crate::application::oauth::{EnsureTokenResult, OAuthConfig, OAuthManager};
use crate::application::time_slots::{
    intervals_overlap, Interval,
};
use crate::domain::models::{PomodoroLog, PomodoroPhase, TaskStatus};
use crate::infrastructure::credential_store::WindowsCredentialManagerStore;
use crate::infrastructure::error::InfraError;
use crate::infrastructure::event_mapper::{encode_block_event, GoogleCalendarEvent};
use crate::infrastructure::google_calendar_client::ReqwestGoogleCalendarClient;
use crate::infrastructure::oauth_client::ReqwestOAuthClient;
use crate::infrastructure::sync_state_repository::SqliteSyncStateRepository;
use crate::infrastructure::calendar_cache::InMemoryCalendarCacheRepository;
use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration as StdDuration, Instant};
use tokio::task::JoinSet;
use url::Url;
pub(crate) use super::state::{
    block_runtime_snapshot, lock_runtime, persist_generated_block, persist_generated_blocks,
    studio_runtime_snapshot, AppState, RuntimeState, StoredBlock,
};
#[cfg(test)]
pub(crate) use super::state::{
    assigned_task_for_block_for_tests, seed_synced_events_for_tests,
};
#[cfg(test)]
use crate::application::policy_service::load_runtime_policy;
#[cfg(test)]
use crate::application::pomodoro_session_plan;
#[cfg(test)]
use crate::application::configured_recipes;
#[cfg(test)]
use crate::domain::models::Block;
#[cfg(test)]
use std::path::PathBuf;

const DEFAULT_REDIRECT_URI: &str = "http://127.0.0.1:8080/oauth2/callback";
const DEFAULT_SCOPE: &str = "https://www.googleapis.com/auth/calendar";
pub(crate) const DEFAULT_ACCOUNT_ID: &str = "default";
const BLOCK_CREATION_CONCURRENCY: usize = 4;
#[cfg(test)]
const BLOCK_GENERATION_TARGET_MS: u128 = 30_000;
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub(crate) fn next_id(prefix: &str) -> String {
    let sequence = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{}-{sequence}", Utc::now().timestamp_micros())
}

pub(crate) fn normalize_account_id(raw: Option<String>) -> String {
    raw.as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| DEFAULT_ACCOUNT_ID.to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthenticateGoogleResponse {
    pub account_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorization_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CarryOverTaskResponse {
    pub task_id: String,
    pub from_block_id: String,
    pub to_block_id: String,
    pub status: String,
}

pub async fn authenticate_google_impl(
    state: &AppState,
    account_id: Option<String>,
    authorization_code: Option<String>,
) -> Result<AuthenticateGoogleResponse, InfraError> {
    let account_id = normalize_account_id(account_id);
    let oauth_config = load_oauth_config_from_env()?;
    let manager = oauth_manager(oauth_config, &account_id);

    if let Some(raw_code) = authorization_code {
        let code = raw_code.trim();
        if code.is_empty() {
            return Err(InfraError::InvalidConfig(
                "authorization_code must not be empty".to_string(),
            ));
        }
        let token = manager.authenticate_with_code(code).await?;
        state.log_info(
            "authenticate_google",
            &format!(
                "exchanged authorization code and stored oauth token for account_id={account_id}"
            ),
        );
        return Ok(AuthenticateGoogleResponse {
            account_id: account_id.clone(),
            status: "authenticated".to_string(),
            authorization_url: None,
            expires_at: Some(token.expires_at.to_rfc3339()),
        });
    }

    match manager.ensure_access_token().await? {
        EnsureTokenResult::Existing(token) => Ok(AuthenticateGoogleResponse {
            account_id: account_id.clone(),
            status: "existing".to_string(),
            authorization_url: None,
            expires_at: Some(token.expires_at.to_rfc3339()),
        }),
        EnsureTokenResult::Refreshed(token) => Ok(AuthenticateGoogleResponse {
            account_id: account_id.clone(),
            status: "refreshed".to_string(),
            authorization_url: None,
            expires_at: Some(token.expires_at.to_rfc3339()),
        }),
        EnsureTokenResult::ReauthenticationRequired => {
            let auth_state = next_id("oauth-state");
            let authorization_url = manager.build_authorization_url(&auth_state)?;
            Ok(AuthenticateGoogleResponse {
                account_id,
                status: "reauthentication_required".to_string(),
                authorization_url: Some(authorization_url),
                expires_at: None,
            })
        }
    }
}

pub async fn authenticate_google_sso_impl(
    state: &AppState,
    account_id: Option<String>,
    force_reauth: bool,
) -> Result<AuthenticateGoogleResponse, InfraError> {
    let account_id = normalize_account_id(account_id);
    let oauth_config = load_oauth_config_from_env()?;
    let manager = oauth_manager(oauth_config.clone(), &account_id);

    if !force_reauth {
        match manager.ensure_access_token().await? {
            EnsureTokenResult::Existing(token) => {
                return Ok(AuthenticateGoogleResponse {
                    account_id: account_id.clone(),
                    status: "existing".to_string(),
                    authorization_url: None,
                    expires_at: Some(token.expires_at.to_rfc3339()),
                });
            }
            EnsureTokenResult::Refreshed(token) => {
                return Ok(AuthenticateGoogleResponse {
                    account_id: account_id.clone(),
                    status: "refreshed".to_string(),
                    authorization_url: None,
                    expires_at: Some(token.expires_at.to_rfc3339()),
                });
            }
            EnsureTokenResult::ReauthenticationRequired => {}
        }
    }

    let auth_state = next_id("oauth-state");
    let authorization_url = manager.build_authorization_url(&auth_state)?;
    let callback_task = tokio::task::spawn_blocking(wait_for_loopback_callback(
        oauth_config.redirect_uri.clone(),
        auth_state.clone(),
        StdDuration::from_secs(180),
    ));
    if let Err(error) = open_system_browser(&authorization_url) {
        callback_task.abort();
        return Err(error);
    }
    let authorization_code = callback_task
        .await
        .map_err(|error| InfraError::OAuth(format!("oauth callback task failed: {error}")))??;

    let token = manager.authenticate_with_code(&authorization_code).await?;
    state.log_info(
        "authenticate_google_sso",
        &format!("completed browser sign-in and stored oauth token for account_id={account_id}"),
    );
    Ok(AuthenticateGoogleResponse {
        account_id,
        status: "authenticated".to_string(),
        authorization_url: None,
        expires_at: Some(token.expires_at.to_rfc3339()),
    })
}

#[derive(Debug, Clone)]
struct LoopbackRedirect {
    host: String,
    port: u16,
    path: String,
}

fn parse_loopback_redirect(redirect_uri: &str) -> Result<LoopbackRedirect, InfraError> {
    let parsed =
        Url::parse(redirect_uri).map_err(|error| InfraError::InvalidConfig(format!("invalid redirect URI: {error}")))?;
    if parsed.scheme() != "http" {
        return Err(InfraError::InvalidConfig(
            "redirect URI must use http for loopback callback".to_string(),
        ));
    }

    let host = parsed.host_str().ok_or_else(|| {
        InfraError::InvalidConfig("redirect URI host must be localhost or 127.0.0.1".to_string())
    })?;
    if host != "localhost" && host != "127.0.0.1" {
        return Err(InfraError::InvalidConfig(
            "redirect URI host must be localhost or 127.0.0.1".to_string(),
        ));
    }

    let Some(port) = parsed.port() else {
        return Err(InfraError::InvalidConfig(
            "redirect URI must include an explicit loopback port".to_string(),
        ));
    };
    let path = if parsed.path().is_empty() {
        "/".to_string()
    } else {
        parsed.path().to_string()
    };

    Ok(LoopbackRedirect {
        host: host.to_string(),
        port,
        path,
    })
}

fn wait_for_loopback_callback(
    redirect_uri: String,
    expected_state: String,
    timeout: StdDuration,
) -> impl FnOnce() -> Result<String, InfraError> + Send + 'static {
    let redirect = parse_loopback_redirect(&redirect_uri);
    move || {
        let redirect = redirect?;
        wait_for_loopback_callback_blocking(&redirect, &expected_state, timeout)
    }
}

fn wait_for_loopback_callback_blocking(
    redirect: &LoopbackRedirect,
    expected_state: &str,
    timeout: StdDuration,
) -> Result<String, InfraError> {
    let bind_host = if redirect.host == "localhost" {
        "127.0.0.1"
    } else {
        redirect.host.as_str()
    };
    let listener = TcpListener::bind((bind_host, redirect.port)).map_err(|error| {
        InfraError::OAuth(format!(
            "failed to bind oauth callback listener at {}:{}: {error}",
            bind_host, redirect.port
        ))
    })?;
    listener
        .set_nonblocking(true)
        .map_err(|error| InfraError::OAuth(format!("failed to configure callback listener: {error}")))?;
    let deadline = Instant::now() + timeout;

    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(result) = parse_callback_request(stream, redirect, expected_state)? {
                    return result;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err(InfraError::OAuth(
                        "timed out waiting for browser sign-in callback".to_string(),
                    ));
                }
                std::thread::sleep(StdDuration::from_millis(100));
            }
            Err(error) => {
                return Err(InfraError::OAuth(format!(
                    "failed to accept oauth callback connection: {error}"
                )));
            }
        }
    }
}

fn parse_callback_request(
    mut stream: std::net::TcpStream,
    redirect: &LoopbackRedirect,
    expected_state: &str,
) -> Result<Option<Result<String, InfraError>>, InfraError> {
    let mut request_line = String::new();
    {
        let mut reader = BufReader::new(&mut stream);
        reader
            .read_line(&mut request_line)
            .map_err(|error| InfraError::OAuth(format!("failed reading callback request: {error}")))?;
    }

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    if method != "GET" || target.is_empty() {
        write_callback_response(
            &mut stream,
            400,
            "Invalid callback request. You can close this tab.",
        );
        return Ok(Some(Err(InfraError::OAuth(
            "received invalid callback request".to_string(),
        ))));
    }

    let callback_url = Url::parse(&format!("http://localhost{target}"))
        .map_err(|error| InfraError::OAuth(format!("invalid callback URL: {error}")))?;
    if callback_url.path() != redirect.path {
        write_callback_response(&mut stream, 404, "Not found.");
        return Ok(None);
    }

    let mut code = None::<String>;
    let mut state = None::<String>;
    let mut oauth_error = None::<String>;
    let mut oauth_error_description = None::<String>;
    for (key, value) in callback_url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "error" => oauth_error = Some(value.into_owned()),
            "error_description" => oauth_error_description = Some(value.into_owned()),
            _ => {}
        }
    }

    if let Some(error_code) = oauth_error {
        let message = oauth_error_description
            .map(|detail| format!("{error_code}: {detail}"))
            .unwrap_or(error_code);
        write_callback_response(
            &mut stream,
            400,
            "Google sign-in failed. Return to PomoBlock and retry.",
        );
        return Ok(Some(Err(InfraError::OAuth(format!(
            "oauth callback error: {message}"
        )))));
    }

    match state {
        Some(returned_state) if returned_state == expected_state => {}
        Some(_) => {
            write_callback_response(
                &mut stream,
                400,
                "Invalid sign-in state. Return to PomoBlock and retry.",
            );
            return Ok(Some(Err(InfraError::OAuth(
                "oauth callback state mismatch".to_string(),
            ))));
        }
        None => {
            write_callback_response(
                &mut stream,
                400,
                "Missing sign-in state. Return to PomoBlock and retry.",
            );
            return Ok(Some(Err(InfraError::OAuth(
                "oauth callback missing state".to_string(),
            ))));
        }
    }

    let Some(authorization_code) = code else {
        write_callback_response(
            &mut stream,
            400,
            "Missing authorization code. Return to PomoBlock and retry.",
        );
        return Ok(Some(Err(InfraError::OAuth(
            "oauth callback missing authorization code".to_string(),
        ))));
    };

    write_callback_response(
        &mut stream,
        200,
        "Sign-in complete. You can close this tab and return to PomoBlock.",
    );
    Ok(Some(Ok(authorization_code)))
}

fn write_callback_response(stream: &mut std::net::TcpStream, status: u16, body: &str) {
    let status_text = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "OK",
    };
    let payload = format!(
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(payload.as_bytes());
    let _ = stream.flush();
}

#[cfg(target_os = "windows")]
fn open_system_browser(url: &str) -> Result<(), InfraError> {
    let primary = Command::new("rundll32")
        .arg("url.dll,FileProtocolHandler")
        .arg(url)
        .status();
    match primary {
        Ok(status) if status.success() => Ok(()),
        Ok(_) | Err(_) => {
            let fallback = Command::new("cmd")
                .arg("/C")
                .arg("start")
                .arg("")
                .arg(url)
                .status()
                .map_err(|error| InfraError::OAuth(format!("failed to launch system browser: {error}")))?;
            if fallback.success() {
                Ok(())
            } else {
                Err(InfraError::OAuth(format!(
                    "system browser launch exited with status: {fallback}"
                )))
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn open_system_browser(url: &str) -> Result<(), InfraError> {
    let status = Command::new("open")
        .arg(url)
        .status()
        .map_err(|error| InfraError::OAuth(format!("failed to launch system browser: {error}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(InfraError::OAuth(format!(
            "system browser launch exited with status: {status}"
        )))
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_system_browser(url: &str) -> Result<(), InfraError> {
    let status = Command::new("xdg-open")
        .arg(url)
        .status()
        .map_err(|error| InfraError::OAuth(format!("failed to launch system browser: {error}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(InfraError::OAuth(format!(
            "system browser launch exited with status: {status}"
        )))
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
fn open_system_browser(_url: &str) -> Result<(), InfraError> {
    Err(InfraError::OAuth(
        "automatic browser launch is not supported on this platform".to_string(),
    ))
}

fn oauth_manager(
    config: OAuthConfig,
    account_id: &str,
) -> OAuthManager<WindowsCredentialManagerStore, ReqwestOAuthClient> {
    let credential_store = Arc::new(WindowsCredentialManagerStore::new(
        "pomblock.oauth.google",
        account_id,
    ));
    let oauth_client = Arc::new(ReqwestOAuthClient::new());
    OAuthManager::new(config, credential_store, oauth_client)
}

pub(crate) async fn required_access_token(account_id: Option<String>) -> Result<String, InfraError> {
    let account_id = normalize_account_id(account_id);
    let oauth_config = load_oauth_config_from_env()?;
    let manager = oauth_manager(oauth_config, &account_id);
    match manager.ensure_access_token().await? {
        EnsureTokenResult::Existing(token) | EnsureTokenResult::Refreshed(token) => {
            Ok(token.access_token)
        }
        EnsureTokenResult::ReauthenticationRequired => Err(InfraError::OAuth(
            format!(
                "google authentication required for account_id={}; call authenticate_google with authorization_code",
                account_id
            ),
        )),
    }
}

pub(crate) async fn try_access_token(account_id: Option<String>) -> Result<Option<String>, InfraError> {
    let account_id = normalize_account_id(account_id);
    let oauth_config = match load_oauth_config_from_env() {
        Ok(config) => config,
        Err(InfraError::InvalidConfig(_)) => return Ok(None),
        Err(error) => return Err(error),
    };

    let manager = oauth_manager(oauth_config, &account_id);
    match manager.ensure_access_token().await? {
        EnsureTokenResult::Existing(token) | EnsureTokenResult::Refreshed(token) => {
            Ok(Some(token.access_token))
        }
        EnsureTokenResult::ReauthenticationRequired => Ok(None),
    }
}

pub(crate) async fn ensure_blocks_calendar_id(
    config_dir: &Path,
    access_token: &str,
    calendar_client: Arc<ReqwestGoogleCalendarClient>,
    account_id: &str,
) -> Result<String, InfraError> {
    let initializer = BlocksCalendarInitializer::new(config_dir, account_id, calendar_client);
    let result = initializer.ensure_blocks_calendar(access_token).await?;
    Ok(match result {
        EnsureBlocksCalendarResult::Reused(id)
        | EnsureBlocksCalendarResult::LinkedExisting(id)
        | EnsureBlocksCalendarResult::Created(id) => id,
    })
}

fn load_oauth_config_from_env() -> Result<OAuthConfig, InfraError> {
    load_oauth_config_from_lookup(|key| std::env::var(key).ok())
}

fn load_oauth_config_from_lookup<F>(lookup: F) -> Result<OAuthConfig, InfraError>
where
    F: Fn(&str) -> Option<String>,
{
    let client_id = required_lookup_value(
        &lookup,
        &["POMBLOCK_GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID"],
        "google client id",
    )?;
    let client_secret = required_lookup_value(
        &lookup,
        &["POMBLOCK_GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"],
        "google client secret",
    )?;
    let redirect_uri = optional_lookup_value(
        &lookup,
        &["POMBLOCK_GOOGLE_REDIRECT_URI", "GOOGLE_REDIRECT_URI"],
    )
    .unwrap_or_else(|| DEFAULT_REDIRECT_URI.to_string());
    let scopes = optional_lookup_value(&lookup, &["POMBLOCK_GOOGLE_SCOPES", "GOOGLE_SCOPES"])
        .map(|raw| parse_scope_list(&raw))
        .filter(|scopes| !scopes.is_empty())
        .unwrap_or_else(|| vec![DEFAULT_SCOPE.to_string()]);

    Ok(OAuthConfig::new(
        client_id,
        client_secret,
        redirect_uri,
        scopes,
    ))
}

fn required_lookup_value<F>(
    lookup: &F,
    keys: &[&str],
    field_name: &str,
) -> Result<String, InfraError>
where
    F: Fn(&str) -> Option<String>,
{
    optional_lookup_value(lookup, keys).ok_or_else(|| {
        InfraError::InvalidConfig(format!(
            "missing {} (set one of: {})",
            field_name,
            keys.join(", ")
        ))
    })
}

fn optional_lookup_value<F>(lookup: &F, keys: &[&str]) -> Option<String>
where
    F: Fn(&str) -> Option<String>,
{
    for key in keys {
        if let Some(value) = lookup(key) {
            let normalized = value.trim();
            if !normalized.is_empty() {
                return Some(normalized.to_string());
            }
        }
    }
    None
}

fn parse_scope_list(raw: &str) -> Vec<String> {
    raw.split([',', ' ', '\n', '\t'])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn parse_pomodoro_phase(value: &str) -> Result<PomodoroPhase, InfraError> {
    match value.trim() {
        "focus" => Ok(PomodoroPhase::Focus),
        "break" => Ok(PomodoroPhase::Break),
        "long_break" => Ok(PomodoroPhase::LongBreak),
        "paused" => Ok(PomodoroPhase::Paused),
        other => Err(InfraError::InvalidConfig(format!(
            "unsupported pomodoro phase: {}",
            other
        ))),
    }
}

pub(crate) fn save_suppression(
    database_path: &Path,
    instance: &str,
    reason: Option<&str>,
) -> Result<(), InfraError> {
    let single = vec![instance.to_string()];
    let _ = save_suppressions(database_path, &single, reason)?;
    Ok(())
}

pub(crate) fn append_audit_log(
    database_path: &Path,
    event_type: &str,
    payload: &serde_json::Value,
) -> Result<(), InfraError> {
    let connection = Connection::open(database_path)?;
    connection.execute(
        "INSERT INTO audit_logs (event_type, payload_json, created_at) VALUES (?1, ?2, ?3)",
        params![event_type, serde_json::to_string(payload)?, Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

pub(crate) fn load_pomodoro_logs(
    database_path: &Path,
    start: DateTime<Utc>,
    end: DateTime<Utc>,
) -> Result<Vec<PomodoroLog>, InfraError> {
    let connection = Connection::open(database_path)?;
    let mut statement = connection.prepare(
        "SELECT id, block_id, task_id, start_time, end_time, phase, interruption_reason
         FROM pomodoro_logs
         WHERE start_time >= ?1 AND start_time <= ?2
         ORDER BY start_time ASC",
    )?;
    let mut rows = statement.query(params![start.to_rfc3339(), end.to_rfc3339()])?;
    let mut logs = Vec::new();
    while let Some(row) = rows.next()? {
        let start_time = parse_datetime_input(&row.get::<_, String>(3)?, "pomodoro_logs.start_time")?;
        let end_time = row
            .get::<_, Option<String>>(4)?
            .map(|value| parse_datetime_input(&value, "pomodoro_logs.end_time"))
            .transpose()?;
        logs.push(PomodoroLog {
            id: row.get(0)?,
            block_id: row.get(1)?,
            task_id: row.get(2)?,
            start_time,
            end_time,
            phase: parse_pomodoro_phase(&row.get::<_, String>(5)?)?,
            interruption_reason: row.get(6)?,
        });
    }
    Ok(logs)
}

fn instance_matches_date(instance: &str, date_key: &str) -> bool {
    if instance.is_empty() || date_key.is_empty() {
        return false;
    }
    instance.ends_with(&format!(":{date_key}")) || instance.contains(&format!(":{date_key}:"))
}

pub(crate) fn clear_user_deleted_suppressions_for_date(
    database_path: &Path,
    date: NaiveDate,
) -> Result<usize, InfraError> {
    let date_key = date.to_string();
    let mut connection = Connection::open(database_path)?;
    let mut statement = connection.prepare("SELECT instance, reason FROM suppressions")?;
    let mut rows = statement.query([])?;
    let mut targets = Vec::new();

    while let Some(row) = rows.next()? {
        let instance: String = row.get(0)?;
        let reason: Option<String> = row.get(1)?;
        let normalized_instance = instance.trim();
        if normalized_instance.is_empty() {
            continue;
        }
        let normalized_reason = reason.as_deref().map(str::trim).unwrap_or("");
        if normalized_reason != "user_deleted" {
            continue;
        }
        if !instance_matches_date(normalized_instance, date_key.as_str()) {
            continue;
        }
        targets.push(normalized_instance.to_string());
    }
    drop(rows);
    drop(statement);

    if targets.is_empty() {
        return Ok(0);
    }

    let transaction = connection.transaction()?;
    for instance in &targets {
        transaction.execute("DELETE FROM suppressions WHERE instance = ?1", params![instance])?;
    }
    transaction.commit()?;
    Ok(targets.len())
}

pub(crate) fn save_suppressions(
    database_path: &Path,
    instances: &[String],
    reason: Option<&str>,
) -> Result<usize, InfraError> {
    let mut connection = Connection::open(database_path)?;
    let transaction = connection.transaction()?;
    let normalized_reason = reason
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let suppressed_at = Utc::now().to_rfc3339();
    let mut seen = HashSet::new();
    let mut saved = 0usize;

    for instance in instances {
        let normalized_instance = instance.trim();
        if normalized_instance.is_empty() {
            continue;
        }
        if !seen.insert(normalized_instance.to_string()) {
            continue;
        }

        transaction.execute(
            "INSERT INTO suppressions (instance, suppressed_at, reason)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(instance) DO UPDATE SET
               suppressed_at = excluded.suppressed_at,
               reason = excluded.reason",
            params![normalized_instance, suppressed_at, normalized_reason.as_deref()],
        )?;
        saved = saved.saturating_add(1);
    }

    transaction.commit()?;
    Ok(saved)
}

pub(crate) fn load_suppressions(database_path: &Path) -> Result<HashSet<String>, InfraError> {
    let connection = Connection::open(database_path)?;
    let mut statement = connection.prepare("SELECT instance FROM suppressions")?;
    let mut rows = statement.query([])?;
    let mut suppressions = HashSet::new();

    while let Some(row) = rows.next()? {
        let instance: String = row.get(0)?;
        let normalized = instance.trim();
        if normalized.is_empty() {
            continue;
        }
        suppressions.insert(normalized.to_string());
    }

    Ok(suppressions)
}

pub(crate) async fn auto_relocate_after_sync(
    state: &AppState,
    account_id: &str,
    changed_intervals: &[Interval],
    max_relocations_per_sync: u32,
) -> Result<usize, InfraError> {
    let started_at = Instant::now();
    let account_id = account_id.trim();
    if account_id.is_empty() || changed_intervals.is_empty() || max_relocations_per_sync == 0 {
        state.log_info(
            "auto_relocate_after_sync",
            &format!(
                "candidate_block_count=0 relocated_count=0 elapsed_ms={} limit={} (skipped)",
                started_at.elapsed().as_millis(),
                max_relocations_per_sync
            ),
        );
        return Ok(0);
    }

    let block_ids = {
        let runtime = lock_runtime(state)?;
        collect_relocation_target_block_ids(
            &runtime,
            account_id,
            changed_intervals,
            max_relocations_per_sync,
        )
    };

    let candidate_block_count = block_ids.len();
    let mut relocated_count = 0usize;
    for block_id in block_ids {
        if relocated_count >= max_relocations_per_sync as usize {
            break;
        }
        if crate::application::block_operations::relocate_if_needed(
            state,
            block_id,
            Some(account_id.to_string()),
        )
        .await?
        .is_some()
        {
            relocated_count = relocated_count.saturating_add(1);
        }
    }

    state.log_info(
        "auto_relocate_after_sync",
        &format!(
            "candidate_block_count={} relocated_count={} elapsed_ms={} limit={}",
            candidate_block_count,
            relocated_count,
            started_at.elapsed().as_millis(),
            max_relocations_per_sync
        ),
    );

    Ok(relocated_count)
}

fn collect_relocation_target_block_ids(
    runtime: &RuntimeState,
    account_id: &str,
    changed_intervals: &[Interval],
    max_relocations_per_sync: u32,
) -> Vec<String> {
    if changed_intervals.is_empty() || max_relocations_per_sync == 0 {
        return Vec::new();
    }

    let mut candidates = runtime
        .blocks
        .values()
        .filter(|stored| {
            let block_account = stored
                .calendar_account_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(DEFAULT_ACCOUNT_ID);
            if block_account != account_id {
                return false;
            }

            let block_interval = Interval {
                start: stored.block.start_at,
                end: stored.block.end_at,
            };
            changed_intervals
                .iter()
                .any(|interval| intervals_overlap(&block_interval, interval))
        })
        .map(|stored| (stored.block.start_at, stored.block.id.clone()))
        .collect::<Vec<_>>();

    candidates.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    candidates.truncate(max_relocations_per_sync as usize);
    candidates.into_iter().map(|(_, id)| id).collect()
}

pub(crate) fn parse_task_status(value: &str) -> Result<TaskStatus, InfraError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "pending" => Ok(TaskStatus::Pending),
        "in_progress" | "in-progress" => Ok(TaskStatus::InProgress),
        "completed" => Ok(TaskStatus::Completed),
        "deferred" => Ok(TaskStatus::Deferred),
        other => Err(InfraError::InvalidConfig(format!(
            "unsupported task status: {}",
            other
        ))),
    }
}

pub(crate) fn task_status_as_str(value: &TaskStatus) -> &'static str {
    match value {
        TaskStatus::Pending => "pending",
        TaskStatus::InProgress => "in_progress",
        TaskStatus::Completed => "completed",
        TaskStatus::Deferred => "deferred",
    }
}

pub(crate) fn assign_task_to_block(runtime: &mut RuntimeState, task_id: &str, block_id: &str) {
    if let Some(previous_block_id) = runtime
        .task_assignments_by_task
        .insert(task_id.to_string(), block_id.to_string())
    {
        runtime.task_assignments_by_block.remove(previous_block_id.as_str());
    }
    if let Some(previous_task_id) = runtime
        .task_assignments_by_block
        .insert(block_id.to_string(), task_id.to_string())
    {
        runtime.task_assignments_by_task.remove(previous_task_id.as_str());
    }
}

pub(crate) fn unassign_task(runtime: &mut RuntimeState, task_id: &str) -> Option<String> {
    let previous_block_id = runtime.task_assignments_by_task.remove(task_id)?;
    runtime
        .task_assignments_by_block
        .remove(previous_block_id.as_str());
    Some(previous_block_id)
}

pub(crate) fn is_cancelled_event(event: &GoogleCalendarEvent) -> bool {
    event
        .status
        .as_deref()
        .map(|status| status.eq_ignore_ascii_case("cancelled"))
        .unwrap_or(false)
}

pub(crate) fn planned_pomodoros(block_duration_minutes: u32, break_duration_minutes: u32) -> i32 {
    let cycle_minutes = 25u32.saturating_add(break_duration_minutes.max(1));
    (block_duration_minutes / cycle_minutes).max(1) as i32
}

pub(crate) async fn create_calendar_events_for_generated_blocks(
    sync_service: Arc<
        CalendarSyncService<
            ReqwestGoogleCalendarClient,
            SqliteSyncStateRepository,
            InMemoryCalendarCacheRepository,
        >,
    >,
    access_token: &str,
    calendar_id: &str,
    generated: &mut [StoredBlock],
) -> Result<(), InfraError> {
    if generated.is_empty() {
        return Ok(());
    }

    let mut create_tasks: JoinSet<Result<(usize, String), InfraError>> = JoinSet::new();
    let mut created_event_ids = vec![None; generated.len()];
    let access_token = access_token.to_string();
    let calendar_id = calendar_id.to_string();

    for (index, stored) in generated.iter().enumerate() {
        let sync_service = Arc::clone(&sync_service);
        let access_token = access_token.clone();
        let calendar_id = calendar_id.clone();
        let event = encode_block_event(&stored.block);

        create_tasks.spawn(async move {
            let event_id = sync_service
                .create_event(&access_token, &calendar_id, &event)
                .await?;
            Ok((index, event_id))
        });

        if create_tasks.len() >= BLOCK_CREATION_CONCURRENCY {
            collect_created_event_id(&mut create_tasks, &mut created_event_ids).await?;
        }
    }

    while !create_tasks.is_empty() {
        collect_created_event_id(&mut create_tasks, &mut created_event_ids).await?;
    }

    for (index, event_id) in created_event_ids.into_iter().enumerate() {
        if let Some(event_id) = event_id {
            generated[index].calendar_event_id = Some(event_id);
        }
    }

    Ok(())
}

async fn collect_created_event_id(
    create_tasks: &mut JoinSet<Result<(usize, String), InfraError>>,
    created_event_ids: &mut [Option<String>],
) -> Result<(), InfraError> {
    let Some(join_result) = create_tasks.join_next().await else {
        return Ok(());
    };
    let created = join_result.map_err(|error| {
        InfraError::OAuth(format!("failed to join calendar event creation task: {error}"))
    })??;
    if let Some(slot) = created_event_ids.get_mut(created.0) {
        *slot = Some(created.1);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::commands::{
        adjust_block_time_impl, advance_pomodoro_impl, approve_blocks_impl,
        carry_over_task_impl, complete_pomodoro_impl, create_module_impl, create_recipe_impl,
        create_task_impl, delete_block_impl, delete_module_impl, delete_task_impl,
        generate_blocks_impl, generate_one_block_impl, get_pomodoro_state_impl,
        get_reflection_summary_impl, list_blocks_impl, list_modules_impl, list_recipes_impl,
        list_tasks_impl, pause_pomodoro_impl, relocate_if_needed_impl, resume_pomodoro_impl,
        split_task_impl, start_pomodoro_impl, update_module_impl, update_recipe_impl,
        update_task_impl,
    };
    use crate::application::studio_template_application;
    use crate::domain::models::{AutoDriveMode, BlockContents, Firmness};
    use crate::infrastructure::event_mapper::{CalendarEventDateTime, GoogleCalendarEvent};
    use chrono::{Duration, NaiveTime, TimeZone};
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEMP_WORKSPACE: AtomicUsize = AtomicUsize::new(0);

    struct TempWorkspace {
        path: PathBuf,
    }

    impl TempWorkspace {
        fn new() -> Self {
            let sequence = NEXT_TEMP_WORKSPACE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "pomblock-command-tests-{}-{}",
                std::process::id(),
                sequence
            ));
            fs::create_dir_all(&path).expect("create temp workspace");
            Self { path }
        }

        fn app_state(&self) -> AppState {
            AppState::new(self.path.clone()).expect("initialize app state")
        }
    }

    impl Drop for TempWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn oauth_config_validation_reports_missing_client_id() {
        let result = load_oauth_config_from_lookup(|key| match key {
            "POMBLOCK_GOOGLE_CLIENT_SECRET" => Some("secret".to_string()),
            _ => None,
        });
        match result {
            Err(InfraError::InvalidConfig(message)) => {
                assert!(message.contains("google client id"));
            }
            _ => panic!("expected invalid config error"),
        }
    }

    #[test]
    fn create_task_rejects_empty_title() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let result = create_task_impl(&state, "   ".to_string(), None, None);
        assert!(result.is_err());
    }

    #[test]
    fn create_and_list_tasks_roundtrip() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();

        let created = create_task_impl(
            &state,
            "Write integration tests".to_string(),
            Some("Task 18.5".to_string()),
            Some(2),
        )
        .expect("create task");
        let listed = list_tasks_impl(&state).expect("list tasks");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);
        assert_eq!(listed[0].status, TaskStatus::Pending);
    }

    #[tokio::test]
    async fn generate_and_approve_blocks_flow() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();

        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        assert!(!generated.is_empty());
        assert_eq!(generated[0].firmness, Firmness::Draft);

        let approved = approve_blocks_impl(&state, vec![generated[0].id.clone()])
            .await
            .expect("approve block");
        assert_eq!(approved.len(), 1);
        assert_eq!(approved[0].firmness, Firmness::Soft);
    }

    #[test]
    fn start_pomodoro_requires_existing_block() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let result = start_pomodoro_impl(&state, "missing-block".to_string(), None);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn start_pause_and_get_pomodoro_state_flow() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        let block_id = generated[0].id.clone();
        let policy = load_runtime_policy(state.config_dir());
        let recipes = configured_recipes::load_configured_recipes(state.config_dir());
        let expected_plan = pomodoro_session_plan::build_pomodoro_session_plan(
            &generated[0],
            policy.break_duration_minutes,
            &recipes,
        );

        let started = start_pomodoro_impl(&state, block_id.clone(), None).expect("start pomodoro");
        assert_eq!(started.phase, "focus");
        assert_eq!(started.current_block_id, Some(block_id.clone()));
        assert_eq!(started.remaining_seconds, expected_plan.focus_seconds);
        assert_eq!(started.total_cycles, expected_plan.total_cycles);
        assert_eq!(started.completed_cycles, 0);
        assert_eq!(started.current_cycle, 1);

        let paused =
            pause_pomodoro_impl(&state, Some("interruption".to_string())).expect("pause pomodoro");
        assert_eq!(paused.phase, "paused");

        let snapshot = get_pomodoro_state_impl(&state).expect("get pomodoro state");
        assert_eq!(snapshot.phase, "paused");
        assert_eq!(snapshot.current_block_id, Some(block_id));
    }

    #[tokio::test]
    async fn property_15_starting_pomodoro_activates_running_timer() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");

        let snapshot =
            start_pomodoro_impl(&state, generated[0].id.clone(), None).expect("start pomodoro");

        assert_eq!(snapshot.phase, "focus");
        assert!(snapshot.remaining_seconds > 0);
        assert_eq!(
            snapshot.current_block_id.as_deref(),
            Some(generated[0].id.as_str())
        );
    }

    #[tokio::test]
    async fn advance_pomodoro_tracks_cycles_inside_block() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        let block = generated[0].clone();
        let policy = load_runtime_policy(state.config_dir());
        let recipes = configured_recipes::load_configured_recipes(state.config_dir());
        let expected_plan = pomodoro_session_plan::build_pomodoro_session_plan(
            &block,
            policy.break_duration_minutes,
            &recipes,
        );

        let started =
            start_pomodoro_impl(&state, block.id.clone(), None).expect("start pomodoro session");
        assert_eq!(started.total_cycles, expected_plan.total_cycles);

        let mut snapshot = advance_pomodoro_impl(&state).expect("advance to break");
        assert_eq!(snapshot.phase, "break");
        assert_eq!(snapshot.completed_cycles, 1);

        if expected_plan.total_cycles > 1 {
            snapshot = advance_pomodoro_impl(&state).expect("advance back to focus");
            assert_eq!(snapshot.phase, "focus");
            assert_eq!(snapshot.current_cycle, 2);
        }

        let mut guard = 0;
        while (snapshot.phase != "break" || snapshot.completed_cycles < expected_plan.total_cycles)
            && guard < 16
        {
            snapshot = advance_pomodoro_impl(&state).expect("advance until final break");
            guard += 1;
        }
        assert_eq!(snapshot.phase, "break");
        assert_eq!(snapshot.completed_cycles, expected_plan.total_cycles);

        snapshot = advance_pomodoro_impl(&state).expect("advance from final break to idle");
        assert_eq!(snapshot.phase, "idle");
        assert_eq!(snapshot.current_block_id, None);
    }

    #[tokio::test]
    async fn generate_blocks_rejects_invalid_date() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let result = generate_blocks_impl(&state, "not-a-date".to_string(), None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn generate_blocks_respects_suppressions() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        save_suppression(
            state.database_path(),
            "rtn:auto:2026-02-16:0",
            Some("test_suppression"),
        )
        .expect("save suppression");

        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");

        assert!(!generated.is_empty());
        assert!(generated
            .iter()
            .all(|block| block.instance != "rtn:auto:2026-02-16:0"));
    }

    #[tokio::test]
    async fn generate_blocks_regenerates_after_all_blocks_deleted_for_date() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();

        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("initial generation");
        assert_eq!(generated.len(), 9);

        for block in generated {
            let deleted = delete_block_impl(&state, block.id.clone())
                .await
                .expect("delete generated block");
            assert!(deleted);
        }

        let regenerated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("regenerate after deletes");
        assert_eq!(regenerated.len(), 9);
        assert!(regenerated
            .iter()
            .any(|block| block.instance == "rtn:auto:2026-02-16:0"));
    }

    #[tokio::test]
    async fn generate_blocks_refills_gap_after_single_block_deleted() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();

        let mut generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("initial generation");
        generated.sort_by(|left, right| left.start_at.cmp(&right.start_at));
        let removed = generated[4].clone();
        let deleted = delete_block_impl(&state, removed.id.clone())
            .await
            .expect("delete one generated block");
        assert!(deleted);

        let refill = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("refill one gap");
        assert_eq!(refill.len(), 1);
        assert_eq!(refill[0].start_at, removed.start_at);
        assert_eq!(refill[0].end_at, removed.end_at);

        let listed = list_blocks_impl(&state, Some("2026-02-16".to_string())).expect("list blocks");
        assert_eq!(listed.len(), 9);
    }

    #[tokio::test]
    async fn generate_blocks_auto_fills_work_window_with_hour_blocks() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");

        assert_eq!(generated.len(), 9);
        let mut sorted = generated.clone();
        sorted.sort_by(|left, right| left.start_at.cmp(&right.start_at));

        let day = NaiveDate::parse_from_str("2026-02-16", "%Y-%m-%d").expect("valid date");
        let day_start = Utc.from_utc_datetime(&day.and_hms_opt(0, 0, 0).expect("midnight"));
        for (index, block) in sorted.iter().enumerate() {
            let expected_start = day_start + Duration::hours(9 + index as i64);
            let expected_end = expected_start + Duration::hours(1);
            assert_eq!(block.start_at, expected_start);
            assert_eq!(block.end_at, expected_end);
            assert_eq!(block.planned_pomodoros, 2);
            assert!(block.instance.starts_with("rtn:auto:"));
            assert_eq!(block.source, "routine");
            assert_eq!(block.source_id.as_deref(), Some("auto"));
            if index > 0 {
                assert_eq!(sorted[index - 1].end_at, block.start_at);
            }
        }
    }

    #[tokio::test]
    async fn generate_one_block_adds_single_block_per_call() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();

        let first = generate_one_block_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate first block");
        assert_eq!(first.len(), 1);

        let second = generate_one_block_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate second block");
        assert_eq!(second.len(), 1);

        let listed = list_blocks_impl(&state, Some("2026-02-16".to_string())).expect("list blocks");
        assert_eq!(listed.len(), 2);
    }

    #[tokio::test]
    async fn generate_one_block_allows_overlap_when_day_is_full() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();

        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate full day");
        assert_eq!(generated.len(), 9);

        let one_more = generate_one_block_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate one overlapping block");
        assert_eq!(one_more.len(), 1);
        let one_interval = Interval {
            start: one_more[0].start_at,
            end: one_more[0].end_at,
        };
        assert!(generated.iter().any(|block| {
            intervals_overlap(
                &Interval {
                    start: block.start_at,
                    end: block.end_at,
                },
                &one_interval,
            )
        }));

        let listed = list_blocks_impl(&state, Some("2026-02-16".to_string())).expect("list blocks");
        assert_eq!(listed.len(), 10);
    }

    #[tokio::test]
    async fn generate_blocks_respects_max_auto_blocks_per_day() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let policies_path = state.config_dir().join("policies.json");
        fs::write(
            &policies_path,
            r#"{
  "schema": 1,
  "workHours": {
    "start": "00:00",
    "end": "23:59",
    "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
  },
  "generation": {
    "autoEnabled": true,
    "autoTime": "05:30",
    "catchUpOnAppStart": true,
    "placementStrategy": "keep",
    "maxShiftMinutes": 120,
    "maxAutoBlocksPerDay": 24,
    "maxRelocationsPerSync": 50,
    "createIfNoSlot": false,
    "respectSuppression": true
  },
  "blockDurationMinutes": 1,
  "breakDurationMinutes": 5,
  "minBlockGapMinutes": 0
}
"#,
        )
        .expect("write policies config");

        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");

        assert_eq!(generated.len(), 24);
        assert!(generated
            .iter()
            .all(|block| block.instance.starts_with("rtn:auto:")));
    }

    #[tokio::test]
    async fn generate_blocks_uses_configured_timezone() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let app_config_path = state.config_dir().join("app.json");
        let app_raw = fs::read_to_string(&app_config_path).expect("read app config");
        let mut app_config: serde_json::Value =
            serde_json::from_str(&app_raw).expect("parse app config");
        app_config["timezone"] = serde_json::Value::String("Asia/Tokyo".to_string());
        fs::write(
            &app_config_path,
            format!(
                "{}\n",
                serde_json::to_string_pretty(&app_config).expect("serialize app config")
            ),
        )
        .expect("write app config");

        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");

        assert!(!generated.is_empty());
        assert_eq!(generated[0].start_at.to_rfc3339(), "2026-02-16T00:00:00+00:00");
        assert_eq!(generated[0].end_at.to_rfc3339(), "2026-02-16T01:00:00+00:00");
    }

    #[tokio::test]
    async fn generate_blocks_uses_templates_and_routines_when_configured() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let templates_path = state.config_dir().join("templates.json");
        let routines_path = state.config_dir().join("routines.json");
        fs::write(
            &templates_path,
            r#"{
  "templates": [
    {
      "id": "focus-morning",
      "name": "Focus Morning",
      "start": "09:00",
      "durationMinutes": 50,
      "firmness": "soft",
      "plannedPomodoros": 2
    }
  ]
}
"#,
        )
        .expect("write templates config");
        fs::write(
            &routines_path,
            r#"{
  "routines": [
    {
      "id": "daily-admin",
      "name": "Daily Admin",
      "rrule": "FREQ=DAILY",
      "default": {
        "start": "10:00",
        "durationMinutes": 25,
        "pomodoros": 1
      },
      "firmness": "draft"
    }
  ]
}
"#,
        )
        .expect("write routines config");

        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");

        assert!(generated.len() > 2);
        assert!(generated
            .iter()
            .any(|block| block.instance == "tpl:focus-morning:2026-02-16"));
        assert!(generated
            .iter()
            .any(|block| block.instance == "rtn:daily-admin:2026-02-16"));
        assert!(generated
            .iter()
            .any(|block| block.instance.starts_with("rtn:auto:")));
    }

    #[test]
    fn modules_crud_persists_to_modules_json() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();

        let before = list_modules_impl(&state).expect("list modules");
        assert!(!before.is_empty());

        let created = create_module_impl(
            &state,
            serde_json::json!({
                "id": "mod-test-module",
                "name": "Test Module",
                "category": "Testing",
                "description": "integration test module",
                "icon": "beaker",
                "stepType": "micro",
                "durationMinutes": 7,
                "checklist": ["one", "two"],
                "overrunPolicy": "wait",
                "executionHints": {
                    "allowSkip": true,
                    "mustCompleteChecklist": false,
                    "autoAdvance": true
                }
            }),
        )
        .expect("create module");
        assert_eq!(created.id, "mod-test-module");

        let updated = update_module_impl(
            &state,
            "mod-test-module".to_string(),
            serde_json::json!({
                "name": "Test Module Updated",
                "category": "Testing",
                "stepType": "micro",
                "durationMinutes": 9,
                "checklist": ["three"],
                "overrunPolicy": "wait"
            }),
        )
        .expect("update module");
        assert_eq!(updated.name, "Test Module Updated");
        assert_eq!(updated.duration_minutes, 9);

        let listed = list_modules_impl(&state).expect("list modules");
        assert!(listed.iter().any(|module| module.id == "mod-test-module"));

        let deleted = delete_module_impl(&state, "mod-test-module".to_string()).expect("delete module");
        assert!(deleted);
        let after_delete = list_modules_impl(&state).expect("list modules");
        assert!(after_delete
            .iter()
            .all(|module| module.id != "mod-test-module"));
    }

    #[tokio::test]
    async fn apply_studio_template_to_today_creates_block_without_shift() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();

        create_recipe_impl(
            &state,
            serde_json::json!({
                "id": "rcp-studio-a",
                "name": "Studio A",
                "autoDriveMode": "manual",
                "studioMeta": {
                    "version": 1,
                    "kind": "routine_studio"
                },
                "steps": [
                    {
                        "id": "step-1",
                        "type": "micro",
                        "title": "A",
                        "durationSeconds": 900
                    }
                ]
            }),
        )
        .expect("create studio recipe");

        let result = studio_template_application::apply_studio_template_to_today(
            &state,
            "rcp-studio-a".to_string(),
            "2026-02-16".to_string(),
            "09:00".to_string(),
            Some("shift".to_string()),
            None,
        )
        .await
        .expect("apply studio template");

        assert!(!result.shifted);
        assert_eq!(result.conflict_count, 0);
        let blocks = list_blocks_impl(&state, Some("2026-02-16".to_string())).expect("list blocks");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].source, "routine_studio");
        assert_eq!(blocks[0].recipe_id, "rcp-studio-a");
    }

    #[tokio::test]
    async fn apply_studio_template_to_today_shifts_when_conflict_exists() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();

        create_recipe_impl(
            &state,
            serde_json::json!({
                "id": "rcp-studio-b",
                "name": "Studio B",
                "autoDriveMode": "manual",
                "studioMeta": {
                    "version": 1,
                    "kind": "routine_studio"
                },
                "steps": [
                    {
                        "id": "step-1",
                        "type": "micro",
                        "title": "B",
                        "durationSeconds": 1800
                    }
                ]
            }),
        )
        .expect("create studio recipe");

        let busy_block = Block {
            id: "blk-busy".to_string(),
            instance: "manual:busy".to_string(),
            date: "2026-02-16".to_string(),
            start_at: DateTime::parse_from_rfc3339("2026-02-16T09:00:00Z")
                .expect("start")
                .with_timezone(&Utc),
            end_at: DateTime::parse_from_rfc3339("2026-02-16T09:30:00Z")
                .expect("end")
                .with_timezone(&Utc),
            firmness: Firmness::Hard,
            planned_pomodoros: 1,
            source: "manual".to_string(),
            source_id: Some("busy".to_string()),
            recipe_id: "rcp-default".to_string(),
            auto_drive_mode: AutoDriveMode::Manual,
            contents: BlockContents::default(),
        };
        {
            let mut runtime = lock_runtime(&state).expect("runtime lock");
            runtime.blocks.insert(
                busy_block.id.clone(),
                StoredBlock {
                    block: busy_block.clone(),
                    calendar_event_id: None,
                    calendar_account_id: Some(DEFAULT_ACCOUNT_ID.to_string()),
                },
            );
        }

        let result = studio_template_application::apply_studio_template_to_today(
            &state,
            "rcp-studio-b".to_string(),
            "2026-02-16".to_string(),
            "09:00".to_string(),
            Some("shift".to_string()),
            None,
        )
        .await
        .expect("apply studio template with shift");
        assert!(result.shifted);
        assert!(result.conflict_count >= 1);
        let applied_start = DateTime::parse_from_rfc3339(&result.applied_start_at)
            .expect("parse applied start")
            .with_timezone(&Utc);
        assert!(applied_start >= busy_block.end_at);
    }

    #[tokio::test]
    async fn apply_studio_template_to_today_fails_when_no_free_slot() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();

        create_recipe_impl(
            &state,
            serde_json::json!({
                "id": "rcp-studio-c",
                "name": "Studio C",
                "autoDriveMode": "manual",
                "studioMeta": {
                    "version": 1,
                    "kind": "routine_studio"
                },
                "steps": [
                    {
                        "id": "step-1",
                        "type": "micro",
                        "title": "C",
                        "durationSeconds": 3600
                    }
                ]
            }),
        )
        .expect("create studio recipe");

        let full_day_block = Block {
            id: "blk-full".to_string(),
            instance: "manual:full".to_string(),
            date: "2026-02-16".to_string(),
            start_at: DateTime::parse_from_rfc3339("2026-02-16T00:00:00Z")
                .expect("start")
                .with_timezone(&Utc),
            end_at: DateTime::parse_from_rfc3339("2026-02-17T00:00:00Z")
                .expect("end")
                .with_timezone(&Utc),
            firmness: Firmness::Hard,
            planned_pomodoros: 1,
            source: "manual".to_string(),
            source_id: Some("full".to_string()),
            recipe_id: "rcp-default".to_string(),
            auto_drive_mode: AutoDriveMode::Manual,
            contents: BlockContents::default(),
        };
        {
            let mut runtime = lock_runtime(&state).expect("runtime lock");
            runtime.blocks.insert(
                full_day_block.id.clone(),
                StoredBlock {
                    block: full_day_block,
                    calendar_event_id: None,
                    calendar_account_id: Some(DEFAULT_ACCOUNT_ID.to_string()),
                },
            );
        }

        let error = studio_template_application::apply_studio_template_to_today(
            &state,
            "rcp-studio-c".to_string(),
            "2026-02-16".to_string(),
            "09:00".to_string(),
            Some("shift".to_string()),
            None,
        )
        .await
        .expect_err("apply should fail");
        assert!(error
            .to_string()
            .contains("no available free slot"));
    }

    #[tokio::test]
    async fn apply_studio_template_to_today_rejects_non_studio_recipe() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();

        create_recipe_impl(
            &state,
            serde_json::json!({
                "id": "rcp-legacy",
                "name": "Legacy",
                "autoDriveMode": "manual",
                "steps": [
                    {
                        "id": "step-1",
                        "type": "micro",
                        "title": "legacy",
                        "durationSeconds": 600
                    }
                ]
            }),
        )
        .expect("create legacy recipe");

        let error = studio_template_application::apply_studio_template_to_today(
            &state,
            "rcp-legacy".to_string(),
            "2026-02-16".to_string(),
            "09:00".to_string(),
            Some("shift".to_string()),
            None,
        )
        .await
        .expect_err("legacy apply should fail");
        assert!(error
            .to_string()
            .contains("routine studio"));
    }

    #[test]
    fn recipe_studio_fields_are_preserved_across_create_update_list() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();

        create_recipe_impl(
            &state,
            serde_json::json!({
                "id": "rcp-studio-meta",
                "name": "Studio Meta",
                "autoDriveMode": "auto",
                "studioMeta": {
                    "version": 1,
                    "kind": "routine_studio"
                },
                "steps": [
                    {
                        "id": "step-1",
                        "type": "pomodoro",
                        "title": "Focus",
                        "durationSeconds": 1500,
                        "moduleId": "mod-pomodoro-focus",
                        "checklist": ["Do one thing"],
                        "note": "initial",
                        "overrunPolicy": "wait",
                        "executionHints": {
                            "allowSkip": false,
                            "mustCompleteChecklist": true,
                            "autoAdvance": true
                        },
                        "pomodoro": {
                            "focusSeconds": 1500,
                            "breakSeconds": 300,
                            "cycles": 1,
                            "longBreakSeconds": 900,
                            "longBreakEvery": 4
                        }
                    }
                ]
            }),
        )
        .expect("create studio recipe");

        update_recipe_impl(
            &state,
            "rcp-studio-meta".to_string(),
            serde_json::json!({
                "name": "Studio Meta Updated",
                "autoDriveMode": "manual",
                "studioMeta": {
                    "version": 1,
                    "kind": "routine_studio"
                },
                "steps": [
                    {
                        "id": "step-1",
                        "type": "micro",
                        "title": "Focus Updated",
                        "durationSeconds": 1200,
                        "moduleId": "mod-deep-work-init",
                        "checklist": ["Updated one", "Updated two"],
                        "note": "updated",
                        "overrunPolicy": "wait",
                        "executionHints": {
                            "allowSkip": true,
                            "mustCompleteChecklist": false,
                            "autoAdvance": true
                        }
                    }
                ]
            }),
        )
        .expect("update studio recipe");

        let listed = list_recipes_impl(&state).expect("list recipes");
        let target = listed
            .into_iter()
            .find(|recipe| recipe.id == "rcp-studio-meta")
            .expect("recipe exists");
        assert!(configured_recipes::recipe_is_routine_studio(&target));
        assert_eq!(target.name, "Studio Meta Updated");
        assert_eq!(target.steps.len(), 1);
        let step = &target.steps[0];
        assert_eq!(step.module_id.as_deref(), Some("mod-deep-work-init"));
        assert_eq!(step.checklist.len(), 2);
        assert_eq!(step.note.as_deref(), Some("updated"));
        assert!(step.execution_hints.as_ref().map(|h| h.allow_skip).unwrap_or(false));
    }

    #[test]
    fn collect_relocation_target_block_ids_filters_by_changes_and_limit() {
        let make_block = |id: &str, start_at: &str, end_at: &str| Block {
            id: id.to_string(),
            instance: format!("rtn:auto:2026-02-16:{id}"),
            date: "2026-02-16".to_string(),
            start_at: DateTime::parse_from_rfc3339(start_at)
                .expect("start")
                .with_timezone(&Utc),
            end_at: DateTime::parse_from_rfc3339(end_at)
                .expect("end")
                .with_timezone(&Utc),
            firmness: Firmness::Draft,
            planned_pomodoros: 2,
            source: "routine".to_string(),
            source_id: Some("auto".to_string()),
            recipe_id: "rcp-default".to_string(),
            auto_drive_mode: AutoDriveMode::Manual,
            contents: BlockContents::default(),
        };

        let mut runtime = RuntimeState::default();
        let block_a = make_block("a", "2026-02-16T09:00:00Z", "2026-02-16T09:30:00Z");
        let block_b = make_block("b", "2026-02-16T10:00:00Z", "2026-02-16T10:30:00Z");
        let block_c = make_block("c", "2026-02-16T09:10:00Z", "2026-02-16T09:40:00Z");
        runtime.blocks.insert(
            block_a.id.clone(),
            StoredBlock {
                block: block_a.clone(),
                calendar_event_id: None,
                calendar_account_id: Some(DEFAULT_ACCOUNT_ID.to_string()),
            },
        );
        runtime.blocks.insert(
            block_b.id.clone(),
            StoredBlock {
                block: block_b,
                calendar_event_id: None,
                calendar_account_id: Some(DEFAULT_ACCOUNT_ID.to_string()),
            },
        );
        runtime.blocks.insert(
            block_c.id.clone(),
            StoredBlock {
                block: block_c.clone(),
                calendar_event_id: None,
                calendar_account_id: Some(DEFAULT_ACCOUNT_ID.to_string()),
            },
        );
        let block_other = make_block("other", "2026-02-16T09:05:00Z", "2026-02-16T09:20:00Z");
        runtime.blocks.insert(
            block_other.id.clone(),
            StoredBlock {
                block: block_other,
                calendar_event_id: None,
                calendar_account_id: Some("other-account".to_string()),
            },
        );

        let changed = vec![Interval {
            start: DateTime::parse_from_rfc3339("2026-02-16T09:15:00Z")
                .expect("interval start")
                .with_timezone(&Utc),
            end: DateTime::parse_from_rfc3339("2026-02-16T09:25:00Z")
                .expect("interval end")
                .with_timezone(&Utc),
        }];

        let limited = collect_relocation_target_block_ids(&runtime, DEFAULT_ACCOUNT_ID, &changed, 1);
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0], block_a.id);

        let full = collect_relocation_target_block_ids(&runtime, DEFAULT_ACCOUNT_ID, &changed, 10);
        assert_eq!(full, vec![block_a.id.clone(), block_c.id.clone()]);

        let none = collect_relocation_target_block_ids(&runtime, DEFAULT_ACCOUNT_ID, &[], 10);
        assert!(none.is_empty());
    }

    #[test]
    fn update_and_delete_task_flow() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let created = create_task_impl(&state, "Original".to_string(), None, Some(1))
            .expect("create task");

        let updated = update_task_impl(
            &state,
            created.id.clone(),
            Some("Updated".to_string()),
            Some("Details".to_string()),
            Some(3),
            Some("in_progress".to_string()),
        )
        .expect("update task");
        assert_eq!(updated.title, "Updated");
        assert_eq!(updated.status, TaskStatus::InProgress);
        assert_eq!(updated.estimated_pomodoros, Some(3));

        let deleted = delete_task_impl(&state, created.id.clone()).expect("delete task");
        assert!(deleted);
        let tasks = list_tasks_impl(&state).expect("list tasks");
        assert!(tasks.is_empty());
    }

    #[test]
    fn split_task_creates_children_and_defers_parent() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let parent = create_task_impl(&state, "Large task".to_string(), Some("split".to_string()), Some(8))
            .expect("create task");

        let children = split_task_impl(&state, parent.id.clone(), 4).expect("split task");
        assert_eq!(children.len(), 4);
        assert!(children
            .iter()
            .all(|child| child.title.starts_with("Large task (")));
        assert!(children
            .iter()
            .all(|child| child.estimated_pomodoros == Some(2)));

        let listed = list_tasks_impl(&state).expect("list tasks");
        let refreshed_parent = listed
            .iter()
            .find(|task| task.id == parent.id)
            .expect("parent task exists");
        assert_eq!(refreshed_parent.status, TaskStatus::Deferred);
    }

    #[tokio::test]
    async fn property_21_tasks_are_not_preassigned_before_block_starts() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        let task = create_task_impl(&state, "Unassigned".to_string(), None, Some(1))
            .expect("create task");

        let runtime = lock_runtime(&state).expect("runtime lock");
        assert!(runtime.task_assignments_by_task.get(task.id.as_str()).is_none());
        assert!(runtime
            .task_assignments_by_block
            .get(generated[0].id.as_str())
            .is_none());
    }

    #[tokio::test]
    async fn carry_over_task_moves_to_selected_available_block() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        assert!(generated.len() >= 2, "at least two blocks expected");
        let mut sorted = generated.clone();
        sorted.sort_by(|left, right| left.start_at.cmp(&right.start_at));
        let from_block = sorted[0].clone();
        let next_block = sorted[1].clone();
        let task = create_task_impl(&state, "Carry task".to_string(), None, Some(3))
            .expect("create task");

        let result = carry_over_task_impl(
            &state,
            task.id.clone(),
            from_block.id.clone(),
            Some(vec![next_block.id.clone()]),
        )
        .expect("carry over task");

        assert_eq!(result.task_id, task.id);
        assert_eq!(result.from_block_id, from_block.id);
        assert_eq!(result.to_block_id, next_block.id);
        assert_eq!(result.status, "in_progress");
    }

    #[tokio::test]
    async fn relocate_if_needed_moves_block_when_conflicting_event_exists() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let block = Block {
            id: "blk-relocate".to_string(),
            instance: "rtn:auto:2026-02-16:0".to_string(),
            date: "2026-02-16".to_string(),
            start_at: DateTime::parse_from_rfc3339("2026-02-16T09:00:00Z")
                .expect("start")
                .with_timezone(&Utc),
            end_at: DateTime::parse_from_rfc3339("2026-02-16T09:50:00Z")
                .expect("end")
                .with_timezone(&Utc),
            firmness: Firmness::Draft,
            planned_pomodoros: 2,
            source: "routine".to_string(),
            source_id: Some("auto".to_string()),
            recipe_id: "rcp-default".to_string(),
            auto_drive_mode: AutoDriveMode::Manual,
            contents: BlockContents::default(),
        };
        {
            let mut runtime = lock_runtime(&state).expect("runtime lock");
            runtime.blocks.insert(
                block.id.clone(),
                StoredBlock {
                    block: block.clone(),
                    calendar_event_id: None,
                    calendar_account_id: Some(DEFAULT_ACCOUNT_ID.to_string()),
                },
            );
            runtime.synced_events_by_account.insert(
                DEFAULT_ACCOUNT_ID.to_string(),
                vec![GoogleCalendarEvent {
                    id: Some("evt-conflict".to_string()),
                    summary: Some("conflict".to_string()),
                    description: None,
                    status: Some("confirmed".to_string()),
                    updated: None,
                    etag: None,
                    start: CalendarEventDateTime {
                        date_time: "2026-02-16T09:10:00Z".to_string(),
                        time_zone: None,
                    },
                    end: CalendarEventDateTime {
                        date_time: "2026-02-16T09:40:00Z".to_string(),
                        time_zone: None,
                    },
                    extended_properties: None,
                }],
            );
        }

        let relocated = relocate_if_needed_impl(&state, block.id.clone(), None)
            .await
            .expect("relocate")
            .expect("block relocated");

        assert_eq!(relocated.id, block.id);
        let conflict_end = DateTime::parse_from_rfc3339("2026-02-16T09:40:00Z")
            .expect("conflict end")
            .with_timezone(&Utc);
        assert!(relocated.start_at >= conflict_end);
        assert_eq!(relocated.end_at - relocated.start_at, block.end_at - block.start_at);
    }

    #[tokio::test]
    async fn delete_and_adjust_block_flow() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        let block = generated[0].clone();

        let shifted = adjust_block_time_impl(
            &state,
            block.id.clone(),
            "2026-02-16T10:00:00Z".to_string(),
            "2026-02-16T10:50:00Z".to_string(),
        )
        .await
        .expect("adjust block");
        assert_eq!(shifted.start_at.to_rfc3339(), "2026-02-16T10:00:00+00:00");

        let deleted = delete_block_impl(&state, block.id.clone())
            .await
            .expect("delete block");
        assert!(deleted);
        let blocks = list_blocks_impl(&state, Some("2026-02-16".to_string())).expect("list blocks");
        assert!(blocks.into_iter().all(|candidate| candidate.id != block.id));
    }

    #[tokio::test]
    async fn resume_complete_and_reflection_flow() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        let block_id = generated[0].id.clone();

        let _ = start_pomodoro_impl(&state, block_id, None).expect("start");
        let _ = pause_pomodoro_impl(&state, Some("break".to_string())).expect("pause");
        let resumed = resume_pomodoro_impl(&state).expect("resume");
        assert!(resumed.phase == "focus" || resumed.phase == "break");

        let completed = complete_pomodoro_impl(&state).expect("complete");
        assert_eq!(completed.phase, "idle");

        let summary = get_reflection_summary_impl(&state, None, None).expect("summary");
        assert!(summary.interrupted_count >= 1);
    }

    #[tokio::test]
    async fn reflection_summary_survives_app_state_restart() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        let block_id = generated[0].id.clone();

        let _ = start_pomodoro_impl(&state, block_id, None).expect("start");
        let _ = pause_pomodoro_impl(&state, Some("restart-check".to_string())).expect("pause");
        let _ = complete_pomodoro_impl(&state).expect("complete");

        let restarted_state = workspace.app_state();
        let summary = get_reflection_summary_impl(&restarted_state, None, None).expect("summary");

        assert!(summary.interrupted_count >= 1);
        assert!(!summary.logs.is_empty());
    }

    #[tokio::test]
    async fn property_32_reflection_aggregates_match_underlying_logs() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");

        let _ = start_pomodoro_impl(&state, generated[0].id.clone(), None).expect("start first");
        let _ = pause_pomodoro_impl(&state, Some("property-32".to_string())).expect("pause first");
        let _ = complete_pomodoro_impl(&state).expect("complete first");

        let _ = start_pomodoro_impl(&state, generated[1].id.clone(), None).expect("start second");
        let _ = advance_pomodoro_impl(&state).expect("advance second");
        let _ = complete_pomodoro_impl(&state).expect("complete second");

        let summary = get_reflection_summary_impl(&state, None, None).expect("summary");

        assert_eq!(summary.logs.len() as u32, summary.completed_count + summary.interrupted_count);
        assert!(summary.total_focus_minutes >= 0);
    }

    #[tokio::test]
    async fn property_17_interruption_reason_and_time_are_logged_on_pause() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");

        let _ = start_pomodoro_impl(&state, generated[0].id.clone(), None).expect("start");
        let _ = pause_pomodoro_impl(&state, Some("meeting".to_string())).expect("pause");
        let summary = get_reflection_summary_impl(&state, None, None).expect("summary");
        let paused_log = summary
            .logs
            .iter()
            .find(|log| log.interruption_reason.as_deref() == Some("meeting"))
            .expect("paused log");

        assert_eq!(paused_log.phase, "focus");
        assert!(paused_log.end_time.is_some());
    }

    #[tokio::test]
    async fn generate_to_confirm_stays_within_target_for_dense_calendar() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let date = "2026-02-16";
        let day = NaiveDate::parse_from_str(date, "%Y-%m-%d").expect("valid date");
        let day_start = Utc.from_utc_datetime(&day.and_hms_opt(0, 0, 0).expect("midnight"));

        let synced_events = (0..2_000)
            .map(|index| {
                let start = day_start + Duration::minutes(index as i64);
                let end = start + Duration::seconds(30);
                GoogleCalendarEvent {
                    id: Some(format!("evt-{index}")),
                    summary: Some("busy".to_string()),
                    description: None,
                    status: Some("confirmed".to_string()),
                    updated: None,
                    etag: None,
                    start: CalendarEventDateTime {
                        date_time: start.to_rfc3339(),
                        time_zone: None,
                    },
                    end: CalendarEventDateTime {
                        date_time: end.to_rfc3339(),
                        time_zone: None,
                    },
                    extended_properties: None,
                }
            })
            .collect::<Vec<_>>();

        {
            let mut runtime = lock_runtime(&state).expect("runtime lock");
            runtime
                .synced_events_by_account
                .insert(DEFAULT_ACCOUNT_ID.to_string(), synced_events);
        }

        let started = Instant::now();
        let _generated = generate_blocks_impl(&state, date.to_string(), None)
            .await
            .expect("generate blocks");
        let _listed = list_blocks_impl(&state, Some(date.to_string())).expect("list blocks");
        let elapsed_ms = started.elapsed().as_millis();
        assert!(
            elapsed_ms < BLOCK_GENERATION_TARGET_MS,
            "generate-to-confirm exceeded target: {elapsed_ms}ms"
        );
    }

    #[tokio::test]
    async fn property_8_generated_blocks_do_not_overlap_existing_events() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        {
            let mut runtime = lock_runtime(&state).expect("runtime lock");
            runtime.synced_events_by_account.insert(
                DEFAULT_ACCOUNT_ID.to_string(),
                vec![GoogleCalendarEvent {
                    id: Some("evt-busy".to_string()),
                    summary: Some("Busy".to_string()),
                    description: None,
                    status: Some("confirmed".to_string()),
                    updated: None,
                    etag: None,
                    start: CalendarEventDateTime {
                        date_time: "2026-02-16T10:00:00Z".to_string(),
                        time_zone: None,
                    },
                    end: CalendarEventDateTime {
                        date_time: "2026-02-16T11:00:00Z".to_string(),
                        time_zone: None,
                    },
                    extended_properties: None,
                }],
            );
        }

        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        let busy = Interval {
            start: DateTime::parse_from_rfc3339("2026-02-16T10:00:00Z")
                .expect("busy start")
                .with_timezone(&Utc),
            end: DateTime::parse_from_rfc3339("2026-02-16T11:00:00Z")
                .expect("busy end")
                .with_timezone(&Utc),
        };

        assert!(!generated.is_empty(), "expected blocks outside busy window");
        assert!(generated.iter().all(|block| {
            !intervals_overlap(
                &Interval {
                    start: block.start_at,
                    end: block.end_at,
                },
                &busy,
            )
        }));
    }

    #[tokio::test]
    async fn property_9_generated_blocks_stay_within_work_hours() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();

        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");

        assert!(!generated.is_empty(), "expected default workday blocks");
        assert!(generated.iter().all(|block| {
            let start = block.start_at.time();
            let end = block.end_at.time();
            start >= NaiveTime::from_hms_opt(9, 0, 0).expect("9am")
                && end <= NaiveTime::from_hms_opt(18, 0, 0).expect("6pm")
        }));
    }

    #[tokio::test]
    async fn property_11_generation_is_prevented_for_overlapping_time_bands() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        {
            let mut runtime = lock_runtime(&state).expect("runtime lock");
            runtime.synced_events_by_account.insert(
                DEFAULT_ACCOUNT_ID.to_string(),
                vec![GoogleCalendarEvent {
                    id: Some("evt-full-day".to_string()),
                    summary: Some("Occupied".to_string()),
                    description: None,
                    status: Some("confirmed".to_string()),
                    updated: None,
                    etag: None,
                    start: CalendarEventDateTime {
                        date_time: "2026-02-16T09:00:00Z".to_string(),
                        time_zone: None,
                    },
                    end: CalendarEventDateTime {
                        date_time: "2026-02-16T18:00:00Z".to_string(),
                        time_zone: None,
                    },
                    extended_properties: None,
                }],
            );
        }

        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");

        assert!(generated.is_empty(), "full-day overlap should block generation");
    }

    #[test]
    fn list_synced_events_filters_by_window_and_ignores_cancelled_events() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        {
            let mut runtime = lock_runtime(&state).expect("runtime lock");
            runtime.synced_events_by_account.insert(
                DEFAULT_ACCOUNT_ID.to_string(),
                vec![
                GoogleCalendarEvent {
                    id: Some("evt-confirmed".to_string()),
                    summary: Some("Deep Work".to_string()),
                    description: None,
                    status: Some("confirmed".to_string()),
                    updated: None,
                    etag: None,
                    start: CalendarEventDateTime {
                        date_time: "2026-02-16T09:00:00Z".to_string(),
                        time_zone: None,
                    },
                    end: CalendarEventDateTime {
                        date_time: "2026-02-16T10:00:00Z".to_string(),
                        time_zone: None,
                    },
                    extended_properties: None,
                },
                GoogleCalendarEvent {
                    id: Some("evt-cancelled".to_string()),
                    summary: Some("Cancelled".to_string()),
                    description: None,
                    status: Some("cancelled".to_string()),
                    updated: None,
                    etag: None,
                    start: CalendarEventDateTime {
                        date_time: "2026-02-16T12:00:00Z".to_string(),
                        time_zone: None,
                    },
                    end: CalendarEventDateTime {
                        date_time: "2026-02-16T13:00:00Z".to_string(),
                        time_zone: None,
                    },
                    extended_properties: None,
                },
            ],
            );
        }

        let listed = crate::application::commands::calendar::list_synced_events_impl(
            &state,
            None,
            Some("2026-02-16T00:00:00Z".to_string()),
            Some("2026-02-17T00:00:00Z".to_string()),
        )
        .expect("list synced events");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].account_id, DEFAULT_ACCOUNT_ID);
        assert_eq!(listed[0].id, "evt-confirmed");
        assert_eq!(listed[0].title, "Deep Work");
        assert_eq!(listed[0].start_at, "2026-02-16T09:00:00+00:00");
        assert_eq!(listed[0].end_at, "2026-02-16T10:00:00+00:00");
    }
}
