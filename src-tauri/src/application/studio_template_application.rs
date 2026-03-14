use crate::application::calendar_sync::CalendarSyncService;
use crate::application::commands::{
    ensure_blocks_calendar_id, normalize_account_id, persist_generated_block,
    studio_runtime_snapshot, try_access_token, AppState, StoredBlock,
};
use crate::application::commands::legacy::{
    create_calendar_events_for_generated_blocks, next_id, planned_pomodoros,
};
use crate::application::configured_recipes;
use crate::application::policy_service::load_runtime_policy;
use crate::application::time_slots::{
    event_to_interval, free_slots, intervals_overlap, local_datetime_to_utc, merge_intervals,
    Interval,
};
use crate::domain::models::{Block, BlockContents, Firmness};
use crate::infrastructure::calendar_cache::InMemoryCalendarCacheRepository;
use crate::infrastructure::error::InfraError;
use crate::infrastructure::google_calendar_client::ReqwestGoogleCalendarClient;
use crate::infrastructure::sync_state_repository::SqliteSyncStateRepository;
use chrono::{Duration, NaiveDate, NaiveTime};
use serde::Serialize;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize)]
pub struct ApplyStudioResult {
    pub template_id: String,
    pub date: String,
    pub requested_start_at: String,
    pub requested_end_at: String,
    pub applied_start_at: String,
    pub applied_end_at: String,
    pub shifted: bool,
    pub conflict_count: usize,
    pub block_id: String,
}

pub async fn apply_studio_template_to_today(
    state: &AppState,
    template_id: String,
    date: String,
    trigger_time: String,
    conflict_policy: Option<String>,
    account_id: Option<String>,
) -> Result<ApplyStudioResult, InfraError> {
    let template_id = template_id.trim();
    if template_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "template_id must not be empty".to_string(),
        ));
    }
    let trigger_time_value = NaiveTime::parse_from_str(trigger_time.trim(), "%H:%M").map_err(|error| {
        InfraError::InvalidConfig(format!("trigger_time must be HH:MM: {error}"))
    })?;
    let policy = load_runtime_policy(state.config_dir());
    let account_id = normalize_account_id(account_id);
    let date = NaiveDate::parse_from_str(date.trim(), "%Y-%m-%d")
        .map_err(|error| InfraError::InvalidConfig(format!("date must be YYYY-MM-DD: {error}")))?;
    let resolved_conflict_policy = conflict_policy
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("shift");
    if !resolved_conflict_policy.eq_ignore_ascii_case("shift") {
        return Err(InfraError::InvalidConfig(
            "unsupported conflict_policy (expected 'shift')".to_string(),
        ));
    }

    let recipes = configured_recipes::load_configured_recipes(state.config_dir());
    let template = recipes
        .iter()
        .find(|candidate| candidate.id == template_id)
        .ok_or_else(|| InfraError::InvalidConfig(format!("template not found: {template_id}")))?;
    if !configured_recipes::recipe_is_routine_studio(template) {
        return Err(InfraError::InvalidConfig(
            "template is not a routine studio template".to_string(),
        ));
    }

    let total_seconds = template
        .steps
        .iter()
        .map(|step| step.duration_seconds as i64)
        .sum::<i64>();
    if total_seconds <= 0 {
        return Err(InfraError::InvalidConfig(
            "template steps must have positive duration".to_string(),
        ));
    }

    let requested_start = local_datetime_to_utc(date, trigger_time_value, policy.timezone)?;
    let requested_end = requested_start + Duration::seconds(total_seconds);
    let requested_interval = Interval {
        start: requested_start,
        end: requested_end,
    };

    let (existing_blocks, synced_events_by_account, mut blocks_calendar_ids) =
        studio_runtime_snapshot(state, date)?;

    let mut busy_intervals = Vec::new();
    for stored in &existing_blocks {
        busy_intervals.push(Interval {
            start: stored.block.start_at,
            end: stored.block.end_at,
        });
    }
    if let Some(events) = synced_events_by_account.get(&account_id) {
        for event in events {
            if let Some(interval) = event_to_interval(event) {
                busy_intervals.push(interval);
            }
        }
    } else {
        for events in synced_events_by_account.values() {
            for event in events {
                if let Some(interval) = event_to_interval(event) {
                    busy_intervals.push(interval);
                }
            }
        }
    }

    let conflict_count = busy_intervals
        .iter()
        .filter(|interval| intervals_overlap(interval, &requested_interval))
        .count();

    let merged_busy = merge_intervals(busy_intervals);
    let mut applied_start = requested_start;
    let mut applied_end = requested_end;
    let mut shifted = false;
    if merged_busy
        .iter()
        .any(|interval| intervals_overlap(interval, &requested_interval))
    {
        let day_start = local_datetime_to_utc(
            date,
            NaiveTime::from_hms_opt(0, 0, 0).expect("valid fixed time"),
            policy.timezone,
        )?;
        let day_end = day_start + Duration::days(1);
        let slots = free_slots(day_start, day_end, &merged_busy);
        let mut found = None;
        for slot in slots {
            let candidate_start = if slot.start < requested_start {
                requested_start
            } else {
                slot.start
            };
            let candidate_end = candidate_start + Duration::seconds(total_seconds);
            if candidate_end <= slot.end {
                found = Some((candidate_start, candidate_end));
                break;
            }
        }
        let Some((shifted_start, shifted_end)) = found else {
            return Err(InfraError::InvalidConfig(
                "no available free slot to apply template today".to_string(),
            ));
        };
        applied_start = shifted_start;
        applied_end = shifted_end;
        shifted = true;
    }

    let duration_minutes = ((total_seconds + 59) / 60) as u32;
    let mut generated = vec![StoredBlock {
        block: Block {
            id: next_id("blk"),
            instance: format!("studio:{}:{}:{}", template_id, date, next_id("inst")),
            date: date.to_string(),
            start_at: applied_start,
            end_at: applied_end,
            firmness: Firmness::Draft,
            planned_pomodoros: planned_pomodoros(duration_minutes, policy.break_duration_minutes),
            source: "routine_studio".to_string(),
            source_id: Some(template_id.to_string()),
            recipe_id: template.id.clone(),
            auto_drive_mode: template.auto_drive_mode.clone(),
            contents: BlockContents::default(),
        },
        calendar_event_id: None,
        calendar_account_id: Some(account_id.clone()),
    }];

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
            blocks_calendar_ids.insert(account_id.clone(), resolved);
        }
    }

    let calendar_id = blocks_calendar_ids.get(&account_id).map(String::as_str);
    if let (Some(token), Some(calendar_id)) = (access_token.as_deref(), calendar_id) {
        let calendar_client = Arc::new(ReqwestGoogleCalendarClient::new());
        let sync_state_repo = Arc::new(SqliteSyncStateRepository::new(state.database_path()));
        let sync_service = Arc::new(
            CalendarSyncService::<
                ReqwestGoogleCalendarClient,
                SqliteSyncStateRepository,
                InMemoryCalendarCacheRepository,
            >::new(Arc::clone(&calendar_client), sync_state_repo, state.calendar_cache()),
        );
        create_calendar_events_for_generated_blocks(sync_service, token, calendar_id, &mut generated)
            .await?;
    }

    let created = generated.remove(0);
    persist_generated_block(state, &account_id, &blocks_calendar_ids, created.clone())?;

    state.log_info(
        "apply_studio_template_to_today",
        &format!(
            "template_id={} date={} shifted={} conflict_count={} block_id={}",
            template_id, date, shifted, conflict_count, created.block.id
        ),
    );
    Ok(ApplyStudioResult {
        template_id: template_id.to_string(),
        date: date.to_string(),
        requested_start_at: requested_start.to_rfc3339(),
        requested_end_at: requested_end.to_rfc3339(),
        applied_start_at: created.block.start_at.to_rfc3339(),
        applied_end_at: created.block.end_at.to_rfc3339(),
        shifted,
        conflict_count,
        block_id: created.block.id,
    })
}
