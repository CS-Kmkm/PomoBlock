use crate::application::commands::{
    delete_routine_schedule_impl, list_routine_schedules_impl, list_routines_impl,
    save_routine_schedule_group_impl, save_routine_schedule_impl,
};
use crate::application::test_support::workspace::TempWorkspace;
use serde_json::json;

#[test]
fn routine_schedule_crud_persists_to_routines_json() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();

    let before = list_routine_schedules_impl(&state).expect("list routines");
    assert!(before.is_empty());

    let created = save_routine_schedule_impl(
        &state,
        json!({
            "id": "rtn-weekly-focus",
            "recipeId": "rcp-default",
            "startDate": "2026-02-01",
            "endDate": "2026-02-28",
            "schedule": {
                "type": "weekly",
                "weekday": "Monday"
            },
            "default": {
                "start": "09:00",
                "durationMinutes": 60
            }
        }),
    )
    .expect("create routine");
    assert_eq!(created.get("id").and_then(serde_json::Value::as_str), Some("rtn-weekly-focus"));

    let listed = list_routine_schedules_impl(&state).expect("list routines after create");
    assert_eq!(listed.len(), 1);
    assert_eq!(
        listed[0].get("schedule").and_then(|schedule| schedule.get("weekday")).and_then(serde_json::Value::as_str),
        Some("Monday")
    );

    let updated = save_routine_schedule_impl(
        &state,
        json!({
            "id": "rtn-weekly-focus",
            "recipeId": "rcp-default",
            "schedule": {
                "type": "monthly",
                "dayOfMonth": 10
            },
            "default": {
                "start": "10:30",
                "durationMinutes": 45
            }
        }),
    )
    .expect("update routine");
    assert_eq!(
        updated.get("schedule").and_then(|schedule| schedule.get("dayOfMonth")).and_then(serde_json::Value::as_i64),
        Some(10)
    );

    let deleted = delete_routine_schedule_impl(&state, "rtn-weekly-focus".to_string()).expect("delete routine");
    assert!(deleted);

    let after = list_routine_schedules_impl(&state).expect("list routines after delete");
    assert!(after.is_empty());
}

#[test]
fn routine_schedule_group_persists_multiple_entries() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();

    let saved = save_routine_schedule_group_impl(
        &state,
        json!({
            "group_id": "group-a",
            "routines": [
                {
                    "id": "rtn-a",
                    "recipeId": "rcp-default",
                    "default": { "start": "09:00", "durationMinutes": 30 },
                    "schedule": { "type": "weekly", "days": ["mon", "wed"] }
                },
                {
                    "id": "rtn-b",
                    "recipeId": "rcp-default",
                    "default": { "start": "13:00", "durationMinutes": 45 },
                    "schedule": { "type": "monthly_nth", "weekday": "fri", "nthWeek": 2 }
                }
            ]
        }),
    )
    .expect("save group");
    assert_eq!(saved.len(), 2);

    let listed = list_routines_impl(&state).expect("list routines");
    assert_eq!(listed.len(), 2);
    assert_eq!(
        listed[0].get("scheduleGroupId").and_then(serde_json::Value::as_str),
        Some("group-a")
    );
}
