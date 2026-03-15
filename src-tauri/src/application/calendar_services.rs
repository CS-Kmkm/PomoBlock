use crate::application::calendar_sync::CalendarSyncService;
use crate::application::commands::{ensure_blocks_calendar_id, AppState};
use crate::infrastructure::calendar_cache::InMemoryCalendarCacheRepository;
use crate::infrastructure::error::InfraError;
use crate::infrastructure::google_calendar_client::ReqwestGoogleCalendarClient;
use crate::infrastructure::sync_state_repository::SqliteSyncStateRepository;
use std::collections::HashMap;
use std::sync::Arc;

pub(crate) type ReqwestCalendarSyncService = CalendarSyncService<
    ReqwestGoogleCalendarClient,
    SqliteSyncStateRepository,
    InMemoryCalendarCacheRepository,
>;

pub(crate) fn build_reqwest_calendar_sync_service(
    state: &AppState,
) -> ReqwestCalendarSyncService {
    let calendar_client = Arc::new(ReqwestGoogleCalendarClient::new());
    let sync_state_repo = Arc::new(SqliteSyncStateRepository::new(state.database_path()));
    CalendarSyncService::new(calendar_client, sync_state_repo, state.calendar_cache())
}

pub(crate) async fn ensure_blocks_calendar_for_account(
    state: &AppState,
    access_token: &str,
    account_id: &str,
) -> Result<String, InfraError> {
    let calendar_client = Arc::new(ReqwestGoogleCalendarClient::new());
    ensure_blocks_calendar_id(state.config_dir(), access_token, calendar_client, account_id).await
}

pub(crate) async fn resolve_cached_blocks_calendar_id(
    state: &AppState,
    access_token: Option<&str>,
    account_id: &str,
    blocks_calendar_ids: &mut HashMap<String, String>,
) -> Result<Option<String>, InfraError> {
    if let Some(calendar_id) = blocks_calendar_ids.get(account_id) {
        return Ok(Some(calendar_id.clone()));
    }

    let Some(access_token) = access_token else {
        return Ok(None);
    };

    let calendar_id = ensure_blocks_calendar_for_account(state, access_token, account_id).await?;
    blocks_calendar_ids.insert(account_id.to_string(), calendar_id.clone());
    Ok(Some(calendar_id))
}
