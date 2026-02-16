use crate::infrastructure::error::InfraError;
use crate::infrastructure::event_mapper::GoogleCalendarEvent;
use std::collections::HashMap;
use std::sync::Mutex;

pub trait CalendarCacheRepository: Send + Sync {
    fn get_by_id(&self, event_id: &str) -> Result<Option<GoogleCalendarEvent>, InfraError>;
    fn upsert(&self, event: &GoogleCalendarEvent) -> Result<(), InfraError>;
    fn remove(&self, event_id: &str) -> Result<(), InfraError>;
    fn list_all(&self) -> Result<Vec<GoogleCalendarEvent>, InfraError>;
}

#[derive(Debug, Default)]
pub struct InMemoryCalendarCacheRepository {
    events: Mutex<HashMap<String, GoogleCalendarEvent>>,
}

impl InMemoryCalendarCacheRepository {
    fn normalized_id(event_id: &str) -> Option<String> {
        let normalized = event_id.trim();
        if normalized.is_empty() {
            return None;
        }
        Some(normalized.to_string())
    }
}

impl CalendarCacheRepository for InMemoryCalendarCacheRepository {
    fn get_by_id(&self, event_id: &str) -> Result<Option<GoogleCalendarEvent>, InfraError> {
        let Some(event_id) = Self::normalized_id(event_id) else {
            return Ok(None);
        };
        let events = self
            .events
            .lock()
            .map_err(|error| InfraError::InvalidConfig(format!("calendar cache lock poisoned: {error}")))?;
        Ok(events.get(&event_id).cloned())
    }

    fn upsert(&self, event: &GoogleCalendarEvent) -> Result<(), InfraError> {
        let event_id = event
            .id
            .as_deref()
            .and_then(Self::normalized_id)
            .ok_or_else(|| InfraError::InvalidConfig("event id is required for cache upsert".to_string()))?;

        let mut events = self
            .events
            .lock()
            .map_err(|error| InfraError::InvalidConfig(format!("calendar cache lock poisoned: {error}")))?;
        events.insert(event_id, event.clone());
        Ok(())
    }

    fn remove(&self, event_id: &str) -> Result<(), InfraError> {
        let Some(event_id) = Self::normalized_id(event_id) else {
            return Ok(());
        };
        let mut events = self
            .events
            .lock()
            .map_err(|error| InfraError::InvalidConfig(format!("calendar cache lock poisoned: {error}")))?;
        events.remove(&event_id);
        Ok(())
    }

    fn list_all(&self) -> Result<Vec<GoogleCalendarEvent>, InfraError> {
        let events = self
            .events
            .lock()
            .map_err(|error| InfraError::InvalidConfig(format!("calendar cache lock poisoned: {error}")))?;
        Ok(events.values().cloned().collect())
    }
}
