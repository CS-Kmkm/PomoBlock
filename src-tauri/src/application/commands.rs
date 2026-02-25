use crate::application::bootstrap::bootstrap_workspace;
use crate::application::calendar_setup::{BlocksCalendarInitializer, EnsureBlocksCalendarResult};
use crate::application::calendar_sync::CalendarSyncService;
use crate::application::oauth::{EnsureTokenResult, OAuthConfig, OAuthManager};
use crate::domain::models::{
    Block, BlockType, Firmness, PomodoroLog, PomodoroPhase, Task, TaskStatus,
};
use crate::infrastructure::calendar_cache::InMemoryCalendarCacheRepository;
use crate::infrastructure::config::{ensure_default_configs, read_timezone};
use crate::infrastructure::credential_store::WindowsCredentialManagerStore;
use crate::infrastructure::error::InfraError;
use crate::infrastructure::event_mapper::{encode_block_event, GoogleCalendarEvent};
use crate::infrastructure::google_calendar_client::ReqwestGoogleCalendarClient;
use crate::infrastructure::oauth_client::ReqwestOAuthClient;
use crate::infrastructure::storage::initialize_database;
use crate::infrastructure::sync_state_repository::SqliteSyncStateRepository;
use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveTime, TimeZone, Utc, Weekday};
use chrono_tz::Tz;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration as StdDuration, Instant};
use tokio::task::JoinSet;
use url::Url;

const DEFAULT_REDIRECT_URI: &str = "http://127.0.0.1:8080/oauth2/callback";
const DEFAULT_SCOPE: &str = "https://www.googleapis.com/auth/calendar";
const DEFAULT_ACCOUNT_ID: &str = "default";
const POMODORO_FOCUS_SECONDS: u32 = 25 * 60;
const POMODORO_BREAK_SECONDS: u32 = 5 * 60;
const MIN_POMODORO_BREAK_SECONDS: u32 = 60;
const DEFAULT_MAX_AUTO_BLOCKS_PER_DAY: u32 = 24;
const DEFAULT_MAX_RELOCATIONS_PER_SYNC: u32 = 50;
const BLOCK_CREATION_CONCURRENCY: usize = 4;
const BLOCK_GENERATION_TARGET_MS: u128 = 30_000;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn next_id(prefix: &str) -> String {
    let sequence = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{}-{sequence}", Utc::now().timestamp_micros())
}

fn normalize_account_id(raw: Option<String>) -> String {
    raw.as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| DEFAULT_ACCOUNT_ID.to_string())
}

pub struct AppState {
    config_dir: PathBuf,
    database_path: PathBuf,
    logs_dir: PathBuf,
    calendar_cache: Arc<InMemoryCalendarCacheRepository>,
    runtime: Mutex<RuntimeState>,
    log_guard: Mutex<()>,
}

impl AppState {
    pub fn new(workspace_root: PathBuf) -> Result<Self, InfraError> {
        let bootstrap = bootstrap_workspace(&workspace_root)?;
        let config_dir = workspace_root.join("config");
        let logs_dir = workspace_root.join("logs");

        ensure_default_configs(&config_dir)?;
        initialize_database(&bootstrap.database_path)?;

        Ok(Self {
            config_dir,
            database_path: bootstrap.database_path,
            logs_dir,
            calendar_cache: Arc::new(InMemoryCalendarCacheRepository::default()),
            runtime: Mutex::new(RuntimeState::default()),
            log_guard: Mutex::new(()),
        })
    }

    pub fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    pub fn command_error(&self, command: &str, error: &InfraError) -> String {
        self.log_error(command, &error.to_string());
        error.to_string()
    }

    pub fn log_info(&self, command: &str, message: &str) {
        self.append_log("info", command, message);
    }

    pub fn log_error(&self, command: &str, message: &str) {
        self.append_log("error", command, message);
    }

    fn append_log(&self, level: &str, command: &str, message: &str) {
        let Ok(_guard) = self.log_guard.lock() else {
            return;
        };
        let path = self.logs_dir.join("commands.log");
        let payload = serde_json::json!({
            "timestamp": Utc::now().to_rfc3339(),
            "level": level,
            "command": command,
            "message": message,
        });

        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{}", payload);
        }
    }
}

#[derive(Debug, Default)]
struct RuntimeState {
    blocks: HashMap<String, StoredBlock>,
    tasks: HashMap<String, Task>,
    task_order: Vec<String>,
    task_assignments_by_task: HashMap<String, String>,
    task_assignments_by_block: HashMap<String, String>,
    synced_events_by_account: HashMap<String, Vec<GoogleCalendarEvent>>,
    blocks_calendar_ids: HashMap<String, String>,
    pomodoro: PomodoroRuntimeState,
}

#[derive(Debug, Clone)]
struct StoredBlock {
    block: Block,
    calendar_event_id: Option<String>,
    calendar_account_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PomodoroRuntimePhase {
    Idle,
    Focus,
    Break,
    Paused,
}

impl PomodoroRuntimePhase {
    fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Focus => "focus",
            Self::Break => "break",
            Self::Paused => "paused",
        }
    }
}

#[derive(Debug, Clone)]
struct PomodoroRuntimeState {
    current_block_id: Option<String>,
    current_task_id: Option<String>,
    phase: PomodoroRuntimePhase,
    paused_phase: Option<PomodoroRuntimePhase>,
    remaining_seconds: u32,
    start_time: Option<DateTime<Utc>>,
    total_cycles: u32,
    completed_cycles: u32,
    current_cycle: u32,
    focus_seconds: u32,
    break_seconds: u32,
    active_log: Option<PomodoroLog>,
    completed_logs: Vec<PomodoroLog>,
}

impl Default for PomodoroRuntimeState {
    fn default() -> Self {
        Self {
            current_block_id: None,
            current_task_id: None,
            phase: PomodoroRuntimePhase::Idle,
            paused_phase: None,
            remaining_seconds: 0,
            start_time: None,
            total_cycles: 0,
            completed_cycles: 0,
            current_cycle: 0,
            focus_seconds: POMODORO_FOCUS_SECONDS,
            break_seconds: POMODORO_BREAK_SECONDS,
            active_log: None,
            completed_logs: Vec::new(),
        }
    }
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

#[derive(Debug, Clone, Serialize)]
pub struct SyncCalendarResponse {
    pub account_id: String,
    pub added: usize,
    pub updated: usize,
    pub deleted: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_sync_token: Option<String>,
    pub calendar_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SyncedEventSlotResponse {
    pub account_id: String,
    pub id: String,
    pub title: String,
    pub start_at: String,
    pub end_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PomodoroStateResponse {
    pub current_block_id: Option<String>,
    pub current_task_id: Option<String>,
    pub phase: String,
    pub remaining_seconds: u32,
    pub start_time: Option<String>,
    pub total_cycles: u32,
    pub completed_cycles: u32,
    pub current_cycle: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReflectionLogItem {
    pub id: String,
    pub block_id: String,
    pub task_id: Option<String>,
    pub phase: String,
    pub start_time: String,
    pub end_time: Option<String>,
    pub interruption_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReflectionSummaryResponse {
    pub start: String,
    pub end: String,
    pub completed_count: u32,
    pub interrupted_count: u32,
    pub total_focus_minutes: i64,
    pub logs: Vec<ReflectionLogItem>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CarryOverTaskResponse {
    pub task_id: String,
    pub from_block_id: String,
    pub to_block_id: String,
    pub status: String,
}

#[derive(Debug, Clone)]
struct RuntimePolicy {
    work_start: NaiveTime,
    work_end: NaiveTime,
    work_days: HashSet<Weekday>,
    timezone: Tz,
    auto_enabled: bool,
    catch_up_on_app_start: bool,
    block_duration_minutes: u32,
    break_duration_minutes: u32,
    min_block_gap_minutes: u32,
    max_auto_blocks_per_day: u32,
    max_relocations_per_sync: u32,
    respect_suppression: bool,
}

impl Default for RuntimePolicy {
    fn default() -> Self {
        Self {
            work_start: NaiveTime::from_hms_opt(9, 0, 0).expect("valid fixed time"),
            work_end: NaiveTime::from_hms_opt(18, 0, 0).expect("valid fixed time"),
            work_days: HashSet::from([
                Weekday::Mon,
                Weekday::Tue,
                Weekday::Wed,
                Weekday::Thu,
                Weekday::Fri,
            ]),
            timezone: Tz::UTC,
            auto_enabled: true,
            catch_up_on_app_start: true,
            block_duration_minutes: 60,
            break_duration_minutes: 5,
            min_block_gap_minutes: 0,
            max_auto_blocks_per_day: DEFAULT_MAX_AUTO_BLOCKS_PER_DAY,
            max_relocations_per_sync: DEFAULT_MAX_RELOCATIONS_PER_SYNC,
            respect_suppression: true,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct PomodoroSessionPlan {
    total_cycles: u32,
    focus_seconds: u32,
    break_seconds: u32,
}

#[derive(Debug, Clone)]
struct Interval {
    start: DateTime<Utc>,
    end: DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct BlockPlan {
    instance: String,
    start_at: DateTime<Utc>,
    end_at: DateTime<Utc>,
    block_type: BlockType,
    firmness: Firmness,
    planned_pomodoros: i32,
    source: String,
    source_id: Option<String>,
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
        &oauth_config.redirect_uri,
        &auth_state,
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
    redirect_uri: &str,
    expected_state: &str,
    timeout: StdDuration,
) -> impl FnOnce() -> Result<String, InfraError> {
    let redirect = parse_loopback_redirect(redirect_uri);
    let expected_state = expected_state.to_string();
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
            "Google sign-in failed. Return to PomBlock and retry.",
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
                "Invalid sign-in state. Return to PomBlock and retry.",
            );
            return Ok(Some(Err(InfraError::OAuth(
                "oauth callback state mismatch".to_string(),
            ))));
        }
        None => {
            write_callback_response(
                &mut stream,
                400,
                "Missing sign-in state. Return to PomBlock and retry.",
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
            "Missing authorization code. Return to PomBlock and retry.",
        );
        return Ok(Some(Err(InfraError::OAuth(
            "oauth callback missing authorization code".to_string(),
        ))));
    };

    write_callback_response(
        &mut stream,
        200,
        "Sign-in complete. You can close this tab and return to PomBlock.",
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

pub async fn sync_calendar_impl(
    state: &AppState,
    account_id: Option<String>,
    time_min: Option<String>,
    time_max: Option<String>,
) -> Result<SyncCalendarResponse, InfraError> {
    let started_at = Instant::now();
    let account_id = normalize_account_id(account_id);
    let policy = load_runtime_policy(state.config_dir());
    let access_token = required_access_token(Some(account_id.clone())).await?;
    let (window_start, window_end) = resolve_sync_window(time_min, time_max)?;
    let calendar_client = Arc::new(ReqwestGoogleCalendarClient::new());
    let calendar_id = ensure_blocks_calendar_id(
        state.config_dir(),
        &access_token,
        Arc::clone(&calendar_client),
        &account_id,
    )
    .await?;

    let sync_state_repo = Arc::new(SqliteSyncStateRepository::new(state.database_path()));
    let sync_service = CalendarSyncService::new(
        Arc::clone(&calendar_client),
        sync_state_repo,
        Arc::clone(&state.calendar_cache),
    );
    let sync_result = sync_service
        .sync(&access_token, &calendar_id, window_start, window_end)
        .await?;
    if !sync_result.suppressed_instances.is_empty() {
        save_suppressions(
            state.database_path(),
            &sync_result.suppressed_instances,
            Some("calendar_cancelled"),
        )?;
    }
    let latest_events = sync_service
        .fetch_events(&access_token, &calendar_id, window_start, window_end)
        .await?;

    let previous_account_events = {
        let mut runtime = lock_runtime(state)?;
        let previous = runtime
            .synced_events_by_account
            .get(&account_id)
            .cloned()
            .unwrap_or_default();
        runtime
            .synced_events_by_account
            .insert(account_id.clone(), latest_events);
        runtime
            .blocks_calendar_ids
            .insert(account_id.clone(), calendar_id.clone());
        previous
    };
    let mut changed_intervals = Vec::new();
    for event in sync_result.added.iter().chain(sync_result.updated.iter()) {
        if let Some(interval) = event_to_interval(event)
            .and_then(|interval| clip_interval(interval, window_start, window_end))
        {
            changed_intervals.push(interval);
        }
    }
    if !sync_result.deleted.is_empty() {
        let deleted_ids = sync_result
            .deleted
            .iter()
            .map(String::as_str)
            .collect::<HashSet<_>>();
        for event in &previous_account_events {
            let Some(event_id) = event
                .id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            if !deleted_ids.contains(event_id) {
                continue;
            }
            if let Some(interval) = event_to_interval(event)
                .and_then(|interval| clip_interval(interval, window_start, window_end))
            {
                changed_intervals.push(interval);
            }
        }
    }
    let changed_intervals = merge_intervals(changed_intervals);
    let relocated_count = auto_relocate_after_sync(
        state,
        account_id.as_str(),
        &changed_intervals,
        policy.max_relocations_per_sync,
    )
    .await?;
    if relocated_count > 0 {
        let refreshed_events = sync_service
            .fetch_events(&access_token, &calendar_id, window_start, window_end)
            .await?;
        let mut runtime = lock_runtime(state)?;
        runtime
            .synced_events_by_account
            .insert(account_id.clone(), refreshed_events);
    }

    state.log_info(
        "sync_calendar",
        &format!(
            "synchronized account_id={account_id} calendar_id={calendar_id} added={} updated={} deleted={} suppressed={} relocated={} elapsed_ms={}",
            sync_result.added.len(),
            sync_result.updated.len(),
            sync_result.deleted.len(),
            sync_result.suppressed_instances.len(),
            relocated_count,
            started_at.elapsed().as_millis()
        ),
    );

    Ok(SyncCalendarResponse {
        account_id,
        added: sync_result.added.len(),
        updated: sync_result.updated.len(),
        deleted: sync_result.deleted.len(),
        next_sync_token: sync_result.next_sync_token,
        calendar_id,
    })
}

pub async fn generate_blocks_impl(
    state: &AppState,
    date: String,
    account_id: Option<String>,
) -> Result<Vec<Block>, InfraError> {
    generate_blocks_with_limit_impl(state, date, account_id, None, false).await
}

pub async fn generate_one_block_impl(
    state: &AppState,
    date: String,
    account_id: Option<String>,
) -> Result<Vec<Block>, InfraError> {
    generate_blocks_with_limit_impl(state, date, account_id, Some(1), true).await
}

async fn generate_blocks_with_limit_impl(
    state: &AppState,
    date: String,
    account_id: Option<String>,
    generation_limit: Option<usize>,
    allow_overlap: bool,
) -> Result<Vec<Block>, InfraError> {
    let started_at = Instant::now();
    let account_id = normalize_account_id(account_id);
    let date = NaiveDate::parse_from_str(date.trim(), "%Y-%m-%d")
        .map_err(|error| InfraError::InvalidConfig(format!("date must be YYYY-MM-DD: {error}")))?;
    let policy = load_runtime_policy(state.config_dir());
    let max_generated_blocks = generation_limit.unwrap_or(usize::MAX);
    if max_generated_blocks == 0 {
        return Ok(Vec::new());
    }
    if !policy.work_days.contains(&date.weekday()) {
        return Ok(Vec::new());
    }
    if policy.work_end <= policy.work_start {
        return Ok(Vec::new());
    }

    let window_start = local_datetime_to_utc(date, policy.work_start, policy.timezone)?;
    let window_end = local_datetime_to_utc(date, policy.work_end, policy.timezone)?;
    let block_duration = Duration::minutes(policy.block_duration_minutes as i64);
    let gap = Duration::minutes(policy.min_block_gap_minutes as i64);

    let (existing_blocks, synced_events_by_account, mut blocks_calendar_ids) = {
        let runtime = lock_runtime(state)?;
        (
            runtime
                .blocks
                .values()
                .filter(|stored| stored.block.date == date.to_string())
                .cloned()
                .collect::<Vec<_>>(),
            runtime.synced_events_by_account.clone(),
            runtime.blocks_calendar_ids.clone(),
        )
    };
    let cleared_user_deleted_suppressions = if policy.respect_suppression && existing_blocks.is_empty()
    {
        clear_user_deleted_suppressions_for_date(state.database_path(), date)?
    } else {
        0
    };
    let suppressed_instances = if policy.respect_suppression {
        load_suppressions(state.database_path())?
    } else {
        HashSet::new()
    };

    let mut busy_intervals = Vec::new();
    for events in synced_events_by_account.values() {
        for event in events {
            if let Some(interval) = event_to_interval(event)
                .and_then(|interval| clip_interval(interval, window_start, window_end))
            {
                busy_intervals.push(interval);
            }
        }
    }
    for stored in &existing_blocks {
        busy_intervals.push(Interval {
            start: stored.block.start_at,
            end: stored.block.end_at,
        });
    }
    let busy_intervals = merge_intervals(busy_intervals);
    let busy_interval_count = busy_intervals.len();
    let mut occupied_intervals = busy_intervals.clone();

    let mut existing_instances = existing_blocks
        .iter()
        .map(|stored| stored.block.instance.clone())
        .collect::<HashSet<_>>();
    let mut existing_ranges = existing_blocks
        .iter()
        .map(|stored| {
            (
                stored.block.start_at.timestamp_millis(),
                stored.block.end_at.timestamp_millis(),
            )
        })
        .collect::<HashSet<_>>();
    let mut generated = Vec::new();
    let candidate_plans = load_configured_block_plans(state.config_dir(), date, &policy);
    let candidate_plan_count = candidate_plans.len();

    for plan in candidate_plans {
        if generated.len() >= max_generated_blocks {
            break;
        }
        if plan.end_at <= plan.start_at {
            continue;
        }
        if plan.start_at < window_start || plan.end_at > window_end {
            continue;
        }
        let interval = Interval {
            start: plan.start_at,
            end: plan.end_at,
        };
        if !allow_overlap
            && occupied_intervals
                .iter()
                .any(|busy| intervals_overlap(busy, &interval))
        {
            continue;
        }

        let range_key = (
            plan.start_at.timestamp_millis(),
            plan.end_at.timestamp_millis(),
        );
        let is_suppressed = !allow_overlap
            && policy.respect_suppression
            && suppressed_instances.contains(plan.instance.as_str());

        if !is_suppressed
            && (allow_overlap
                || (existing_instances.insert(plan.instance.clone())
                    && existing_ranges.insert(range_key)))
        {
            let block = Block {
                id: next_id("blk"),
                instance: plan.instance,
                date: date.to_string(),
                start_at: plan.start_at,
                end_at: plan.end_at,
                block_type: plan.block_type,
                firmness: plan.firmness,
                planned_pomodoros: plan.planned_pomodoros,
                source: plan.source,
                source_id: plan.source_id,
            };
            generated.push(StoredBlock {
                block,
                calendar_event_id: None,
                calendar_account_id: Some(account_id.clone()),
            });
            occupied_intervals.push(interval);
            if generated.len() >= max_generated_blocks {
                break;
            }
        }
    }

    let occupied_intervals = merge_intervals(occupied_intervals);
    let max_auto_blocks_per_day = policy.max_auto_blocks_per_day as usize;
    let used_capacity = existing_blocks.len().saturating_add(generated.len());
    let mut remaining_auto_capacity = if allow_overlap {
        max_generated_blocks.saturating_sub(generated.len())
    } else {
        max_auto_blocks_per_day.saturating_sub(used_capacity)
    };
    let mut remaining_generation_capacity = max_generated_blocks.saturating_sub(generated.len());
    let auto_instance_prefix = format!("rtn:auto:{}:", date);
    let mut instance_index: u32 = existing_instances
        .iter()
        .filter_map(|instance| instance.strip_prefix(auto_instance_prefix.as_str()))
        .filter_map(|suffix| suffix.parse::<u32>().ok())
        .max()
        .map(|max_index| max_index.saturating_add(1))
        .unwrap_or(0);
    let auto_slots = if allow_overlap {
        vec![Interval {
            start: window_start,
            end: window_end,
        }]
    } else {
        free_slots(window_start, window_end, &occupied_intervals)
    };
    let mut auto_generated_count = 0usize;
    for slot in auto_slots {
        if remaining_auto_capacity == 0 || remaining_generation_capacity == 0 {
            break;
        }
        let mut cursor = slot.start;
        while cursor + block_duration <= slot.end
            && remaining_auto_capacity > 0
            && remaining_generation_capacity > 0
        {
            let candidate_end = cursor + block_duration;
            let plan = BlockPlan {
                instance: format!("rtn:auto:{}:{}", date, instance_index),
                start_at: cursor,
                end_at: candidate_end,
                block_type: BlockType::Deep,
                firmness: Firmness::Draft,
                planned_pomodoros: planned_pomodoros(
                    policy.block_duration_minutes,
                    policy.break_duration_minutes,
                ),
                source: "routine".to_string(),
                source_id: Some("auto".to_string()),
            };
            instance_index = instance_index.saturating_add(1);

            let range_key = (
                plan.start_at.timestamp_millis(),
                plan.end_at.timestamp_millis(),
            );
            let is_suppressed = !allow_overlap
                && policy.respect_suppression
                && suppressed_instances.contains(plan.instance.as_str());

            if !is_suppressed
                && (allow_overlap
                    || (existing_instances.insert(plan.instance.clone())
                        && existing_ranges.insert(range_key)))
            {
                let block = Block {
                    id: next_id("blk"),
                    instance: plan.instance,
                    date: date.to_string(),
                    start_at: plan.start_at,
                    end_at: plan.end_at,
                    block_type: plan.block_type,
                    firmness: plan.firmness,
                    planned_pomodoros: plan.planned_pomodoros,
                    source: plan.source,
                    source_id: plan.source_id,
                };
                generated.push(StoredBlock {
                    block,
                    calendar_event_id: None,
                    calendar_account_id: Some(account_id.clone()),
                });
                auto_generated_count = auto_generated_count.saturating_add(1);
                remaining_auto_capacity = remaining_auto_capacity.saturating_sub(1);
                remaining_generation_capacity = remaining_generation_capacity.saturating_sub(1);
            }

            cursor = candidate_end + gap;
        }
    }

    if generated.is_empty() {
        return Ok(Vec::new());
    }

    let access_token = try_access_token(Some(account_id.clone())).await?;
    if !blocks_calendar_ids.contains_key(&account_id) {
        if let Some(token) = access_token.as_deref() {
            let calendar_client = Arc::new(ReqwestGoogleCalendarClient::new());
            let resolved = ensure_blocks_calendar_id(
                state.config_dir(),
                token,
                Arc::clone(&calendar_client),
                &account_id,
            )
            .await?;
            blocks_calendar_ids.insert(account_id.clone(), resolved.clone());
            let mut runtime = lock_runtime(state)?;
            runtime
                .blocks_calendar_ids
                .insert(account_id.clone(), resolved);
        }
    }

    let calendar_id = blocks_calendar_ids.get(&account_id).map(String::as_str);
    if let (Some(token), Some(calendar_id)) = (access_token.as_deref(), calendar_id) {
        let calendar_client = Arc::new(ReqwestGoogleCalendarClient::new());
        let sync_state_repo = Arc::new(SqliteSyncStateRepository::new(state.database_path()));
        let sync_service = Arc::new(CalendarSyncService::new(
            Arc::clone(&calendar_client),
            sync_state_repo,
            Arc::clone(&state.calendar_cache),
        ));
        create_calendar_events_for_generated_blocks(sync_service, token, calendar_id, &mut generated)
            .await?;
    }

    {
        let mut runtime = lock_runtime(state)?;
        if let Some(calendar_id) = blocks_calendar_ids.get(&account_id).cloned() {
            runtime
                .blocks_calendar_ids
                .insert(account_id.clone(), calendar_id);
        }
        for stored in &generated {
            runtime
                .blocks
                .insert(stored.block.id.clone(), stored.clone());
        }
    }

    let elapsed_ms = started_at.elapsed().as_millis();
    state.log_info(
        "generate_blocks",
        &format!(
            "generated_count={} auto_generated_count={} candidate_plan_count={} busy_interval_count={} cleared_user_deleted_suppressions={} elapsed_ms={} date={} account_id={}",
            generated.len(),
            auto_generated_count,
            candidate_plan_count,
            busy_interval_count,
            cleared_user_deleted_suppressions,
            elapsed_ms,
            date,
            account_id
        ),
    );
    if elapsed_ms > BLOCK_GENERATION_TARGET_MS {
        state.log_error(
            "generate_blocks",
            &format!(
                "generation for {} exceeded target {}ms (actual={}ms)",
                date, BLOCK_GENERATION_TARGET_MS, elapsed_ms
            ),
        );
    }

    Ok(generated.into_iter().map(|stored| stored.block).collect())
}

pub async fn approve_blocks_impl(
    state: &AppState,
    block_ids: Vec<String>,
) -> Result<Vec<Block>, InfraError> {
    if block_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut approved_blocks = Vec::new();
    let mut calendar_updates: Vec<(String, String, Block)> = Vec::new();
    {
        let mut runtime = lock_runtime(state)?;
        for raw_id in block_ids {
            let block_id = raw_id.trim();
            if block_id.is_empty() {
                continue;
            }
            let Some(stored) = runtime.blocks.get_mut(block_id) else {
                continue;
            };
            stored.block.firmness = Firmness::Soft;
            approved_blocks.push(stored.block.clone());
            if let Some(calendar_event_id) = stored.calendar_event_id.clone() {
                let account_id = stored
                    .calendar_account_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(DEFAULT_ACCOUNT_ID)
                    .to_string();
                calendar_updates.push((calendar_event_id, account_id, stored.block.clone()));
            }
        }
    }

    if !calendar_updates.is_empty() {
        let calendar_ids = {
            let runtime = lock_runtime(state)?;
            runtime.blocks_calendar_ids.clone()
        };
        let mut access_tokens_by_account: HashMap<String, String> = HashMap::new();
        for (_, account_id, _) in &calendar_updates {
            if access_tokens_by_account.contains_key(account_id) {
                continue;
            }
            if let Some(token) = try_access_token(Some(account_id.clone())).await? {
                access_tokens_by_account.insert(account_id.clone(), token);
            }
        }
        let calendar_client = Arc::new(ReqwestGoogleCalendarClient::new());
        let sync_state_repo = Arc::new(SqliteSyncStateRepository::new(state.database_path()));
        let sync_service = CalendarSyncService::new(
            Arc::clone(&calendar_client),
            sync_state_repo,
            Arc::clone(&state.calendar_cache),
        );
        for (event_id, account_id, block) in &calendar_updates {
            let Some(token) = access_tokens_by_account.get(account_id).map(String::as_str) else {
                continue;
            };
            let Some(calendar_id) = calendar_ids.get(account_id).map(String::as_str) else {
                continue;
            };
            let event = encode_block_event(block);
            sync_service
                .update_event(token, calendar_id, event_id, &event)
                .await?;
        }
    }

    state.log_info(
        "approve_blocks",
        &format!("approved {} blocks", approved_blocks.len()),
    );

    Ok(approved_blocks)
}

pub async fn delete_block_impl(state: &AppState, block_id: String) -> Result<bool, InfraError> {
    let block_id = block_id.trim();
    if block_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "block_id must not be empty".to_string(),
        ));
    }

    let removed = {
        let mut runtime = lock_runtime(state)?;
        let removed = runtime.blocks.remove(block_id);
        if let Some(task_id) = runtime.task_assignments_by_block.remove(block_id) {
            runtime.task_assignments_by_task.remove(task_id.as_str());
            if runtime.pomodoro.current_task_id.as_deref() == Some(task_id.as_str()) {
                runtime.pomodoro.current_task_id = None;
            }
        }
        removed
    };
    let Some(removed) = removed else {
        return Ok(false);
    };
    save_suppression(
        state.database_path(),
        &removed.block.instance,
        Some("user_deleted"),
    )?;

    if let Some(calendar_event_id) = removed.calendar_event_id {
        let account_id = removed
            .calendar_account_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(DEFAULT_ACCOUNT_ID)
            .to_string();
        let access_token = try_access_token(Some(account_id.clone())).await?;
        let calendar_id = {
            let runtime = lock_runtime(state)?;
            runtime.blocks_calendar_ids.get(&account_id).cloned()
        };

        if let (Some(token), Some(calendar_id)) = (access_token.as_deref(), calendar_id.as_deref())
        {
            let calendar_client = Arc::new(ReqwestGoogleCalendarClient::new());
            let sync_state_repo = Arc::new(SqliteSyncStateRepository::new(state.database_path()));
            let sync_service = CalendarSyncService::new(
                Arc::clone(&calendar_client),
                sync_state_repo,
                Arc::clone(&state.calendar_cache),
            );
            sync_service
                .delete_event(token, calendar_id, &calendar_event_id)
                .await?;
        }
    }

    state.log_info("delete_block", &format!("deleted block_id={block_id}"));
    Ok(true)
}

pub async fn adjust_block_time_impl(
    state: &AppState,
    block_id: String,
    start_at: String,
    end_at: String,
) -> Result<Block, InfraError> {
    let block_id = block_id.trim();
    if block_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "block_id must not be empty".to_string(),
        ));
    }
    let start = parse_rfc3339_input(&start_at, "start_at")?;
    let end = parse_rfc3339_input(&end_at, "end_at")?;
    if end <= start {
        return Err(InfraError::InvalidConfig(
            "end_at must be after start_at".to_string(),
        ));
    }

    let (updated_block, calendar_event_id, calendar_account_id) = {
        let mut runtime = lock_runtime(state)?;
        let Some(stored) = runtime.blocks.get_mut(block_id) else {
            return Err(InfraError::InvalidConfig(format!(
                "block not found: {}",
                block_id
            )));
        };
        stored.block.start_at = start;
        stored.block.end_at = end;
        (
            stored.block.clone(),
            stored.calendar_event_id.clone(),
            stored.calendar_account_id.clone(),
        )
    };

    if let Some(calendar_event_id) = calendar_event_id {
        let account_id = calendar_account_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(DEFAULT_ACCOUNT_ID)
            .to_string();
        let access_token = try_access_token(Some(account_id.clone())).await?;
        let calendar_id = {
            let runtime = lock_runtime(state)?;
            runtime.blocks_calendar_ids.get(&account_id).cloned()
        };
        if let (Some(token), Some(calendar_id)) = (access_token.as_deref(), calendar_id.as_deref())
        {
            let calendar_client = Arc::new(ReqwestGoogleCalendarClient::new());
            let sync_state_repo = Arc::new(SqliteSyncStateRepository::new(state.database_path()));
            let sync_service = CalendarSyncService::new(
                Arc::clone(&calendar_client),
                sync_state_repo,
                Arc::clone(&state.calendar_cache),
            );
            let event = encode_block_event(&updated_block);
            sync_service
                .update_event(token, calendar_id, &calendar_event_id, &event)
                .await?;
        }
    }

    state.log_info(
        "adjust_block_time",
        &format!("adjusted block_id={block_id} start={} end={}", start, end),
    );
    Ok(updated_block)
}

pub async fn relocate_if_needed_impl(
    state: &AppState,
    block_id: String,
    account_id: Option<String>,
) -> Result<Option<Block>, InfraError> {
    let block_id = block_id.trim();
    if block_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "block_id must not be empty".to_string(),
        ));
    }

    let requested_account_id = normalize_account_id(account_id);
    let policy = load_runtime_policy(state.config_dir());
    let (
        target_stored_block,
        effective_account_id,
        account_events,
        other_blocks,
        blocks_calendar_ids,
    ) = {
        let runtime = lock_runtime(state)?;
        let Some(stored_block) = runtime.blocks.get(block_id).cloned() else {
            return Err(InfraError::InvalidConfig(format!(
                "block not found: {}",
                block_id
            )));
        };
        let effective_account_id = stored_block
            .calendar_account_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(requested_account_id.as_str())
            .to_string();
        let account_events = runtime
            .synced_events_by_account
            .get(&effective_account_id)
            .cloned()
            .unwrap_or_default();
        let other_blocks = runtime
            .blocks
            .values()
            .filter(|candidate| candidate.block.id != stored_block.block.id)
            .cloned()
            .collect::<Vec<_>>();
        (
            stored_block,
            effective_account_id,
            account_events,
            other_blocks,
            runtime.blocks_calendar_ids.clone(),
        )
    };

    let block = target_stored_block.block.clone();
    let date = NaiveDate::parse_from_str(block.date.trim(), "%Y-%m-%d").map_err(|error| {
        InfraError::InvalidConfig(format!("block date must be YYYY-MM-DD: {error}"))
    })?;
    let window_start = local_datetime_to_utc(date, policy.work_start, policy.timezone)?;
    let window_end = local_datetime_to_utc(date, policy.work_end, policy.timezone)?;
    let current_interval = Interval {
        start: block.start_at,
        end: block.end_at,
    };

    let mut busy_intervals = Vec::new();
    let mut collides_with_synced_events = false;
    for event in &account_events {
        if is_cancelled_event(event) {
            continue;
        }
        let event_id = event
            .id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if event_id == target_stored_block.calendar_event_id.as_deref() {
            continue;
        }
        let Some(interval) = event_to_interval(event)
            .and_then(|interval| clip_interval(interval, window_start, window_end))
        else {
            continue;
        };
        if intervals_overlap(&interval, &current_interval) {
            collides_with_synced_events = true;
        }
        busy_intervals.push(interval);
    }

    if !collides_with_synced_events {
        return Ok(None);
    }

    for other in &other_blocks {
        if other.block.date != block.date {
            continue;
        }
        busy_intervals.push(Interval {
            start: other.block.start_at,
            end: other.block.end_at,
        });
    }

    let busy_intervals = merge_intervals(busy_intervals);
    let slots = free_slots(window_start, window_end, &busy_intervals);
    let duration = current_interval.end - current_interval.start;

    let mut relocated_range = None;
    for slot in slots {
        let candidate_end = slot.start + duration;
        if candidate_end > slot.end {
            continue;
        }
        if slot.start == current_interval.start && candidate_end == current_interval.end {
            continue;
        }
        relocated_range = Some((slot.start, candidate_end));
        break;
    }

    let Some((new_start, new_end)) = relocated_range else {
        state.log_info(
            "relocate_if_needed",
            &format!("manual adjustment required for block_id={block_id}"),
        );
        return Ok(None);
    };

    let (updated_block, calendar_event_id) = {
        let mut runtime = lock_runtime(state)?;
        let Some(stored) = runtime.blocks.get_mut(block_id) else {
            return Err(InfraError::InvalidConfig(format!(
                "block not found: {}",
                block_id
            )));
        };
        stored.block.start_at = new_start;
        stored.block.end_at = new_end;
        (stored.block.clone(), stored.calendar_event_id.clone())
    };

    if let Some(calendar_event_id) = calendar_event_id {
        let access_token = try_access_token(Some(effective_account_id.clone())).await?;
        let calendar_id = blocks_calendar_ids.get(&effective_account_id).cloned();
        if let (Some(token), Some(calendar_id)) = (access_token.as_deref(), calendar_id.as_deref())
        {
            let calendar_client = Arc::new(ReqwestGoogleCalendarClient::new());
            let sync_state_repo = Arc::new(SqliteSyncStateRepository::new(state.database_path()));
            let sync_service = CalendarSyncService::new(
                Arc::clone(&calendar_client),
                sync_state_repo,
                Arc::clone(&state.calendar_cache),
            );
            let event = encode_block_event(&updated_block);
            sync_service
                .update_event(token, calendar_id, &calendar_event_id, &event)
                .await?;
        }
    }

    state.log_info(
        "relocate_if_needed",
        &format!(
            "relocated block_id={} start={} end={} account_id={}",
            updated_block.id, updated_block.start_at, updated_block.end_at, effective_account_id
        ),
    );
    Ok(Some(updated_block))
}

pub fn list_blocks_impl(state: &AppState, date: Option<String>) -> Result<Vec<Block>, InfraError> {
    let normalized_date = date
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let runtime = lock_runtime(state)?;
    let mut blocks = runtime
        .blocks
        .values()
        .map(|stored| stored.block.clone())
        .filter(|block| {
            normalized_date
                .as_deref()
                .map(|date| block.date == date)
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();
    blocks.sort_by(|left, right| left.start_at.cmp(&right.start_at));
    Ok(blocks)
}

pub fn list_synced_events_impl(
    state: &AppState,
    account_id: Option<String>,
    time_min: Option<String>,
    time_max: Option<String>,
) -> Result<Vec<SyncedEventSlotResponse>, InfraError> {
    let (window_start, window_end) = resolve_sync_window(time_min, time_max)?;
    let requested_account = account_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| normalize_account_id(Some(value.to_string())));
    let runtime = lock_runtime(state)?;
    let mut events = Vec::new();
    let mut append_events = |current_account_id: &str, account_events: &[GoogleCalendarEvent]| {
        for event in account_events {
            let is_cancelled = event
                .status
                .as_deref()
                .map(|status| status.eq_ignore_ascii_case("cancelled"))
                .unwrap_or(false);
            if is_cancelled {
                continue;
            }

            let Some(interval) = event_to_interval(event) else {
                continue;
            };
            if interval.end <= window_start || interval.start >= window_end {
                continue;
            }

            let event_id = event
                .id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| format!("evt-{}", interval.start.timestamp_micros()));
            let title = event
                .summary
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| "Busy".to_string());
            events.push((
                interval.start,
                SyncedEventSlotResponse {
                    account_id: current_account_id.to_string(),
                    id: event_id,
                    title,
                    start_at: interval.start.to_rfc3339(),
                    end_at: interval.end.to_rfc3339(),
                },
            ));
        }
    };
    if let Some(account_id) = requested_account {
        if let Some(account_events) = runtime.synced_events_by_account.get(&account_id) {
            append_events(&account_id, account_events);
        }
    } else {
        for (account_id, account_events) in &runtime.synced_events_by_account {
            append_events(account_id, account_events);
        }
    }

    events.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(events.into_iter().map(|(_, event)| event).collect())
}

pub fn create_task_impl(
    state: &AppState,
    title: String,
    description: Option<String>,
    estimated_pomodoros: Option<u32>,
) -> Result<Task, InfraError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(InfraError::InvalidConfig(
            "title must not be empty".to_string(),
        ));
    }

    let task = Task {
        id: next_id("tsk"),
        title: title.to_string(),
        description: description
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned),
        estimated_pomodoros,
        completed_pomodoros: 0,
        status: TaskStatus::Pending,
        created_at: Utc::now(),
    };

    {
        let mut runtime = lock_runtime(state)?;
        runtime.task_order.push(task.id.clone());
        runtime.tasks.insert(task.id.clone(), task.clone());
    }

    state.log_info("create_task", &format!("created task_id={}", task.id));
    Ok(task)
}

pub fn list_tasks_impl(state: &AppState) -> Result<Vec<Task>, InfraError> {
    let runtime = lock_runtime(state)?;
    let mut tasks = runtime
        .task_order
        .iter()
        .filter_map(|task_id| runtime.tasks.get(task_id).cloned())
        .collect::<Vec<_>>();
    tasks.sort_by(|left, right| left.created_at.cmp(&right.created_at));
    Ok(tasks)
}

pub fn update_task_impl(
    state: &AppState,
    task_id: String,
    title: Option<String>,
    description: Option<String>,
    estimated_pomodoros: Option<u32>,
    status: Option<String>,
) -> Result<Task, InfraError> {
    let task_id = task_id.trim();
    if task_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "task_id must not be empty".to_string(),
        ));
    }

    let mut runtime = lock_runtime(state)?;
    let Some(task) = runtime.tasks.get_mut(task_id) else {
        return Err(InfraError::InvalidConfig(format!("task not found: {}", task_id)));
    };

    if let Some(title) = title {
        let title = title.trim();
        if title.is_empty() {
            return Err(InfraError::InvalidConfig(
                "title must not be empty".to_string(),
            ));
        }
        task.title = title.to_string();
    }

    if let Some(description) = description {
        let description = description.trim();
        task.description = if description.is_empty() {
            None
        } else {
            Some(description.to_string())
        };
    }

    if let Some(estimated) = estimated_pomodoros {
        task.estimated_pomodoros = Some(estimated);
    }

    if let Some(status) = status {
        task.status = parse_task_status(&status)?;
    }

    let updated = task.clone();
    drop(runtime);
    state.log_info("update_task", &format!("updated task_id={task_id}"));
    Ok(updated)
}

pub fn delete_task_impl(state: &AppState, task_id: String) -> Result<bool, InfraError> {
    let task_id = task_id.trim();
    if task_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "task_id must not be empty".to_string(),
        ));
    }

    let mut runtime = lock_runtime(state)?;
    let removed = runtime.tasks.remove(task_id).is_some();
    if !removed {
        return Ok(false);
    }
    runtime.task_order.retain(|candidate| candidate != task_id);
    unassign_task(&mut runtime, task_id);
    if runtime.pomodoro.current_task_id.as_deref() == Some(task_id) {
        runtime.pomodoro.current_task_id = None;
    }

    state.log_info("delete_task", &format!("deleted task_id={task_id}"));
    Ok(true)
}

pub fn split_task_impl(state: &AppState, task_id: String, parts: u32) -> Result<Vec<Task>, InfraError> {
    let task_id = task_id.trim();
    if task_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "task_id must not be empty".to_string(),
        ));
    }
    if parts < 2 {
        return Err(InfraError::InvalidConfig("parts must be >= 2".to_string()));
    }

    let mut runtime = lock_runtime(state)?;
    let Some(parent) = runtime.tasks.get_mut(task_id) else {
        return Err(InfraError::InvalidConfig(format!("task not found: {}", task_id)));
    };
    let parent_title = parent.title.clone();
    let parent_description = parent.description.clone();
    let child_estimated_pomodoros = parent
        .estimated_pomodoros
        .map(|value| value.div_ceil(parts).max(1));
    parent.status = TaskStatus::Deferred;

    if runtime.pomodoro.current_task_id.as_deref() == Some(task_id) {
        runtime.pomodoro.current_task_id = None;
    }
    unassign_task(&mut runtime, task_id);

    let mut children = Vec::new();
    let now = Utc::now();
    for index in 1..=parts {
        let child = Task {
            id: next_id("tsk"),
            title: format!("{parent_title} ({index}/{parts})"),
            description: parent_description.clone(),
            estimated_pomodoros: child_estimated_pomodoros,
            completed_pomodoros: 0,
            status: TaskStatus::Pending,
            created_at: now,
        };
        runtime.task_order.push(child.id.clone());
        runtime.tasks.insert(child.id.clone(), child.clone());
        children.push(child);
    }

    drop(runtime);
    state.log_info(
        "split_task",
        &format!("split task_id={task_id} into {} children", children.len()),
    );
    Ok(children)
}

pub fn carry_over_task_impl(
    state: &AppState,
    task_id: String,
    from_block_id: String,
    candidate_block_ids: Option<Vec<String>>,
) -> Result<CarryOverTaskResponse, InfraError> {
    let task_id = task_id.trim();
    if task_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "task_id must not be empty".to_string(),
        ));
    }
    let from_block_id = from_block_id.trim();
    if from_block_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "from_block_id must not be empty".to_string(),
        ));
    }

    let normalized_candidates = candidate_block_ids
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<HashSet<_>>();

    let mut runtime = lock_runtime(state)?;
    if !runtime.tasks.contains_key(task_id) {
        return Err(InfraError::InvalidConfig(format!("task not found: {}", task_id)));
    }
    let Some(from_block) = runtime.blocks.get(from_block_id).map(|stored| stored.block.clone()) else {
        return Err(InfraError::InvalidConfig(format!(
            "block not found: {}",
            from_block_id
        )));
    };

    let mut candidates = runtime
        .blocks
        .values()
        .map(|stored| stored.block.clone())
        .filter(|block| block.id != from_block.id)
        .filter(|block| block.date == from_block.date)
        .filter(|block| block.start_at >= from_block.end_at)
        .filter(|block| {
            normalized_candidates.is_empty() || normalized_candidates.contains(block.id.as_str())
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| left.start_at.cmp(&right.start_at));

    let next_block = candidates
        .into_iter()
        .find(|block| !runtime.task_assignments_by_block.contains_key(block.id.as_str()))
        .ok_or_else(|| InfraError::InvalidConfig("no available block for carry-over".to_string()))?;

    assign_task_to_block(&mut runtime, task_id, next_block.id.as_str());
    if let Some(task) = runtime.tasks.get_mut(task_id) {
        task.status = TaskStatus::InProgress;
    }

    let status = runtime
        .tasks
        .get(task_id)
        .map(|task| task_status_as_str(&task.status).to_string())
        .unwrap_or_else(|| "in_progress".to_string());
    let response = CarryOverTaskResponse {
        task_id: task_id.to_string(),
        from_block_id: from_block_id.to_string(),
        to_block_id: next_block.id,
        status,
    };

    drop(runtime);
    state.log_info(
        "carry_over_task",
        &format!(
            "carried task_id={} from_block_id={} to_block_id={}",
            response.task_id, response.from_block_id, response.to_block_id
        ),
    );
    Ok(response)
}

pub fn start_pomodoro_impl(
    state: &AppState,
    block_id: String,
    task_id: Option<String>,
) -> Result<PomodoroStateResponse, InfraError> {
    let block_id = block_id.trim();
    if block_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "block_id must not be empty".to_string(),
        ));
    }

    let policy = load_runtime_policy(state.config_dir());
    let mut runtime = lock_runtime(state)?;
    let block = runtime
        .blocks
        .get(block_id)
        .map(|stored| stored.block.clone())
        .ok_or_else(|| {
            InfraError::InvalidConfig(format!("block not found: {}", block_id))
        })?;

    let normalized_task_id = task_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    if let Some(task_id) = normalized_task_id.as_deref() {
        if !runtime.tasks.contains_key(task_id) {
            return Err(InfraError::InvalidConfig(format!("task not found: {}", task_id)));
        }
    }

    if runtime.pomodoro.phase != PomodoroRuntimePhase::Idle {
        return Err(InfraError::InvalidConfig(
            "timer must be idle before start".to_string(),
        ));
    }

    let session_plan = build_pomodoro_session_plan(&block, policy.break_duration_minutes);
    let now = Utc::now();
    runtime.pomodoro.current_block_id = Some(block_id.to_string());
    runtime.pomodoro.current_task_id = normalized_task_id;
    if let Some(task_id) = runtime.pomodoro.current_task_id.clone() {
        assign_task_to_block(&mut runtime, task_id.as_str(), block_id);
        if let Some(task) = runtime.tasks.get_mut(task_id.as_str()) {
            if task.status != TaskStatus::Completed {
                task.status = TaskStatus::InProgress;
            }
        }
    }
    runtime.pomodoro.total_cycles = session_plan.total_cycles;
    runtime.pomodoro.completed_cycles = 0;
    runtime.pomodoro.current_cycle = 1;
    runtime.pomodoro.focus_seconds = session_plan.focus_seconds;
    runtime.pomodoro.break_seconds = session_plan.break_seconds;
    runtime.pomodoro.paused_phase = None;
    start_pomodoro_phase(&mut runtime.pomodoro, PomodoroRuntimePhase::Focus, now)?;

    state.log_info("start_pomodoro", &format!("started block_id={}", block_id));
    Ok(to_pomodoro_state_response(&runtime.pomodoro))
}

pub fn advance_pomodoro_impl(state: &AppState) -> Result<PomodoroStateResponse, InfraError> {
    let mut runtime = lock_runtime(state)?;
    if runtime.pomodoro.phase != PomodoroRuntimePhase::Focus
        && runtime.pomodoro.phase != PomodoroRuntimePhase::Break
    {
        return Err(InfraError::InvalidConfig("timer is not running".to_string()));
    }

    let now = Utc::now();
    finish_active_log(&mut runtime.pomodoro, now, None);
    match runtime.pomodoro.phase {
        PomodoroRuntimePhase::Focus => {
            let total_cycles = runtime.pomodoro.total_cycles.max(1);
            runtime.pomodoro.completed_cycles = runtime
                .pomodoro
                .completed_cycles
                .saturating_add(1)
                .min(total_cycles);
            start_pomodoro_phase(&mut runtime.pomodoro, PomodoroRuntimePhase::Break, now)?;
            if runtime.pomodoro.completed_cycles >= total_cycles {
                state.log_info("advance_pomodoro", "advanced to final break phase");
            } else {
                state.log_info("advance_pomodoro", "advanced to break phase");
            }
        }
        PomodoroRuntimePhase::Break => {
            let total_cycles = runtime.pomodoro.total_cycles.max(1);
            if runtime.pomodoro.completed_cycles >= total_cycles {
                reset_pomodoro_session(&mut runtime.pomodoro);
                state.log_info("advance_pomodoro", "completed all cycles in block session");
            } else {
                start_pomodoro_phase(&mut runtime.pomodoro, PomodoroRuntimePhase::Focus, now)?;
                state.log_info("advance_pomodoro", "advanced to focus phase");
            }
        }
        _ => {}
    }

    Ok(to_pomodoro_state_response(&runtime.pomodoro))
}

pub fn pause_pomodoro_impl(
    state: &AppState,
    reason: Option<String>,
) -> Result<PomodoroStateResponse, InfraError> {
    let mut runtime = lock_runtime(state)?;
    if runtime.pomodoro.phase != PomodoroRuntimePhase::Focus
        && runtime.pomodoro.phase != PomodoroRuntimePhase::Break
    {
        return Err(InfraError::InvalidConfig("timer is not running".to_string()));
    }

    let interruption_reason = reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "paused".to_string());

    finish_active_log(
        &mut runtime.pomodoro,
        Utc::now(),
        Some(interruption_reason.clone()),
    );

    runtime.pomodoro.paused_phase = Some(runtime.pomodoro.phase);
    runtime.pomodoro.phase = PomodoroRuntimePhase::Paused;
    runtime.pomodoro.remaining_seconds = runtime
        .pomodoro
        .remaining_seconds
        .min(runtime.pomodoro.focus_seconds.max(runtime.pomodoro.break_seconds));

    state.log_info("pause_pomodoro", "paused active pomodoro timer");
    Ok(to_pomodoro_state_response(&runtime.pomodoro))
}

pub fn get_pomodoro_state_impl(state: &AppState) -> Result<PomodoroStateResponse, InfraError> {
    let runtime = lock_runtime(state)?;
    Ok(to_pomodoro_state_response(&runtime.pomodoro))
}

pub fn resume_pomodoro_impl(state: &AppState) -> Result<PomodoroStateResponse, InfraError> {
    let mut runtime = lock_runtime(state)?;
    if runtime.pomodoro.phase != PomodoroRuntimePhase::Paused {
        return Err(InfraError::InvalidConfig("timer is not paused".to_string()));
    }

    let resume_phase = runtime
        .pomodoro
        .paused_phase
        .take()
        .ok_or_else(|| InfraError::InvalidConfig("paused phase is missing".to_string()))?;
    let phase = match resume_phase {
        PomodoroRuntimePhase::Focus => PomodoroPhase::Focus,
        PomodoroRuntimePhase::Break => PomodoroPhase::Break,
        _ => {
            return Err(InfraError::InvalidConfig(
                "cannot resume to idle or paused phase".to_string(),
            ));
        }
    };

    let block_id = runtime
        .pomodoro
        .current_block_id
        .clone()
        .ok_or_else(|| InfraError::InvalidConfig("current block is missing".to_string()))?;
    let now = Utc::now();

    runtime.pomodoro.phase = resume_phase;
    runtime.pomodoro.start_time = Some(now);
    runtime.pomodoro.active_log = Some(PomodoroLog {
        id: next_id("pom"),
        block_id,
        task_id: runtime.pomodoro.current_task_id.clone(),
        phase,
        start_time: now,
        end_time: None,
        interruption_reason: None,
    });

    state.log_info("resume_pomodoro", "resumed paused pomodoro timer");
    Ok(to_pomodoro_state_response(&runtime.pomodoro))
}

pub fn complete_pomodoro_impl(state: &AppState) -> Result<PomodoroStateResponse, InfraError> {
    let mut runtime = lock_runtime(state)?;
    if runtime.pomodoro.phase == PomodoroRuntimePhase::Idle {
        return Ok(to_pomodoro_state_response(&runtime.pomodoro));
    }

    let interruption_reason = if runtime.pomodoro.phase == PomodoroRuntimePhase::Focus
        || runtime.pomodoro.phase == PomodoroRuntimePhase::Break
    {
        Some("manual_complete".to_string())
    } else {
        None
    };
    finish_active_log(&mut runtime.pomodoro, Utc::now(), interruption_reason);
    reset_pomodoro_session(&mut runtime.pomodoro);

    state.log_info("complete_pomodoro", "completed pomodoro session");
    Ok(to_pomodoro_state_response(&runtime.pomodoro))
}

fn start_pomodoro_phase(
    runtime: &mut PomodoroRuntimeState,
    phase: PomodoroRuntimePhase,
    now: DateTime<Utc>,
) -> Result<(), InfraError> {
    let block_id = runtime
        .current_block_id
        .clone()
        .ok_or_else(|| InfraError::InvalidConfig("current block is missing".to_string()))?;
    let log_phase = match phase {
        PomodoroRuntimePhase::Focus => PomodoroPhase::Focus,
        PomodoroRuntimePhase::Break => PomodoroPhase::Break,
        _ => {
            return Err(InfraError::InvalidConfig(
                "start_pomodoro_phase only supports focus or break".to_string(),
            ))
        }
    };

    runtime.phase = phase;
    runtime.paused_phase = None;
    runtime.remaining_seconds = match phase {
        PomodoroRuntimePhase::Focus => runtime.focus_seconds,
        PomodoroRuntimePhase::Break => runtime.break_seconds,
        _ => 0,
    };
    runtime.start_time = Some(now);
    let total_cycles = runtime.total_cycles.max(1);
    runtime.current_cycle = match phase {
        PomodoroRuntimePhase::Focus => runtime
            .completed_cycles
            .saturating_add(1)
            .min(total_cycles),
        PomodoroRuntimePhase::Break => runtime.completed_cycles.min(total_cycles),
        _ => 0,
    };
    runtime.active_log = Some(PomodoroLog {
        id: next_id("pom"),
        block_id,
        task_id: runtime.current_task_id.clone(),
        phase: log_phase,
        start_time: now,
        end_time: None,
        interruption_reason: None,
    });
    Ok(())
}

fn finish_active_log(
    runtime: &mut PomodoroRuntimeState,
    end_time: DateTime<Utc>,
    interruption_reason: Option<String>,
) {
    if let Some(mut active) = runtime.active_log.take() {
        active.end_time = Some(end_time);
        active.interruption_reason = interruption_reason;
        runtime.completed_logs.push(active);
    }
}

fn reset_pomodoro_session(runtime: &mut PomodoroRuntimeState) {
    runtime.current_block_id = None;
    runtime.current_task_id = None;
    runtime.phase = PomodoroRuntimePhase::Idle;
    runtime.paused_phase = None;
    runtime.remaining_seconds = 0;
    runtime.start_time = None;
    runtime.total_cycles = 0;
    runtime.completed_cycles = 0;
    runtime.current_cycle = 0;
    runtime.focus_seconds = POMODORO_FOCUS_SECONDS;
    runtime.break_seconds = POMODORO_BREAK_SECONDS;
    runtime.active_log = None;
}

fn build_pomodoro_session_plan(block: &Block, break_duration_minutes: u32) -> PomodoroSessionPlan {
    let requested_cycles = u32::try_from(block.planned_pomodoros)
        .ok()
        .filter(|value| *value > 0)
        .unwrap_or(1);
    let focus_seconds = POMODORO_FOCUS_SECONDS;
    let break_seconds = (break_duration_minutes.saturating_mul(60)).max(MIN_POMODORO_BREAK_SECONDS);
    let cycle_seconds = focus_seconds.saturating_add(break_seconds).max(1);
    let block_seconds = (block.end_at - block.start_at).num_seconds().max(0) as u32;
    let max_cycles_by_duration = (block_seconds / cycle_seconds).max(1);
    let total_cycles = requested_cycles.min(max_cycles_by_duration).max(1);

    PomodoroSessionPlan {
        total_cycles,
        focus_seconds,
        break_seconds,
    }
}

pub fn get_reflection_summary_impl(
    state: &AppState,
    start: Option<String>,
    end: Option<String>,
) -> Result<ReflectionSummaryResponse, InfraError> {
    let default_start = Utc::now() - Duration::days(7);
    let start = match start {
        Some(raw) => parse_datetime_input(&raw, "start")?,
        None => default_start,
    };
    let end = match end {
        Some(raw) => parse_datetime_input(&raw, "end")?,
        None => Utc::now(),
    };
    if end <= start {
        return Err(InfraError::InvalidConfig(
            "end must be greater than start".to_string(),
        ));
    }

    let runtime = lock_runtime(state)?;
    let logs_in_range = runtime
        .pomodoro
        .completed_logs
        .iter()
        .filter(|log| log.start_time >= start && log.start_time <= end)
        .cloned()
        .collect::<Vec<_>>();

    let completed_count = logs_in_range
        .iter()
        .filter(|log| log.phase == PomodoroPhase::Focus && log.interruption_reason.is_none())
        .count() as u32;
    let interrupted_count = logs_in_range
        .iter()
        .filter(|log| log.interruption_reason.is_some())
        .count() as u32;

    let total_focus_minutes = logs_in_range
        .iter()
        .filter(|log| log.phase == PomodoroPhase::Focus)
        .filter_map(|log| log.end_time.map(|end_time| (end_time - log.start_time).num_minutes()))
        .filter(|duration_minutes| *duration_minutes > 0)
        .sum();

    let logs = logs_in_range
        .into_iter()
        .map(|log| ReflectionLogItem {
            id: log.id,
            block_id: log.block_id,
            task_id: log.task_id,
            phase: match log.phase {
                PomodoroPhase::Focus => "focus",
                PomodoroPhase::Break => "break",
                PomodoroPhase::LongBreak => "long_break",
                PomodoroPhase::Paused => "paused",
            }
            .to_string(),
            start_time: log.start_time.to_rfc3339(),
            end_time: log.end_time.map(|value| value.to_rfc3339()),
            interruption_reason: log.interruption_reason,
        })
        .collect::<Vec<_>>();

    Ok(ReflectionSummaryResponse {
        start: start.to_rfc3339(),
        end: end.to_rfc3339(),
        completed_count,
        interrupted_count,
        total_focus_minutes,
        logs,
    })
}

fn lock_runtime(state: &AppState) -> Result<MutexGuard<'_, RuntimeState>, InfraError> {
    state
        .runtime
        .lock()
        .map_err(|error| InfraError::InvalidConfig(format!("runtime lock poisoned: {error}")))
}

fn to_pomodoro_state_response(state: &PomodoroRuntimeState) -> PomodoroStateResponse {
    PomodoroStateResponse {
        current_block_id: state.current_block_id.clone(),
        current_task_id: state.current_task_id.clone(),
        phase: state.phase.as_str().to_string(),
        remaining_seconds: state.remaining_seconds,
        start_time: state.start_time.map(|value| value.to_rfc3339()),
        total_cycles: state.total_cycles,
        completed_cycles: state.completed_cycles,
        current_cycle: state.current_cycle,
    }
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

async fn required_access_token(account_id: Option<String>) -> Result<String, InfraError> {
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

async fn try_access_token(account_id: Option<String>) -> Result<Option<String>, InfraError> {
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

async fn ensure_blocks_calendar_id(
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

fn resolve_sync_window(
    time_min: Option<String>,
    time_max: Option<String>,
) -> Result<(DateTime<Utc>, DateTime<Utc>), InfraError> {
    let default_start = {
        let today = Utc::now().date_naive();
        Utc.from_utc_datetime(&today.and_hms_opt(0, 0, 0).expect("valid midnight"))
    };
    let start = match time_min {
        Some(raw) => parse_datetime_input(&raw, "time_min")?,
        None => default_start,
    };
    let end = match time_max {
        Some(raw) => parse_datetime_input(&raw, "time_max")?,
        None => start + Duration::days(1),
    };
    if end <= start {
        return Err(InfraError::InvalidConfig(
            "time_max must be greater than time_min".to_string(),
        ));
    }
    Ok((start, end))
}

fn parse_datetime_input(value: &str, field_name: &str) -> Result<DateTime<Utc>, InfraError> {
    if let Ok(parsed) = DateTime::parse_from_rfc3339(value) {
        return Ok(parsed.with_timezone(&Utc));
    }
    if let Ok(date) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        return Ok(Utc.from_utc_datetime(
            &date.and_hms_opt(0, 0, 0).expect("valid midnight"),
        ));
    }
    Err(InfraError::InvalidConfig(format!(
        "{field_name} must be RFC3339 or YYYY-MM-DD"
    )))
}

fn local_datetime_to_utc(
    date: NaiveDate,
    time: NaiveTime,
    timezone: Tz,
) -> Result<DateTime<Utc>, InfraError> {
    let local = date.and_time(time);
    let resolved = match timezone.from_local_datetime(&local) {
        LocalResult::Single(value) => value,
        LocalResult::Ambiguous(first, second) => first.min(second),
        LocalResult::None => {
            return Err(InfraError::InvalidConfig(format!(
                "unable to resolve local time {} {} in timezone {}",
                date,
                time.format("%H:%M"),
                timezone
            )))
        }
    };
    Ok(resolved.with_timezone(&Utc))
}

fn save_suppression(
    database_path: &Path,
    instance: &str,
    reason: Option<&str>,
) -> Result<(), InfraError> {
    let single = vec![instance.to_string()];
    let _ = save_suppressions(database_path, &single, reason)?;
    Ok(())
}

fn instance_matches_date(instance: &str, date_key: &str) -> bool {
    if instance.is_empty() || date_key.is_empty() {
        return false;
    }
    instance.ends_with(&format!(":{date_key}")) || instance.contains(&format!(":{date_key}:"))
}

fn clear_user_deleted_suppressions_for_date(
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

fn save_suppressions(
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

fn load_suppressions(database_path: &Path) -> Result<HashSet<String>, InfraError> {
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

async fn auto_relocate_after_sync(
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
        if relocate_if_needed_impl(
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

fn load_runtime_policy(config_dir: &Path) -> RuntimePolicy {
    let mut policy = RuntimePolicy::default();
    if let Ok(Some(timezone)) = read_timezone(config_dir) {
        if let Ok(parsed_timezone) = timezone.parse::<Tz>() {
            policy.timezone = parsed_timezone;
        }
    }
    let path = config_dir.join("policies.json");
    let Ok(raw) = fs::read_to_string(path) else {
        return policy;
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return policy;
    };

    if let Some(work_hours) = parsed.get("workHours") {
        if let Some(start) = work_hours.get("start").and_then(serde_json::Value::as_str) {
            if let Ok(parsed_start) = NaiveTime::parse_from_str(start.trim(), "%H:%M") {
                policy.work_start = parsed_start;
            }
        }
        if let Some(end) = work_hours.get("end").and_then(serde_json::Value::as_str) {
            if let Ok(parsed_end) = NaiveTime::parse_from_str(end.trim(), "%H:%M") {
                policy.work_end = parsed_end;
            }
        }
        if let Some(days) = work_hours.get("days").and_then(serde_json::Value::as_array) {
            let parsed_days = days
                .iter()
                .filter_map(serde_json::Value::as_str)
                .filter_map(parse_weekday)
                .collect::<HashSet<_>>();
            if !parsed_days.is_empty() {
                policy.work_days = parsed_days;
            }
        }
    }

    if let Some(value) = parsed
        .get("blockDurationMinutes")
        .and_then(serde_json::Value::as_u64)
    {
        policy.block_duration_minutes = value.max(1) as u32;
    }
    if let Some(value) = parsed
        .get("breakDurationMinutes")
        .and_then(serde_json::Value::as_u64)
    {
        policy.break_duration_minutes = value.max(1) as u32;
    }
    if let Some(value) = parsed
        .get("minBlockGapMinutes")
        .and_then(serde_json::Value::as_u64)
    {
        policy.min_block_gap_minutes = value as u32;
    }
    if let Some(value) = parsed
        .get("generation")
        .and_then(|generation| generation.get("respectSuppression"))
        .and_then(serde_json::Value::as_bool)
    {
        policy.respect_suppression = value;
    }
    if let Some(value) = parsed
        .get("generation")
        .and_then(|generation| generation.get("autoEnabled"))
        .and_then(serde_json::Value::as_bool)
    {
        policy.auto_enabled = value;
    }
    if let Some(value) = parsed
        .get("generation")
        .and_then(|generation| generation.get("catchUpOnAppStart"))
        .and_then(serde_json::Value::as_bool)
    {
        policy.catch_up_on_app_start = value;
    }
    if let Some(value) = parsed
        .get("generation")
        .and_then(|generation| generation.get("maxAutoBlocksPerDay"))
        .and_then(serde_json::Value::as_u64)
    {
        policy.max_auto_blocks_per_day = value.max(1) as u32;
    }
    if let Some(value) = parsed
        .get("generation")
        .and_then(|generation| generation.get("maxRelocationsPerSync"))
        .and_then(serde_json::Value::as_u64)
    {
        policy.max_relocations_per_sync = value.max(1) as u32;
    }

    policy
}

fn parse_weekday(value: &str) -> Option<Weekday> {
    match value.trim().to_ascii_lowercase().as_str() {
        "monday" | "mon" | "mo" => Some(Weekday::Mon),
        "tuesday" | "tue" | "tu" => Some(Weekday::Tue),
        "wednesday" | "wed" | "we" => Some(Weekday::Wed),
        "thursday" | "thu" | "th" => Some(Weekday::Thu),
        "friday" | "fri" | "fr" => Some(Weekday::Fri),
        "saturday" | "sat" | "sa" => Some(Weekday::Sat),
        "sunday" | "sun" | "su" => Some(Weekday::Sun),
        _ => None,
    }
}

fn weekday_to_rrule_code(weekday: Weekday) -> &'static str {
    match weekday {
        Weekday::Mon => "MO",
        Weekday::Tue => "TU",
        Weekday::Wed => "WE",
        Weekday::Thu => "TH",
        Weekday::Fri => "FR",
        Weekday::Sat => "SA",
        Weekday::Sun => "SU",
    }
}

fn value_by_keys<'a>(
    object: &'a serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<&'a serde_json::Value> {
    for key in keys {
        if let Some(value) = object.get(*key) {
            return Some(value);
        }
    }
    None
}

fn parse_time_value(value: &serde_json::Value) -> Option<NaiveTime> {
    let value = value.as_str()?.trim();
    if value.is_empty() {
        return None;
    }
    NaiveTime::parse_from_str(value, "%H:%M").ok()
}

fn parse_positive_u32_value(value: &serde_json::Value) -> Option<u32> {
    if let Some(parsed) = value.as_u64() {
        let parsed = u32::try_from(parsed).ok()?;
        return (parsed > 0).then_some(parsed);
    }
    if let Some(parsed) = value.as_i64() {
        return (parsed > 0).then_some(parsed as u32);
    }
    let parsed = value.as_str()?.trim().parse::<u32>().ok()?;
    (parsed > 0).then_some(parsed)
}

fn parse_positive_i32_value(value: &serde_json::Value) -> Option<i32> {
    if let Some(parsed) = value.as_i64() {
        let parsed = i32::try_from(parsed).ok()?;
        return (parsed > 0).then_some(parsed);
    }
    if let Some(parsed) = value.as_u64() {
        let parsed = i32::try_from(parsed).ok()?;
        return (parsed > 0).then_some(parsed);
    }
    let parsed = value.as_str()?.trim().parse::<i32>().ok()?;
    (parsed > 0).then_some(parsed)
}

fn parse_block_type_value(value: Option<&serde_json::Value>) -> Option<BlockType> {
    match value?.as_str()?.trim().to_ascii_lowercase().as_str() {
        "deep" => Some(BlockType::Deep),
        "shallow" => Some(BlockType::Shallow),
        "admin" => Some(BlockType::Admin),
        "learning" => Some(BlockType::Learning),
        _ => None,
    }
}

fn parse_firmness_value(value: Option<&serde_json::Value>) -> Option<Firmness> {
    match value?.as_str()?.trim().to_ascii_lowercase().as_str() {
        "draft" => Some(Firmness::Draft),
        "soft" => Some(Firmness::Soft),
        "hard" => Some(Firmness::Hard),
        _ => None,
    }
}

#[derive(Debug, Clone)]
struct TemplateDefinition {
    id: String,
    start: Option<NaiveTime>,
    duration_minutes: u32,
    block_type: BlockType,
    firmness: Firmness,
    planned_pomodoros: Option<i32>,
    days: Option<HashSet<Weekday>>,
}

fn read_config_array(
    config_dir: &Path,
    file_name: &str,
    array_key: &str,
) -> Vec<serde_json::Value> {
    let path = config_dir.join(file_name);
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    parsed
        .get(array_key)
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn parse_template_definitions(
    templates_raw: &[serde_json::Value],
) -> HashMap<String, TemplateDefinition> {
    let mut templates = HashMap::new();
    for template_raw in templates_raw {
        let Some(template) = template_raw.as_object() else {
            continue;
        };
        let Some(template_id) = value_by_keys(template, &["id"])
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(duration_minutes) = value_by_keys(template, &["durationMinutes", "duration_minutes"])
            .and_then(parse_positive_u32_value)
        else {
            continue;
        };
        let start = value_by_keys(template, &["start", "time"]).and_then(parse_time_value);
        let block_type =
            parse_block_type_value(value_by_keys(template, &["blockType", "block_type", "type"]))
                .unwrap_or(BlockType::Deep);
        let firmness =
            parse_firmness_value(value_by_keys(template, &["firmness"])).unwrap_or(Firmness::Draft);
        let planned_pomodoros = value_by_keys(
            template,
            &["plannedPomodoros", "planned_pomodoros", "pomodoros"],
        )
        .and_then(parse_positive_i32_value);
        let days = value_by_keys(template, &["days"])
            .and_then(serde_json::Value::as_array)
            .map(|days| {
                days.iter()
                    .filter_map(serde_json::Value::as_str)
                    .filter_map(parse_weekday)
                    .collect::<HashSet<_>>()
            })
            .filter(|days| !days.is_empty());

        templates.insert(
            template_id.to_string(),
            TemplateDefinition {
                id: template_id.to_string(),
                start,
                duration_minutes,
                block_type,
                firmness,
                planned_pomodoros,
                days,
            },
        );
    }
    templates
}

fn template_applies_on_date(template: &TemplateDefinition, date: NaiveDate) -> bool {
    match &template.days {
        Some(days) => days.contains(&date.weekday()),
        None => true,
    }
}

fn parse_rrule(rrule: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for part in rrule.split(';') {
        let mut split = part.splitn(2, '=');
        let Some(key) = split.next() else {
            continue;
        };
        let Some(value) = split.next() else {
            continue;
        };
        let normalized_key = key.trim().to_ascii_uppercase();
        let normalized_value = value.trim().to_ascii_uppercase();
        if normalized_key.is_empty() || normalized_value.is_empty() {
            continue;
        }
        map.insert(normalized_key, normalized_value);
    }
    map
}

fn rrule_matches_date(rrule: &str, date: NaiveDate) -> bool {
    let parts = parse_rrule(rrule);
    let Some(freq) = parts.get("FREQ").map(String::as_str) else {
        return false;
    };
    let frequency_matches = match freq {
        "DAILY" => true,
        "WEEKLY" => true,
        "MONTHLY" => true,
        _ => false,
    };
    if !frequency_matches {
        return false;
    }

    if let Some(by_day) = parts.get("BYDAY") {
        let target = weekday_to_rrule_code(date.weekday());
        let day_matches = by_day
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .any(|value| value == target);
        if !day_matches {
            return false;
        }
    }

    if let Some(by_month_day) = parts.get("BYMONTHDAY") {
        let current_day = date.day() as i32;
        let month_day_matches = by_month_day
            .split(',')
            .map(str::trim)
            .filter_map(|value| value.parse::<i32>().ok())
            .any(|value| value == current_day);
        if !month_day_matches {
            return false;
        }
    }

    true
}

fn routine_is_skipped_on_date(
    routine: &serde_json::Map<String, serde_json::Value>,
    date: NaiveDate,
) -> bool {
    let date_key = date.to_string();
    let direct_skip = value_by_keys(routine, &["skip_dates", "skipDates"])
        .and_then(serde_json::Value::as_array)
        .map(|skip_dates| {
            skip_dates
                .iter()
                .filter_map(serde_json::Value::as_str)
                .any(|value| value.trim() == date_key)
        })
        .unwrap_or(false);
    if direct_skip {
        return true;
    }

    value_by_keys(routine, &["exceptions"])
        .and_then(serde_json::Value::as_array)
        .map(|exceptions| {
            exceptions.iter().any(|entry| {
                let Some(exception) = entry.as_object() else {
                    return false;
                };
                value_by_keys(exception, &["skip_dates", "skipDates"])
                    .and_then(serde_json::Value::as_array)
                    .map(|skip_dates| {
                        skip_dates
                            .iter()
                            .filter_map(serde_json::Value::as_str)
                            .any(|value| value.trim() == date_key)
                    })
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn schedule_matches_date(
    schedule: &serde_json::Map<String, serde_json::Value>,
    date: NaiveDate,
) -> bool {
    let schedule_type = value_by_keys(schedule, &["type"])
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .map(|value| value.to_ascii_lowercase());
    match schedule_type.as_deref() {
        Some("daily") => true,
        Some("weekly") => value_by_keys(schedule, &["day", "weekday"])
            .and_then(serde_json::Value::as_str)
            .and_then(parse_weekday)
            .map(|weekday| weekday == date.weekday())
            .unwrap_or(false),
        Some("monthly") => value_by_keys(schedule, &["day", "dayOfMonth", "day_of_month"])
            .and_then(parse_positive_u32_value)
            .map(|day| day == date.day())
            .unwrap_or(false),
        Some(_) => false,
        None => false,
    }
}

fn routine_matches_date(
    routine: &serde_json::Map<String, serde_json::Value>,
    date: NaiveDate,
) -> bool {
    if routine_is_skipped_on_date(routine, date) {
        return false;
    }
    if let Some(schedule) = value_by_keys(routine, &["schedule"]).and_then(serde_json::Value::as_object)
    {
        return schedule_matches_date(schedule, date);
    }
    if let Some(rrule) = value_by_keys(routine, &["rrule"])
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return rrule_matches_date(rrule, date);
    }
    true
}

fn load_configured_block_plans(
    config_dir: &Path,
    date: NaiveDate,
    policy: &RuntimePolicy,
) -> Vec<BlockPlan> {
    let templates_raw = read_config_array(config_dir, "templates.json", "templates");
    let routines_raw = read_config_array(config_dir, "routines.json", "routines");
    let templates = parse_template_definitions(&templates_raw);
    let mut plans = Vec::new();

    for template in templates.values() {
        if !template_applies_on_date(template, date) {
            continue;
        }
        let Some(start) = template.start else {
            continue;
        };
        let Ok(start_at) = local_datetime_to_utc(date, start, policy.timezone) else {
            continue;
        };
        let end_at = start_at + Duration::minutes(template.duration_minutes as i64);
        plans.push(BlockPlan {
            instance: format!("tpl:{}:{}", template.id, date),
            start_at,
            end_at,
            block_type: template.block_type.clone(),
            firmness: template.firmness.clone(),
            planned_pomodoros: template.planned_pomodoros.unwrap_or_else(|| {
                planned_pomodoros(template.duration_minutes, policy.break_duration_minutes)
            }),
            source: "template".to_string(),
            source_id: Some(template.id.clone()),
        });
    }

    for routine_raw in routines_raw {
        let Some(routine) = routine_raw.as_object() else {
            continue;
        };
        let Some(routine_id) = value_by_keys(routine, &["id"])
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if !routine_matches_date(routine, date) {
            continue;
        }
        let template_id = value_by_keys(routine, &["template_id", "templateId"])
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        let linked_template = template_id
            .as_deref()
            .and_then(|template_id| templates.get(template_id));
        let default = value_by_keys(routine, &["default"]).and_then(serde_json::Value::as_object);
        let schedule = value_by_keys(routine, &["schedule"]).and_then(serde_json::Value::as_object);

        let start = default
            .and_then(|value| value_by_keys(value, &["start", "time"]))
            .and_then(parse_time_value)
            .or_else(|| {
                schedule
                    .and_then(|value| value_by_keys(value, &["time", "start"]))
                    .and_then(parse_time_value)
            })
            .or_else(|| linked_template.and_then(|template| template.start));
        let Some(start) = start else {
            continue;
        };
        let duration_minutes = default
            .and_then(|value| value_by_keys(value, &["durationMinutes", "duration_minutes"]))
            .and_then(parse_positive_u32_value)
            .or_else(|| {
                value_by_keys(routine, &["durationMinutes", "duration_minutes"])
                    .and_then(parse_positive_u32_value)
            })
            .or_else(|| linked_template.map(|template| template.duration_minutes));
        let Some(duration_minutes) = duration_minutes else {
            continue;
        };
        let Ok(start_at) = local_datetime_to_utc(date, start, policy.timezone) else {
            continue;
        };
        let end_at = start_at + Duration::minutes(duration_minutes as i64);
        let block_type = parse_block_type_value(
            default
                .and_then(|value| value_by_keys(value, &["blockType", "block_type", "type"]))
                .or_else(|| value_by_keys(routine, &["blockType", "block_type", "type"])),
        )
        .or_else(|| linked_template.map(|template| template.block_type.clone()))
        .unwrap_or(BlockType::Deep);
        let firmness = parse_firmness_value(
            default
                .and_then(|value| value_by_keys(value, &["firmness"]))
                .or_else(|| value_by_keys(routine, &["firmness"])),
        )
        .or_else(|| linked_template.map(|template| template.firmness.clone()))
        .unwrap_or(Firmness::Draft);
        let planned = default
            .and_then(|value| value_by_keys(value, &["pomodoros", "plannedPomodoros", "planned_pomodoros"]))
            .and_then(parse_positive_i32_value)
            .or_else(|| {
                value_by_keys(
                    routine,
                    &["pomodoros", "plannedPomodoros", "planned_pomodoros"],
                )
                .and_then(parse_positive_i32_value)
            })
            .or_else(|| linked_template.and_then(|template| template.planned_pomodoros))
            .unwrap_or_else(|| planned_pomodoros(duration_minutes, policy.break_duration_minutes));

        plans.push(BlockPlan {
            instance: format!("rtn:{}:{}", routine_id, date),
            start_at,
            end_at,
            block_type,
            firmness,
            planned_pomodoros: planned,
            source: "routine".to_string(),
            source_id: Some(routine_id.to_string()),
        });
    }

    plans.sort_by(|left, right| {
        left.start_at
            .cmp(&right.start_at)
            .then_with(|| left.instance.cmp(&right.instance))
    });
    let mut deduped = Vec::new();
    let mut seen_instances = HashSet::new();
    for plan in plans {
        if seen_instances.insert(plan.instance.clone()) {
            deduped.push(plan);
        }
    }
    deduped
}

fn parse_task_status(value: &str) -> Result<TaskStatus, InfraError> {
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

fn task_status_as_str(value: &TaskStatus) -> &'static str {
    match value {
        TaskStatus::Pending => "pending",
        TaskStatus::InProgress => "in_progress",
        TaskStatus::Completed => "completed",
        TaskStatus::Deferred => "deferred",
    }
}

fn assign_task_to_block(runtime: &mut RuntimeState, task_id: &str, block_id: &str) {
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

fn unassign_task(runtime: &mut RuntimeState, task_id: &str) -> Option<String> {
    let previous_block_id = runtime.task_assignments_by_task.remove(task_id)?;
    runtime
        .task_assignments_by_block
        .remove(previous_block_id.as_str());
    Some(previous_block_id)
}

fn is_cancelled_event(event: &GoogleCalendarEvent) -> bool {
    event
        .status
        .as_deref()
        .map(|status| status.eq_ignore_ascii_case("cancelled"))
        .unwrap_or(false)
}

fn intervals_overlap(left: &Interval, right: &Interval) -> bool {
    left.start < right.end && right.start < left.end
}

fn parse_rfc3339_input(value: &str, field_name: &str) -> Result<DateTime<Utc>, InfraError> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| {
            InfraError::InvalidConfig(format!(
                "{field_name} must be RFC3339 date-time: {error}"
            ))
        })
}

fn event_to_interval(event: &GoogleCalendarEvent) -> Option<Interval> {
    let start = DateTime::parse_from_rfc3339(&event.start.date_time)
        .ok()?
        .with_timezone(&Utc);
    let end = DateTime::parse_from_rfc3339(&event.end.date_time)
        .ok()?
        .with_timezone(&Utc);
    if end <= start {
        return None;
    }
    Some(Interval { start, end })
}

fn clip_interval(
    interval: Interval,
    window_start: DateTime<Utc>,
    window_end: DateTime<Utc>,
) -> Option<Interval> {
    if interval.end <= window_start || interval.start >= window_end {
        return None;
    }
    let start = if interval.start < window_start {
        window_start
    } else {
        interval.start
    };
    let end = if interval.end > window_end {
        window_end
    } else {
        interval.end
    };
    (end > start).then_some(Interval { start, end })
}

fn free_slots(
    window_start: DateTime<Utc>,
    window_end: DateTime<Utc>,
    busy_intervals: &[Interval],
) -> Vec<Interval> {
    if window_end <= window_start {
        return Vec::new();
    }

    let mut slots = Vec::new();
    let mut cursor = window_start;
    for interval in busy_intervals {
        if interval.start > cursor {
            slots.push(Interval {
                start: cursor,
                end: interval.start,
            });
        }
        if interval.end > cursor {
            cursor = interval.end;
        }
    }
    if cursor < window_end {
        slots.push(Interval {
            start: cursor,
            end: window_end,
        });
    }
    slots
}

fn merge_intervals(mut intervals: Vec<Interval>) -> Vec<Interval> {
    if intervals.is_empty() {
        return intervals;
    }

    intervals.sort_unstable_by(|left, right| left.start.cmp(&right.start));
    let mut iter = intervals.into_iter();
    let mut merged = vec![iter.next().expect("intervals is non-empty")];
    for interval in iter {
        let last = merged
            .last_mut()
            .expect("merged always contains at least one interval");
        if interval.start <= last.end {
            if interval.end > last.end {
                last.end = interval.end;
            }
            continue;
        }
        merged.push(interval);
    }
    merged
}

fn planned_pomodoros(block_duration_minutes: u32, break_duration_minutes: u32) -> i32 {
    let cycle_minutes = 25u32.saturating_add(break_duration_minutes.max(1));
    (block_duration_minutes / cycle_minutes).max(1) as i32
}

async fn create_calendar_events_for_generated_blocks(
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
    use crate::infrastructure::event_mapper::{CalendarEventDateTime, GoogleCalendarEvent};
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
        let expected_plan = build_pomodoro_session_plan(&generated[0], policy.break_duration_minutes);

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
    async fn advance_pomodoro_tracks_cycles_inside_block() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        let block = generated[0].clone();
        let policy = load_runtime_policy(state.config_dir());
        let expected_plan = build_pomodoro_session_plan(&block, policy.break_duration_minutes);

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
      "blockType": "deep",
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
      "blockType": "admin",
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
            block_type: BlockType::Deep,
            firmness: Firmness::Draft,
            planned_pomodoros: 2,
            source: "routine".to_string(),
            source_id: Some("auto".to_string()),
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
            block_type: BlockType::Deep,
            firmness: Firmness::Draft,
            planned_pomodoros: 2,
            source: "routine".to_string(),
            source_id: Some("auto".to_string()),
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

        let listed = list_synced_events_impl(
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
