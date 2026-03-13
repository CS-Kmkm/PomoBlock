use super::bootstrap::AppState;
use super::legacy::{
    auto_relocate_after_sync, ensure_blocks_calendar_id, normalize_account_id,
    required_access_token, save_suppressions,
};
use crate::application::calendar_sync::CalendarSyncService;
use crate::application::calendar_window::resolve_sync_window;
use crate::application::policy_service::load_runtime_policy;
use crate::application::time_slots::{clip_interval, event_to_interval, merge_intervals};
use crate::infrastructure::error::InfraError;
use crate::infrastructure::google_calendar_client::ReqwestGoogleCalendarClient;
use crate::infrastructure::sync_state_repository::SqliteSyncStateRepository;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Instant;

pub use super::legacy::{
    authenticate_google_impl, authenticate_google_sso_impl, AuthenticateGoogleResponse,
};

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
        state.calendar_cache(),
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

    let previous_account_events =
        state.replace_synced_events(&account_id, latest_events, &calendar_id)?;

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
        let _ = state.replace_synced_events(&account_id, refreshed_events, &calendar_id)?;
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

    let snapshots = state.synced_events_snapshot(requested_account.as_deref())?;
    let mut events = Vec::new();
    for (current_account_id, account_events) in snapshots {
        for event in &account_events {
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
                    account_id: current_account_id.clone(),
                    id: event_id,
                    title,
                    start_at: interval.start.to_rfc3339(),
                    end_at: interval.end.to_rfc3339(),
                },
            ));
        }
    }

    events.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(events.into_iter().map(|(_, event)| event).collect())
}
