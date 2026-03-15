use crate::application::commands::{lock_runtime, AppState, RuntimeState, DEFAULT_ACCOUNT_ID};
use crate::application::time_slots::{intervals_overlap, Interval};
use crate::infrastructure::error::InfraError;
use crate::infrastructure::event_mapper::GoogleCalendarEvent;
use chrono::{NaiveDate, Utc};
use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::path::Path;
use std::time::Instant;

pub(crate) fn save_suppression(
    database_path: &Path,
    instance: &str,
    reason: Option<&str>,
) -> Result<(), InfraError> {
    let single = vec![instance.to_string()];
    let _ = save_suppressions(database_path, &single, reason)?;
    Ok(())
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

pub(crate) fn is_cancelled_event(event: &GoogleCalendarEvent) -> bool {
    event
        .status
        .as_deref()
        .map(|status| status.eq_ignore_ascii_case("cancelled"))
        .unwrap_or(false)
}

fn instance_matches_date(instance: &str, date_key: &str) -> bool {
    if instance.is_empty() || date_key.is_empty() {
        return false;
    }
    instance.ends_with(&format!(":{date_key}")) || instance.contains(&format!(":{date_key}:"))
}

pub(crate) fn collect_relocation_target_block_ids(
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
