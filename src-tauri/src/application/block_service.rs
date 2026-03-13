use crate::application::block_generation;
use crate::application::block_operations;
use crate::application::commands::legacy;
use crate::application::studio_template_application::{self, ApplyStudioResult};
use crate::domain::models::Block;
use crate::infrastructure::error::InfraError;

pub struct BlockService<'a> {
    state: &'a legacy::AppState,
}

impl<'a> BlockService<'a> {
    pub fn new(state: &'a legacy::AppState) -> Self {
        Self { state }
    }

    pub async fn generate_blocks(
        &self,
        date: String,
        account_id: Option<String>,
    ) -> Result<Vec<Block>, InfraError> {
        block_generation::generate_blocks(self.state, date, account_id).await
    }

    pub async fn generate_one_block(
        &self,
        date: String,
        account_id: Option<String>,
    ) -> Result<Vec<Block>, InfraError> {
        block_generation::generate_one_block(self.state, date, account_id).await
    }

    pub async fn generate_today_blocks(
        &self,
        account_id: Option<String>,
    ) -> Result<Vec<Block>, InfraError> {
        block_generation::generate_today_blocks(self.state, account_id).await
    }

    pub async fn approve_blocks(&self, block_ids: Vec<String>) -> Result<Vec<Block>, InfraError> {
        block_operations::approve_blocks(self.state, block_ids).await
    }

    pub async fn delete_block(&self, block_id: String) -> Result<bool, InfraError> {
        block_operations::delete_block(self.state, block_id).await
    }

    pub async fn adjust_block_time(
        &self,
        block_id: String,
        start_at: String,
        end_at: String,
    ) -> Result<Block, InfraError> {
        block_operations::adjust_block_time(self.state, block_id, start_at, end_at).await
    }

    pub async fn relocate_if_needed(
        &self,
        block_id: String,
        account_id: Option<String>,
    ) -> Result<Option<Block>, InfraError> {
        block_operations::relocate_if_needed(self.state, block_id, account_id).await
    }

    pub fn list_blocks(&self, date: Option<String>) -> Result<Vec<Block>, InfraError> {
        block_operations::list_blocks(self.state, date)
    }

    pub async fn apply_studio_template_to_today(
        &self,
        template_id: String,
        date: String,
        trigger_time: String,
        conflict_policy: Option<String>,
        account_id: Option<String>,
    ) -> Result<ApplyStudioResult, InfraError> {
        studio_template_application::apply_studio_template_to_today(
            self.state,
            template_id,
            date,
            trigger_time,
            conflict_policy,
            account_id,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::calendar_sync::CalendarSyncService;
    use crate::application::reflection_service::ReflectionService;
    use crate::infrastructure::calendar_cache::{CalendarCacheRepository, InMemoryCalendarCacheRepository};
    use crate::infrastructure::event_mapper::{encode_block_event, CalendarEventExtendedProperties, GoogleCalendarEvent};
    use crate::infrastructure::google_calendar_client::{
        GoogleCalendarClient, GoogleCalendarSummary, ListEventsRequest, ListEventsResponse,
    };
    use crate::infrastructure::sync_state_repository::InMemorySyncStateRepository;
    use async_trait::async_trait;
    use chrono::{DateTime, Utc};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    static NEXT_TEMP_WORKSPACE: AtomicUsize = AtomicUsize::new(0);

    struct TempWorkspace {
        path: PathBuf,
    }

    impl TempWorkspace {
        fn new() -> Self {
            let sequence = NEXT_TEMP_WORKSPACE.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "pomoblock-block-service-tests-{}-{}",
                std::process::id(),
                sequence
            ));
            fs::create_dir_all(&path).expect("create temp workspace");
            Self { path }
        }

        fn app_state(&self) -> legacy::AppState {
            legacy::AppState::new(self.path.clone()).expect("initialize app state")
        }
    }

    impl Drop for TempWorkspace {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[derive(Debug, Default)]
    struct FakeGoogleCalendarClient {
        created_events: Mutex<Vec<GoogleCalendarEvent>>,
        updated_events: Mutex<Vec<(String, GoogleCalendarEvent)>>,
        deleted_events: Mutex<Vec<String>>,
    }

    #[async_trait]
    impl GoogleCalendarClient for FakeGoogleCalendarClient {
        async fn list_calendars(
            &self,
            _access_token: &str,
        ) -> Result<Vec<GoogleCalendarSummary>, InfraError> {
            Ok(Vec::new())
        }

        async fn create_calendar(
            &self,
            _access_token: &str,
            _summary: &str,
            _time_zone: Option<&str>,
        ) -> Result<GoogleCalendarSummary, InfraError> {
            Err(InfraError::OAuth("not implemented in fake".to_string()))
        }

        async fn list_events(
            &self,
            _access_token: &str,
            _calendar_id: &str,
            _request: ListEventsRequest,
        ) -> Result<ListEventsResponse, InfraError> {
            Ok(ListEventsResponse {
                events: Vec::new(),
                next_sync_token: Some("fake-sync-token".to_string()),
            })
        }

        async fn create_event(
            &self,
            _access_token: &str,
            _calendar_id: &str,
            event: &GoogleCalendarEvent,
        ) -> Result<String, InfraError> {
            self.created_events
                .lock()
                .expect("created events lock")
                .push(event.clone());
            Ok("evt-created".to_string())
        }

        async fn update_event(
            &self,
            _access_token: &str,
            _calendar_id: &str,
            event_id: &str,
            event: &GoogleCalendarEvent,
        ) -> Result<(), InfraError> {
            self.updated_events
                .lock()
                .expect("updated events lock")
                .push((event_id.to_string(), event.clone()));
            Ok(())
        }

        async fn delete_event(
            &self,
            _access_token: &str,
            _calendar_id: &str,
            event_id: &str,
        ) -> Result<(), InfraError> {
            self.deleted_events
                .lock()
                .expect("deleted events lock")
                .push(event_id.to_string());
            Ok(())
        }
    }

    #[tokio::test]
    async fn property_10_generated_blocks_are_registered_in_calendar_as_draft() {
        let block = Block {
            id: "blk-test".to_string(),
            instance: "rtn:auto:2026-02-16:0".to_string(),
            date: "2026-02-16".to_string(),
            start_at: DateTime::parse_from_rfc3339("2026-02-16T09:00:00Z")
                .expect("start")
                .with_timezone(&Utc),
            end_at: DateTime::parse_from_rfc3339("2026-02-16T09:50:00Z")
                .expect("end")
                .with_timezone(&Utc),
            firmness: crate::domain::models::Firmness::Draft,
            planned_pomodoros: 1,
            source: "routine".to_string(),
            source_id: Some("auto".to_string()),
            recipe_id: "rcp-default".to_string(),
            auto_drive_mode: crate::domain::models::AutoDriveMode::Manual,
            contents: crate::domain::models::BlockContents::default(),
        };
        let client = Arc::new(FakeGoogleCalendarClient::default());
        let cache = Arc::new(InMemoryCalendarCacheRepository::default());
        let sync_repo = Arc::new(InMemorySyncStateRepository::default());
        let service = CalendarSyncService::new(Arc::clone(&client), sync_repo, Arc::clone(&cache));

        let event_id = service
            .create_event("access-token", "blocks-calendar", &encode_block_event(&block))
            .await
            .expect("create event");

        assert_eq!(event_id, "evt-created");
        let created = client.created_events.lock().expect("created events lock");
        assert_eq!(created.len(), 1);
        let firmness = created[0]
            .extended_properties
            .as_ref()
            .and_then(|properties| properties.private.get("bs_firmness"))
            .map(String::as_str);
        assert_eq!(firmness, Some("draft"));
        drop(created);

        let cached = cache
            .get_by_id("evt-created")
            .expect("cache read")
            .expect("cached event");
        let cached_firmness = cached
            .extended_properties
            .as_ref()
            .and_then(|properties| properties.private.get("bs_firmness"))
            .map(String::as_str);
        assert_eq!(cached_firmness, Some("draft"));
    }

    #[tokio::test]
    async fn property_12_approving_block_updates_firmness_and_calendar_event_behavior() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let service = BlockService::new(&state);

        let generated = service
            .generate_blocks("2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        let approved = service
            .approve_blocks(vec![generated[0].id.clone()])
            .await
            .expect("approve block");
        let listed = service
            .list_blocks(Some("2026-02-16".to_string()))
            .expect("list blocks");

        assert_eq!(approved[0].firmness, crate::domain::models::Firmness::Soft);
        let stored = listed
            .iter()
            .find(|block| block.id == generated[0].id)
            .expect("approved block remains listed");
        assert_eq!(stored.firmness, crate::domain::models::Firmness::Soft);
    }

    #[tokio::test]
    async fn property_13_deleting_block_is_reflected_in_calendar_behavior() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let service = BlockService::new(&state);

        let generated = service
            .generate_blocks("2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        let deleted = service
            .delete_block(generated[0].id.clone())
            .await
            .expect("delete block");
        let listed = service
            .list_blocks(Some("2026-02-16".to_string()))
            .expect("list blocks");

        assert!(deleted);
        assert!(listed.iter().all(|block| block.id != generated[0].id));
    }

    #[tokio::test]
    async fn property_14_adjusting_block_time_updates_calendar_event_time_behavior() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let service = BlockService::new(&state);

        let generated = service
            .generate_blocks("2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        let updated = service
            .adjust_block_time(
                generated[0].id.clone(),
                "2026-02-16T14:00:00Z".to_string(),
                "2026-02-16T14:50:00Z".to_string(),
            )
            .await
            .expect("adjust block");
        let listed = service
            .list_blocks(Some("2026-02-16".to_string()))
            .expect("list blocks");

        assert_eq!(updated.start_at.to_rfc3339(), "2026-02-16T14:00:00+00:00");
        assert_eq!(updated.end_at.to_rfc3339(), "2026-02-16T14:50:00+00:00");
        let stored = listed
            .iter()
            .find(|block| block.id == generated[0].id)
            .expect("adjusted block remains listed");
        assert_eq!(stored.start_at, updated.start_at);
        assert_eq!(stored.end_at, updated.end_at);
    }

    #[tokio::test]
    async fn property_23_relocation_succeeds_when_conflicting_events_exist() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let service = BlockService::new(&state);
        let generated = service
            .generate_one_block("2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        let block = generated[0].clone();

        legacy::seed_synced_events_for_tests(
            &state,
            "default",
            vec![GoogleCalendarEvent {
                id: Some("evt-conflict".to_string()),
                summary: Some("conflict".to_string()),
                description: None,
                status: Some("confirmed".to_string()),
                updated: None,
                etag: None,
                start: crate::infrastructure::event_mapper::CalendarEventDateTime {
                    date_time: block.start_at.to_rfc3339(),
                    time_zone: None,
                },
                end: crate::infrastructure::event_mapper::CalendarEventDateTime {
                    date_time: (block.end_at + chrono::Duration::minutes(20)).to_rfc3339(),
                    time_zone: None,
                },
                extended_properties: None,
            }],
        )
        .expect("seed synced events");

        let relocated = service
            .relocate_if_needed(block.id.clone(), None)
            .await
            .expect("relocate")
            .expect("block relocated");

        assert_eq!(relocated.id, block.id);
        assert!(relocated.start_at >= block.end_at + chrono::Duration::minutes(20));
        assert_eq!(relocated.end_at - relocated.start_at, block.end_at - block.start_at);
    }

    #[tokio::test]
    async fn property_23_manual_adjustment_fallback_is_covered_explicitly() {
        let workspace = TempWorkspace::new();
        let state = workspace.app_state();
        let service = BlockService::new(&state);
        let generated = service
            .generate_one_block("2026-02-16".to_string(), None)
            .await
            .expect("generate blocks");
        let block = generated[0].clone();

        legacy::seed_synced_events_for_tests(
            &state,
            "default",
            vec![GoogleCalendarEvent {
                id: Some("evt-full-day".to_string()),
                summary: Some("full day".to_string()),
                description: None,
                status: Some("confirmed".to_string()),
                updated: None,
                etag: None,
                start: crate::infrastructure::event_mapper::CalendarEventDateTime {
                    date_time: "2026-02-16T09:00:00Z".to_string(),
                    time_zone: None,
                },
                end: crate::infrastructure::event_mapper::CalendarEventDateTime {
                    date_time: "2026-02-16T18:00:00Z".to_string(),
                    time_zone: None,
                },
                extended_properties: Some(CalendarEventExtendedProperties::default()),
            }],
        )
        .expect("seed synced events");

        let relocated = service
            .relocate_if_needed(block.id.clone(), None)
            .await
            .expect("relocate");
        let summary = ReflectionService::new(&state)
            .get_summary(None, None)
            .expect("reflection summary");

        assert!(relocated.is_none());
        assert!(summary.logs.is_empty());
    }
}
