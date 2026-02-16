use crate::infrastructure::calendar_cache::CalendarCacheRepository;
use crate::infrastructure::error::InfraError;
use crate::infrastructure::event_mapper::GoogleCalendarEvent;
use crate::infrastructure::google_calendar_client::{
    GoogleCalendarClient, ListEventsRequest, ListEventsResponse,
};
use crate::infrastructure::sync_state_repository::SyncStateRepository;
use chrono::{DateTime, Utc};
use std::sync::Arc;
use tokio::time::{sleep, Duration as TokioDuration};

type NowProvider = Arc<dyn Fn() -> DateTime<Utc> + Send + Sync>;

#[derive(Debug, Clone)]
pub struct RetryPolicy {
    pub max_attempts: u8,
    pub base_delay_ms: u64,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            base_delay_ms: 200,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SyncResult {
    pub added: Vec<GoogleCalendarEvent>,
    pub updated: Vec<GoogleCalendarEvent>,
    pub deleted: Vec<String>,
    pub next_sync_token: Option<String>,
}

pub struct CalendarSyncService<C, S, R>
where
    C: GoogleCalendarClient,
    S: SyncStateRepository,
    R: CalendarCacheRepository,
{
    calendar_client: Arc<C>,
    sync_state_repository: Arc<S>,
    cache_repository: Arc<R>,
    retry_policy: RetryPolicy,
    now_provider: NowProvider,
}

impl<C, S, R> CalendarSyncService<C, S, R>
where
    C: GoogleCalendarClient,
    S: SyncStateRepository,
    R: CalendarCacheRepository,
{
    pub fn new(
        calendar_client: Arc<C>,
        sync_state_repository: Arc<S>,
        cache_repository: Arc<R>,
    ) -> Self {
        Self {
            calendar_client,
            sync_state_repository,
            cache_repository,
            retry_policy: RetryPolicy::default(),
            now_provider: Arc::new(Utc::now),
        }
    }

    pub fn with_retry_policy(mut self, retry_policy: RetryPolicy) -> Self {
        self.retry_policy = retry_policy;
        self
    }

    pub fn with_now_provider(mut self, now_provider: NowProvider) -> Self {
        self.now_provider = now_provider;
        self
    }

    pub async fn sync(
        &self,
        access_token: &str,
        calendar_id: &str,
        time_min: DateTime<Utc>,
        time_max: DateTime<Utc>,
    ) -> Result<SyncResult, InfraError> {
        let previous_state = self.sync_state_repository.load()?;
        let previous_sync_token = previous_state.and_then(|state| state.sync_token);

        let initial_request = ListEventsRequest {
            time_min: Some(time_min),
            time_max: Some(time_max),
            sync_token: previous_sync_token.clone(),
        };

        let response = match self
            .list_events_with_retry(access_token, calendar_id, initial_request)
            .await
        {
            Ok(response) => response,
            Err(InfraError::SyncTokenExpired) if previous_sync_token.is_some() => {
                self.list_events_with_retry(
                    access_token,
                    calendar_id,
                    ListEventsRequest {
                        time_min: Some(time_min),
                        time_max: Some(time_max),
                        sync_token: None,
                    },
                )
                .await?
            }
            Err(error) => return Err(error),
        };

        let sync_result = self.apply_events(response.events)?;
        self.sync_state_repository
            .save(response.next_sync_token.as_deref(), (self.now_provider)())?;

        Ok(SyncResult {
            added: sync_result.added,
            updated: sync_result.updated,
            deleted: sync_result.deleted,
            next_sync_token: response.next_sync_token,
        })
    }

    pub async fn fetch_events(
        &self,
        access_token: &str,
        calendar_id: &str,
        time_min: DateTime<Utc>,
        time_max: DateTime<Utc>,
    ) -> Result<Vec<GoogleCalendarEvent>, InfraError> {
        let response = self
            .list_events_with_retry(
                access_token,
                calendar_id,
                ListEventsRequest {
                    time_min: Some(time_min),
                    time_max: Some(time_max),
                    sync_token: None,
                },
            )
            .await?;
        Ok(response.events)
    }

    pub async fn create_event(
        &self,
        access_token: &str,
        calendar_id: &str,
        event: &GoogleCalendarEvent,
    ) -> Result<String, InfraError> {
        let created_id = self
            .calendar_client
            .create_event(access_token, calendar_id, event)
            .await?;

        let mut cached = event.clone();
        cached.id = Some(created_id.clone());
        self.cache_repository.upsert(&cached)?;
        Ok(created_id)
    }

    pub async fn update_event(
        &self,
        access_token: &str,
        calendar_id: &str,
        event_id: &str,
        event: &GoogleCalendarEvent,
    ) -> Result<(), InfraError> {
        self.calendar_client
            .update_event(access_token, calendar_id, event_id, event)
            .await?;

        let mut cached = event.clone();
        cached.id = Some(event_id.to_string());
        self.cache_repository.upsert(&cached)?;
        Ok(())
    }

    pub async fn delete_event(
        &self,
        access_token: &str,
        calendar_id: &str,
        event_id: &str,
    ) -> Result<(), InfraError> {
        self.calendar_client
            .delete_event(access_token, calendar_id, event_id)
            .await?;
        self.cache_repository.remove(event_id)?;
        Ok(())
    }

    async fn list_events_with_retry(
        &self,
        access_token: &str,
        calendar_id: &str,
        request: ListEventsRequest,
    ) -> Result<ListEventsResponse, InfraError> {
        let max_attempts = self.retry_policy.max_attempts.max(1);
        let mut attempt: u8 = 0;

        loop {
            match self
                .calendar_client
                .list_events(access_token, calendar_id, request.clone())
                .await
            {
                Ok(response) => return Ok(response),
                Err(error) if self.should_retry(&error) && attempt + 1 < max_attempts => {
                    let delay = self
                        .retry_policy
                        .base_delay_ms
                        .saturating_mul(2u64.saturating_pow(attempt as u32));
                    sleep(TokioDuration::from_millis(delay)).await;
                    attempt = attempt.saturating_add(1);
                }
                Err(error) => return Err(error),
            }
        }
    }

    fn should_retry(&self, error: &InfraError) -> bool {
        match error {
            InfraError::OAuth(message) => {
                let message = message.to_ascii_lowercase();
                message.contains("network error")
                    || message.contains("timeout")
                    || message.contains("timed out")
                    || message.contains("temporarily unavailable")
                    || message.contains("connection reset")
            }
            _ => false,
        }
    }

    fn apply_events(&self, events: Vec<GoogleCalendarEvent>) -> Result<AppliedSyncResult, InfraError> {
        let mut added = Vec::new();
        let mut updated = Vec::new();
        let mut deleted = Vec::new();

        for event in events {
            let Some(event_id) = event
                .id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
            else {
                continue;
            };

            let is_cancelled = event
                .status
                .as_deref()
                .map(|status| status.eq_ignore_ascii_case("cancelled"))
                .unwrap_or(false);
            let existing = self.cache_repository.get_by_id(&event_id)?;

            if is_cancelled {
                if existing.is_some() {
                    self.cache_repository.remove(&event_id)?;
                    deleted.push(event_id);
                }
                continue;
            }

            match existing {
                None => {
                    self.cache_repository.upsert(&event)?;
                    added.push(event);
                }
                Some(cached) if cached != event => {
                    self.cache_repository.upsert(&event)?;
                    updated.push(event);
                }
                Some(_) => {}
            }
        }

        Ok(AppliedSyncResult {
            added,
            updated,
            deleted,
        })
    }
}

struct AppliedSyncResult {
    added: Vec<GoogleCalendarEvent>,
    updated: Vec<GoogleCalendarEvent>,
    deleted: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::calendar_cache::{CalendarCacheRepository, InMemoryCalendarCacheRepository};
    use crate::infrastructure::event_mapper::CalendarEventDateTime;
    use crate::infrastructure::google_calendar_client::GoogleCalendarSummary;
    use crate::infrastructure::sync_state_repository::InMemorySyncStateRepository;
    use async_trait::async_trait;
    use proptest::prelude::*;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    #[derive(Debug, Clone)]
    enum FakeListResponse {
        Success(ListEventsResponse),
        NetworkError,
        SyncTokenExpired,
    }

    #[derive(Debug)]
    struct FakeGoogleCalendarClient {
        list_responses: Mutex<VecDeque<FakeListResponse>>,
        list_calls: AtomicUsize,
    }

    impl FakeGoogleCalendarClient {
        fn with_list_responses(responses: Vec<FakeListResponse>) -> Self {
            Self {
                list_responses: Mutex::new(responses.into()),
                list_calls: AtomicUsize::new(0),
            }
        }
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
            self.list_calls.fetch_add(1, Ordering::SeqCst);

            let response = self
                .list_responses
                .lock()
                .expect("list response lock poisoned")
                .pop_front()
                .unwrap_or_else(|| {
                    FakeListResponse::Success(ListEventsResponse {
                        events: Vec::new(),
                        next_sync_token: Some("default-token".to_string()),
                    })
                });

            match response {
                FakeListResponse::Success(value) => Ok(value),
                FakeListResponse::NetworkError => {
                    Err(InfraError::OAuth("network error while listing calendar events".to_string()))
                }
                FakeListResponse::SyncTokenExpired => Err(InfraError::SyncTokenExpired),
            }
        }

        async fn create_event(
            &self,
            _access_token: &str,
            _calendar_id: &str,
            _event: &GoogleCalendarEvent,
        ) -> Result<String, InfraError> {
            Ok("created-event".to_string())
        }

        async fn update_event(
            &self,
            _access_token: &str,
            _calendar_id: &str,
            _event_id: &str,
            _event: &GoogleCalendarEvent,
        ) -> Result<(), InfraError> {
            Ok(())
        }

        async fn delete_event(
            &self,
            _access_token: &str,
            _calendar_id: &str,
            _event_id: &str,
        ) -> Result<(), InfraError> {
            Ok(())
        }
    }

    fn fixed_time() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-02-16T00:00:00Z")
            .expect("valid datetime")
            .with_timezone(&Utc)
    }

    fn sample_event(id: &str, summary: &str, status: &str) -> GoogleCalendarEvent {
        GoogleCalendarEvent {
            id: Some(id.to_string()),
            summary: Some(summary.to_string()),
            description: None,
            status: Some(status.to_string()),
            updated: Some("2026-02-16T00:00:00Z".to_string()),
            etag: Some(format!("etag-{id}-{summary}-{status}")),
            start: CalendarEventDateTime {
                date_time: "2026-02-16T00:00:00Z".to_string(),
                time_zone: None,
            },
            end: CalendarEventDateTime {
                date_time: "2026-02-16T01:00:00Z".to_string(),
                time_zone: None,
            },
            extended_properties: None,
        }
    }

    fn token_pattern() -> impl Strategy<Value = String> {
        "[A-Za-z0-9_\\-]{1,32}".prop_map(|value| value.to_string())
    }

    // Feature: blocksched, Property 5: external edits are detected and reflected
    proptest! {
        #[test]
        fn property5_external_edits_detected_and_reflected(summary in token_pattern()) {
            let runtime = tokio::runtime::Runtime::new().expect("runtime");
            runtime.block_on(async move {
                let client = Arc::new(FakeGoogleCalendarClient::with_list_responses(vec![
                    FakeListResponse::Success(ListEventsResponse {
                        events: vec![
                            sample_event("evt-updated", &summary, "confirmed"),
                            sample_event("evt-deleted", "obsolete", "cancelled"),
                        ],
                        next_sync_token: Some("next-sync".to_string()),
                    })
                ]));
                let sync_repo = Arc::new(InMemorySyncStateRepository::default());
                sync_repo.save(Some("prev-sync"), fixed_time()).expect("save previous state");

                let cache = Arc::new(InMemoryCalendarCacheRepository::default());
                cache.upsert(&sample_event("evt-updated", "old-value", "confirmed"))
                    .expect("cache seed update event");
                cache.upsert(&sample_event("evt-deleted", "will-delete", "confirmed"))
                    .expect("cache seed deleted event");

                let service = CalendarSyncService::new(Arc::clone(&client), Arc::clone(&sync_repo), Arc::clone(&cache))
                    .with_retry_policy(RetryPolicy { max_attempts: 1, base_delay_ms: 1 });

                let result = service.sync("access-token", "primary", fixed_time(), fixed_time()).await.expect("sync success");

                assert_eq!(result.updated.len(), 1);
                assert_eq!(result.deleted, vec!["evt-deleted".to_string()]);

                let cached_updated = cache.get_by_id("evt-updated").expect("cache read").expect("updated event exists");
                assert_eq!(cached_updated.summary.as_deref(), Some(summary.as_str()));
                assert!(cache.get_by_id("evt-deleted").expect("cache read deleted").is_none());
            });
        }
    }

    // Feature: blocksched, Property 6: sync token is saved after synchronization
    proptest! {
        #[test]
        fn property6_sync_token_saved_after_sync(sync_token in token_pattern()) {
            let runtime = tokio::runtime::Runtime::new().expect("runtime");
            runtime.block_on(async move {
                let client = Arc::new(FakeGoogleCalendarClient::with_list_responses(vec![
                    FakeListResponse::Success(ListEventsResponse {
                        events: vec![],
                        next_sync_token: Some(sync_token.clone()),
                    })
                ]));
                let sync_repo = Arc::new(InMemorySyncStateRepository::default());
                let cache = Arc::new(InMemoryCalendarCacheRepository::default());
                let service = CalendarSyncService::new(client, Arc::clone(&sync_repo), cache)
                    .with_retry_policy(RetryPolicy { max_attempts: 1, base_delay_ms: 1 });

                let _ = service.sync("access-token", "primary", fixed_time(), fixed_time()).await.expect("sync success");
                let saved = sync_repo.load().expect("load state").expect("state exists");

                assert_eq!(saved.sync_token, Some(sync_token));
            });
        }
    }

    // Feature: blocksched, Property 7: cache is updated to latest state after synchronization
    proptest! {
        #[test]
        fn property7_cache_matches_latest_after_sync(event_id in token_pattern(), summary in token_pattern()) {
            let runtime = tokio::runtime::Runtime::new().expect("runtime");
            runtime.block_on(async move {
                let remote = sample_event(&event_id, &summary, "confirmed");
                let client = Arc::new(FakeGoogleCalendarClient::with_list_responses(vec![
                    FakeListResponse::Success(ListEventsResponse {
                        events: vec![remote.clone()],
                        next_sync_token: Some("next-sync".to_string()),
                    })
                ]));
                let sync_repo = Arc::new(InMemorySyncStateRepository::default());
                let cache = Arc::new(InMemoryCalendarCacheRepository::default());
                let service = CalendarSyncService::new(client, sync_repo, Arc::clone(&cache))
                    .with_retry_policy(RetryPolicy { max_attempts: 1, base_delay_ms: 1 });

                let _ = service.sync("access-token", "primary", fixed_time(), fixed_time()).await.expect("sync success");
                let cached = cache.get_by_id(&event_id).expect("cache read").expect("cached event exists");
                assert_eq!(cached, remote);
            });
        }
    }

    #[tokio::test]
    async fn sync_retries_on_network_error() {
        let client = Arc::new(FakeGoogleCalendarClient::with_list_responses(vec![
            FakeListResponse::NetworkError,
            FakeListResponse::Success(ListEventsResponse {
                events: vec![sample_event("evt-1", "Recovered", "confirmed")],
                next_sync_token: Some("sync-after-retry".to_string()),
            }),
        ]));
        let sync_repo = Arc::new(InMemorySyncStateRepository::default());
        let cache = Arc::new(InMemoryCalendarCacheRepository::default());
        let service = CalendarSyncService::new(Arc::clone(&client), Arc::clone(&sync_repo), cache)
            .with_retry_policy(RetryPolicy {
                max_attempts: 2,
                base_delay_ms: 1,
            });

        let result = service
            .sync("access-token", "primary", fixed_time(), fixed_time())
            .await
            .expect("sync after retry");

        assert_eq!(result.added.len(), 1);
        assert_eq!(client.list_calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn sync_recovers_from_expired_sync_token() {
        let client = Arc::new(FakeGoogleCalendarClient::with_list_responses(vec![
            FakeListResponse::SyncTokenExpired,
            FakeListResponse::Success(ListEventsResponse {
                events: vec![sample_event("evt-1", "Full Sync", "confirmed")],
                next_sync_token: Some("fresh-sync-token".to_string()),
            }),
        ]));
        let sync_repo = Arc::new(InMemorySyncStateRepository::default());
        sync_repo
            .save(Some("stale-sync-token"), fixed_time())
            .expect("seed stale token");
        let cache = Arc::new(InMemoryCalendarCacheRepository::default());
        let service = CalendarSyncService::new(Arc::clone(&client), Arc::clone(&sync_repo), cache)
            .with_retry_policy(RetryPolicy {
                max_attempts: 1,
                base_delay_ms: 1,
            });

        let result = service
            .sync("access-token", "primary", fixed_time(), fixed_time())
            .await
            .expect("sync should recover");

        assert_eq!(result.added.len(), 1);
        assert_eq!(client.list_calls.load(Ordering::SeqCst), 2);
        let saved_state = sync_repo.load().expect("load state").expect("state exists");
        assert_eq!(saved_state.sync_token, Some("fresh-sync-token".to_string()));
    }
}
