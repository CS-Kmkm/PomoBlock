use crate::application::block_calendar_events::{
    create_calendar_events_for_generated_blocks, planned_pomodoros,
};
use crate::application::calendar_sync::CalendarSyncService;
use crate::application::calendar_runtime::{
    clear_user_deleted_suppressions_for_date, load_suppressions,
};
use crate::application::commands::{
    block_runtime_snapshot, ensure_blocks_calendar_id, normalize_account_id,
    persist_generated_blocks, try_access_token, AppState, StoredBlock,
};
use crate::application::configured_block_plans;
use crate::application::configured_recipes;
use crate::application::id_factory::next_id;
use crate::application::policy_service::load_runtime_policy;
use crate::application::time_slots::{
    clip_interval, event_to_interval, free_slots, intervals_overlap, local_datetime_to_utc,
    merge_intervals, Interval,
};
use crate::domain::models::{Block, BlockContents, Firmness};
use crate::infrastructure::calendar_cache::InMemoryCalendarCacheRepository;
use crate::infrastructure::error::InfraError;
use crate::infrastructure::google_calendar_client::ReqwestGoogleCalendarClient;
use crate::infrastructure::sync_state_repository::SqliteSyncStateRepository;
use chrono::{Datelike, Duration, NaiveDate, Utc};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Instant;

const BLOCK_GENERATION_TARGET_MS: u128 = 30_000;

pub async fn generate_blocks(
    state: &AppState,
    date: String,
    account_id: Option<String>,
) -> Result<Vec<Block>, InfraError> {
    generate_blocks_with_limit(state, date, account_id, None, false).await
}

pub async fn generate_one_block(
    state: &AppState,
    date: String,
    account_id: Option<String>,
) -> Result<Vec<Block>, InfraError> {
    generate_blocks_with_limit(state, date, account_id, Some(1), true).await
}

pub async fn generate_today_blocks(
    state: &AppState,
    account_id: Option<String>,
) -> Result<Vec<Block>, InfraError> {
    let policy = load_runtime_policy(state.config_dir());
    if !policy.auto_enabled {
        return Ok(Vec::new());
    }
    let today = Utc::now().with_timezone(&policy.timezone).date_naive().to_string();
    generate_blocks(state, today, account_id).await
}

async fn generate_blocks_with_limit(
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
    if !policy.work_days.contains(&date.weekday()) || policy.work_end <= policy.work_start {
        return Ok(Vec::new());
    }

    let window_start = local_datetime_to_utc(date, policy.work_start, policy.timezone)?;
    let window_end = local_datetime_to_utc(date, policy.work_end, policy.timezone)?;
    let block_duration = Duration::minutes(policy.block_duration_minutes as i64);
    let gap = Duration::minutes(policy.min_block_gap_minutes as i64);

    let (existing_blocks, synced_events_by_account, mut blocks_calendar_ids) =
        block_runtime_snapshot(state, date)?;
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
    let recipes = configured_recipes::load_configured_recipes(state.config_dir());
    let candidate_plans =
        configured_block_plans::load_configured_block_plans(state.config_dir(), date, &policy, &recipes);
    let candidate_plan_count = candidate_plans.len();

    for plan in candidate_plans {
        if generated.len() >= max_generated_blocks
            || plan.end_at <= plan.start_at
            || plan.start_at < window_start
            || plan.end_at > window_end
        {
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
            generated.push(StoredBlock {
                block: Block {
                    id: next_id("blk"),
                    instance: plan.instance,
                    date: date.to_string(),
                    start_at: plan.start_at,
                    end_at: plan.end_at,
                    firmness: plan.firmness,
                    planned_pomodoros: plan.planned_pomodoros,
                    source: plan.source,
                    source_id: plan.source_id,
                    recipe_id: plan.recipe_id,
                    auto_drive_mode: plan.auto_drive_mode,
                    contents: BlockContents::default(),
                },
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
            let (recipe_id, auto_drive_mode) =
                configured_block_plans::resolve_recipe_for_plan(None, None, &recipes);
            let instance = format!("rtn:auto:{}:{}", date, instance_index);
            instance_index = instance_index.saturating_add(1);

            let range_key = (
                cursor.timestamp_millis(),
                candidate_end.timestamp_millis(),
            );
            let is_suppressed = !allow_overlap
                && policy.respect_suppression
                && suppressed_instances.contains(instance.as_str());

            if !is_suppressed
                && (allow_overlap
                    || (existing_instances.insert(instance.clone())
                        && existing_ranges.insert(range_key)))
            {
                generated.push(StoredBlock {
                    block: Block {
                        id: next_id("blk"),
                        instance,
                        date: date.to_string(),
                        start_at: cursor,
                        end_at: candidate_end,
                        firmness: Firmness::Draft,
                        planned_pomodoros: planned_pomodoros(
                            policy.block_duration_minutes,
                            policy.break_duration_minutes,
                        ),
                        source: "routine".to_string(),
                        source_id: Some("auto".to_string()),
                        recipe_id,
                        auto_drive_mode,
                        contents: BlockContents::default(),
                    },
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

    persist_generated_blocks(state, &account_id, &blocks_calendar_ids, &generated)?;

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
