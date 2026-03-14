use super::auth_support::{load_oauth_config_from_lookup, InfraError, DEFAULT_ACCOUNT_ID};
use super::runtime_support::lock_runtime;
use super::workspace_support::TempWorkspace;
use crate::infrastructure::event_mapper::{CalendarEventDateTime, GoogleCalendarEvent};

#[test]
fn oauth_config_validation_reports_missing_client_id() {
    let result = load_oauth_config_from_lookup(|key| match key {
        "POMBLOCK_GOOGLE_CLIENT_SECRET" => Some("secret".to_string()),
        _ => None,
    });
    match result {
        Err(InfraError::InvalidConfig(message)) => {
            assert!(message.contains("google client id"));
        }
        _ => panic!("expected invalid config error"),
    }
}

#[test]
fn list_synced_events_filters_by_window_and_ignores_cancelled_events() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    {
        let mut runtime = lock_runtime(&state).expect("runtime lock");
        runtime.synced_events_by_account.insert(
            DEFAULT_ACCOUNT_ID.to_string(),
            vec![
                GoogleCalendarEvent {
                    id: Some("evt-confirmed".to_string()),
                    summary: Some("Deep Work".to_string()),
                    description: None,
                    status: Some("confirmed".to_string()),
                    updated: None,
                    etag: None,
                    start: CalendarEventDateTime {
                        date_time: "2026-02-16T09:00:00Z".to_string(),
                        time_zone: None,
                    },
                    end: CalendarEventDateTime {
                        date_time: "2026-02-16T10:00:00Z".to_string(),
                        time_zone: None,
                    },
                    extended_properties: None,
                },
                GoogleCalendarEvent {
                    id: Some("evt-cancelled".to_string()),
                    summary: Some("Cancelled".to_string()),
                    description: None,
                    status: Some("cancelled".to_string()),
                    updated: None,
                    etag: None,
                    start: CalendarEventDateTime {
                        date_time: "2026-02-16T12:00:00Z".to_string(),
                        time_zone: None,
                    },
                    end: CalendarEventDateTime {
                        date_time: "2026-02-16T13:00:00Z".to_string(),
                        time_zone: None,
                    },
                    extended_properties: None,
                },
            ],
        );
    }

    let listed = crate::application::commands::calendar::list_synced_events_impl(
        &state,
        None,
        Some("2026-02-16T00:00:00Z".to_string()),
        Some("2026-02-17T00:00:00Z".to_string()),
    )
    .expect("list synced events");

    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].account_id, DEFAULT_ACCOUNT_ID);
    assert_eq!(listed[0].id, "evt-confirmed");
    assert_eq!(listed[0].title, "Deep Work");
    assert_eq!(listed[0].start_at, "2026-02-16T09:00:00+00:00");
    assert_eq!(listed[0].end_at, "2026-02-16T10:00:00+00:00");
}
