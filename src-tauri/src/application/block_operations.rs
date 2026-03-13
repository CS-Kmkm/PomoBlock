use crate::application::calendar_sync::CalendarSyncService;
use crate::application::commands::legacy::{
    is_cancelled_event, lock_runtime, normalize_account_id, save_suppression,
    try_access_token, AppState, DEFAULT_ACCOUNT_ID,
};
use crate::application::policy_service::load_runtime_policy;
use crate::application::time_slots::{
    clip_interval, event_to_interval, free_slots, intervals_overlap, local_datetime_to_utc,
    merge_intervals, parse_rfc3339_input, Interval,
};
use crate::domain::models::{Block, Firmness};
use crate::infrastructure::calendar_cache::InMemoryCalendarCacheRepository;
use crate::infrastructure::error::InfraError;
use crate::infrastructure::event_mapper::encode_block_event;
use crate::infrastructure::google_calendar_client::ReqwestGoogleCalendarClient;
use crate::infrastructure::sync_state_repository::SqliteSyncStateRepository;
use chrono::NaiveDate;
use std::collections::HashMap;
use std::sync::Arc;

pub async fn approve_blocks(
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
        let sync_service = build_sync_service(state);
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

pub async fn delete_block(state: &AppState, block_id: String) -> Result<bool, InfraError> {
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
            build_sync_service(state)
                .delete_event(token, calendar_id, &calendar_event_id)
                .await?;
        }
    }

    state.log_info("delete_block", &format!("deleted block_id={block_id}"));
    Ok(true)
}

pub async fn adjust_block_time(
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
            let event = encode_block_event(&updated_block);
            build_sync_service(state)
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

pub async fn relocate_if_needed(
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
            let event = encode_block_event(&updated_block);
            build_sync_service(state)
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

pub fn list_blocks(state: &AppState, date: Option<String>) -> Result<Vec<Block>, InfraError> {
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

fn build_sync_service(
    state: &AppState,
) -> CalendarSyncService<
    ReqwestGoogleCalendarClient,
    SqliteSyncStateRepository,
    InMemoryCalendarCacheRepository,
> {
    let calendar_client = Arc::new(ReqwestGoogleCalendarClient::new());
    let sync_state_repo = Arc::new(SqliteSyncStateRepository::new(state.database_path()));
    CalendarSyncService::new(calendar_client, sync_state_repo, state.calendar_cache())
}
