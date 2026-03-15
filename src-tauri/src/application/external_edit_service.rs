use crate::infrastructure::calendar_cache::CalendarCacheRepository;
use crate::infrastructure::error::InfraError;
use crate::infrastructure::event_mapper::GoogleCalendarEvent;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct ExternalEditResult {
    pub added: Vec<GoogleCalendarEvent>,
    pub updated: Vec<GoogleCalendarEvent>,
    pub deleted: Vec<String>,
    pub suppressed_instances: Vec<String>,
}

pub struct ExternalEditService<R>
where
    R: CalendarCacheRepository,
{
    cache_repository: Arc<R>,
}

impl<R> ExternalEditService<R>
where
    R: CalendarCacheRepository,
{
    pub fn new(cache_repository: Arc<R>) -> Self {
        Self { cache_repository }
    }

    pub fn apply_events(&self, events: Vec<GoogleCalendarEvent>) -> Result<ExternalEditResult, InfraError> {
        let mut added = Vec::new();
        let mut updated = Vec::new();
        let mut deleted = Vec::new();
        let mut suppressed_instances = Vec::new();

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
                if let Some(instance) = extract_managed_instance(&event) {
                    suppressed_instances.push(instance);
                }
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

        Ok(ExternalEditResult {
            added,
            updated,
            deleted,
            suppressed_instances,
        })
    }
}

fn extract_managed_instance(event: &GoogleCalendarEvent) -> Option<String> {
    event
        .extended_properties
        .as_ref()
        .and_then(|properties| properties.private.get("bs_instance"))
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::calendar_cache::{CalendarCacheRepository, InMemoryCalendarCacheRepository};
    use crate::infrastructure::event_mapper::{
        CalendarEventDateTime, CalendarEventExtendedProperties,
    };
    use proptest::prelude::*;

    fn sample_event(id: &str, summary: &str, start: &str, end: &str) -> GoogleCalendarEvent {
        GoogleCalendarEvent {
            id: Some(id.to_string()),
            summary: Some(summary.to_string()),
            description: None,
            status: Some("confirmed".to_string()),
            updated: Some("2026-02-16T00:00:00Z".to_string()),
            etag: Some(format!("etag-{id}-{summary}")),
            start: CalendarEventDateTime {
                date_time: start.to_string(),
                time_zone: None,
            },
            end: CalendarEventDateTime {
                date_time: end.to_string(),
                time_zone: None,
            },
            extended_properties: None,
        }
    }

    fn sample_cancelled_managed_event(id: &str, instance: &str) -> GoogleCalendarEvent {
        let mut event = sample_event(
            id,
            "cancelled",
            "2026-02-16T11:00:00Z",
            "2026-02-16T11:30:00Z",
        );
        event.status = Some("cancelled".to_string());
        event.extended_properties = Some(CalendarEventExtendedProperties {
            private: std::collections::HashMap::from([(
                "bs_instance".to_string(),
                instance.to_string(),
            )]),
        });
        event
    }

    fn token_pattern() -> impl Strategy<Value = String> {
        "[A-Za-z0-9_\\-]{1,32}".prop_map(|value| value.to_string())
    }

    // Feature: blocksched, Property 22: newly added calendar events are detected on sync
    proptest! {
        #[test]
        fn property22_newly_added_calendar_events_are_detected_on_sync(event_id in token_pattern()) {
            let cache = Arc::new(InMemoryCalendarCacheRepository::default());
            let service = ExternalEditService::new(Arc::clone(&cache));
            let event = sample_event(
                &event_id,
                "remote-add",
                "2026-02-16T09:00:00Z",
                "2026-02-16T09:30:00Z",
            );

            let result = service.apply_events(vec![event.clone()]).expect("apply events");

            prop_assert_eq!(result.added, vec![event.clone()]);
            prop_assert!(result.updated.is_empty());
            prop_assert!(result.deleted.is_empty());
            let cached = cache.get_by_id(&event_id).expect("cache read");
            prop_assert_eq!(cached, Some(event));
        }
    }

    #[test]
    fn property31_external_edits_cover_add_update_and_delete_paths() {
        let cache = Arc::new(InMemoryCalendarCacheRepository::default());
        cache
            .upsert(&sample_event(
                "evt-update",
                "old-value",
                "2026-02-16T09:00:00Z",
                "2026-02-16T09:30:00Z",
            ))
            .expect("seed updated event");
        cache
            .upsert(&sample_event(
                "evt-delete",
                "remove-me",
                "2026-02-16T11:00:00Z",
                "2026-02-16T11:30:00Z",
            ))
            .expect("seed deleted event");

        let service = ExternalEditService::new(Arc::clone(&cache));
        let updated = sample_event(
            "evt-update",
            "new-value",
            "2026-02-16T10:00:00Z",
            "2026-02-16T10:30:00Z",
        );
        let added = sample_event(
            "evt-add",
            "new-addition",
            "2026-02-16T12:00:00Z",
            "2026-02-16T12:30:00Z",
        );
        let deleted = sample_cancelled_managed_event("evt-delete", "external:evt-delete:2026-02-16");

        let result = service
            .apply_events(vec![updated.clone(), added.clone(), deleted])
            .expect("apply edits");

        assert_eq!(result.added, vec![added.clone()]);
        assert_eq!(result.updated, vec![updated.clone()]);
        assert_eq!(result.deleted, vec!["evt-delete".to_string()]);
        assert_eq!(
            result.suppressed_instances,
            vec!["external:evt-delete:2026-02-16".to_string()]
        );

        assert_eq!(cache.get_by_id("evt-update").expect("cache read update"), Some(updated));
        assert_eq!(cache.get_by_id("evt-add").expect("cache read add"), Some(added));
        assert!(cache.get_by_id("evt-delete").expect("cache read delete").is_none());
    }
}
