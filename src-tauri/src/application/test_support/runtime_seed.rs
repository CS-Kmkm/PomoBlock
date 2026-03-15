use crate::application::commands::{lock_runtime, AppState};
use crate::infrastructure::error::InfraError;
use crate::infrastructure::event_mapper::GoogleCalendarEvent;

pub(crate) fn seed_synced_events(
    state: &AppState,
    account_id: &str,
    events: Vec<GoogleCalendarEvent>,
) -> Result<(), InfraError> {
    let mut runtime = lock_runtime(state)?;
    runtime
        .synced_events_by_account
        .insert(account_id.trim().to_string(), events);
    Ok(())
}
