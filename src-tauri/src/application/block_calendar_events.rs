use crate::application::calendar_sync::CalendarSyncService;
use crate::application::commands::StoredBlock;
use crate::infrastructure::calendar_cache::InMemoryCalendarCacheRepository;
use crate::infrastructure::error::InfraError;
use crate::infrastructure::event_mapper::encode_block_event;
use crate::infrastructure::google_calendar_client::ReqwestGoogleCalendarClient;
use crate::infrastructure::sync_state_repository::SqliteSyncStateRepository;
use std::sync::Arc;
use tokio::task::JoinSet;

const BLOCK_CREATION_CONCURRENCY: usize = 4;

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
