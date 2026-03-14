use super::state::AppState;
use crate::application::calendar_setup::{BlocksCalendarInitializer, EnsureBlocksCalendarResult};
use crate::application::id_factory::next_id;
use crate::application::oauth::{EnsureTokenResult, OAuthConfig, OAuthManager};
use crate::infrastructure::credential_store::WindowsCredentialManagerStore;
use crate::infrastructure::error::InfraError;
use crate::infrastructure::google_calendar_client::ReqwestGoogleCalendarClient;
use crate::infrastructure::oauth_client::ReqwestOAuthClient;
use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration as StdDuration, Instant};
use url::Url;

const DEFAULT_REDIRECT_URI: &str = "http://127.0.0.1:8080/oauth2/callback";
const DEFAULT_SCOPE: &str = "https://www.googleapis.com/auth/calendar";
pub(crate) const DEFAULT_ACCOUNT_ID: &str = "default";

#[derive(Debug, Clone, Serialize)]
pub struct AuthenticateGoogleResponse {
    pub account_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorization_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

pub(crate) fn normalize_account_id(raw: Option<String>) -> String {
    raw.as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| DEFAULT_ACCOUNT_ID.to_string())
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
    let parsed = Url::parse(redirect_uri)
        .map_err(|error| InfraError::InvalidConfig(format!("invalid redirect URI: {error}")))?;
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

pub(crate) fn load_oauth_config_from_lookup<F>(lookup: F) -> Result<OAuthConfig, InfraError>
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
