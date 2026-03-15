use super::auth_support::DEFAULT_ACCOUNT_ID;
use super::block_support::{
    intervals_overlap, save_suppression, Block, DateTime, Interval, NaiveDate, Utc,
    BLOCK_GENERATION_TARGET_MS,
};
use super::runtime_support::{lock_runtime, StoredBlock};
use crate::application::test_support::workspace::TempWorkspace;
use crate::application::commands::{
    adjust_block_time_impl, approve_blocks_impl, delete_block_impl, generate_blocks_impl,
    generate_one_block_impl, list_blocks_impl, relocate_if_needed_impl,
};
use crate::domain::models::{AutoDriveMode, BlockContents, Firmness};
use crate::infrastructure::event_mapper::{CalendarEventDateTime, GoogleCalendarEvent};
use chrono::{Duration, NaiveTime, TimeZone};
use std::fs;
use std::time::Instant;

#[tokio::test]
async fn generate_and_approve_blocks_flow() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();

    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");
    assert!(!generated.is_empty());
    assert_eq!(generated[0].firmness, Firmness::Draft);

    let approved = approve_blocks_impl(&state, vec![generated[0].id.clone()])
        .await
        .expect("approve block");
    assert_eq!(approved.len(), 1);
    assert_eq!(approved[0].firmness, Firmness::Soft);
}

#[tokio::test]
async fn generate_blocks_rejects_invalid_date() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let result = generate_blocks_impl(&state, "not-a-date".to_string(), None).await;
    assert!(result.is_err());
}

#[tokio::test]
async fn generate_blocks_respects_suppressions() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    save_suppression(
        state.database_path(),
        "rtn:auto:2026-02-16:0",
        Some("test_suppression"),
    )
    .expect("save suppression");

    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");

    assert!(!generated.is_empty());
    assert!(generated
        .iter()
        .all(|block| block.instance != "rtn:auto:2026-02-16:0"));
}

#[tokio::test]
async fn generate_blocks_regenerates_after_all_blocks_deleted_for_date() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();

    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("initial generation");
    assert_eq!(generated.len(), 9);

    for block in generated {
        let deleted = delete_block_impl(&state, block.id.clone())
            .await
            .expect("delete generated block");
        assert!(deleted);
    }

    let regenerated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("regenerate after deletes");
    assert_eq!(regenerated.len(), 9);
    assert!(regenerated
        .iter()
        .any(|block| block.instance == "rtn:auto:2026-02-16:0"));
}

#[tokio::test]
async fn generate_blocks_refills_gap_after_single_block_deleted() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();

    let mut generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("initial generation");
    generated.sort_by(|left, right| left.start_at.cmp(&right.start_at));
    let removed = generated[4].clone();
    let deleted = delete_block_impl(&state, removed.id.clone())
        .await
        .expect("delete one generated block");
    assert!(deleted);

    let refill = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("refill one gap");
    assert_eq!(refill.len(), 1);
    assert_eq!(refill[0].start_at, removed.start_at);
    assert_eq!(refill[0].end_at, removed.end_at);

    let listed = list_blocks_impl(&state, Some("2026-02-16".to_string())).expect("list blocks");
    assert_eq!(listed.len(), 9);
}

#[tokio::test]
async fn generate_blocks_auto_fills_work_window_with_hour_blocks() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");

    assert_eq!(generated.len(), 9);
    let mut sorted = generated.clone();
    sorted.sort_by(|left, right| left.start_at.cmp(&right.start_at));

    let day = NaiveDate::parse_from_str("2026-02-16", "%Y-%m-%d").expect("valid date");
    let day_start = Utc.from_utc_datetime(&day.and_hms_opt(0, 0, 0).expect("midnight"));
    for (index, block) in sorted.iter().enumerate() {
        let expected_start = day_start + Duration::hours(9 + index as i64);
        let expected_end = expected_start + Duration::hours(1);
        assert_eq!(block.start_at, expected_start);
        assert_eq!(block.end_at, expected_end);
        assert_eq!(block.planned_pomodoros, 2);
        assert!(block.instance.starts_with("rtn:auto:"));
        assert_eq!(block.source, "routine");
        assert_eq!(block.source_id.as_deref(), Some("auto"));
        if index > 0 {
            assert_eq!(sorted[index - 1].end_at, block.start_at);
        }
    }
}

#[tokio::test]
async fn generate_one_block_adds_single_block_per_call() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();

    let first = generate_one_block_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate first block");
    assert_eq!(first.len(), 1);

    let second = generate_one_block_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate second block");
    assert_eq!(second.len(), 1);

    let listed = list_blocks_impl(&state, Some("2026-02-16".to_string())).expect("list blocks");
    assert_eq!(listed.len(), 2);
}

#[tokio::test]
async fn generate_one_block_allows_overlap_when_day_is_full() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();

    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate full day");
    assert_eq!(generated.len(), 9);

    let one_more = generate_one_block_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate one overlapping block");
    assert_eq!(one_more.len(), 1);
    let one_interval = Interval {
        start: one_more[0].start_at,
        end: one_more[0].end_at,
    };
    assert!(generated.iter().any(|block| {
        intervals_overlap(
            &Interval {
                start: block.start_at,
                end: block.end_at,
            },
            &one_interval,
        )
    }));

    let listed = list_blocks_impl(&state, Some("2026-02-16".to_string())).expect("list blocks");
    assert_eq!(listed.len(), 10);
}

#[tokio::test]
async fn generate_blocks_respects_max_auto_blocks_per_day() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let policies_path = state.config_dir().join("policies.json");
    fs::write(
        &policies_path,
        r#"{
  "schema": 1,
  "workHours": {
    "start": "00:00",
    "end": "23:59",
    "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
  },
  "generation": {
    "autoEnabled": true,
    "autoTime": "05:30",
    "catchUpOnAppStart": true,
    "placementStrategy": "keep",
    "maxShiftMinutes": 120,
    "maxAutoBlocksPerDay": 24,
    "maxRelocationsPerSync": 50,
    "createIfNoSlot": false,
    "respectSuppression": true
  },
  "blockDurationMinutes": 1,
  "breakDurationMinutes": 5,
  "minBlockGapMinutes": 0
}
"#,
    )
    .expect("write policies config");

    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");

    assert_eq!(generated.len(), 24);
    assert!(generated
        .iter()
        .all(|block| block.instance.starts_with("rtn:auto:")));
}

#[tokio::test]
async fn generate_blocks_uses_configured_timezone() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let app_config_path = state.config_dir().join("app.json");
    let app_raw = fs::read_to_string(&app_config_path).expect("read app config");
    let mut app_config: serde_json::Value =
        serde_json::from_str(&app_raw).expect("parse app config");
    app_config["timezone"] = serde_json::Value::String("Asia/Tokyo".to_string());
    fs::write(
        &app_config_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&app_config).expect("serialize app config")
        ),
    )
    .expect("write app config");

    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");

    assert!(!generated.is_empty());
    assert_eq!(generated[0].start_at.to_rfc3339(), "2026-02-16T00:00:00+00:00");
    assert_eq!(generated[0].end_at.to_rfc3339(), "2026-02-16T01:00:00+00:00");
}

#[tokio::test]
async fn generate_blocks_uses_templates_and_routines_when_configured() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let templates_path = state.config_dir().join("templates.json");
    let routines_path = state.config_dir().join("routines.json");
    fs::write(
        &templates_path,
        r#"{
  "templates": [
    {
      "id": "focus-morning",
      "name": "Focus Morning",
      "start": "09:00",
      "durationMinutes": 50,
      "firmness": "soft",
      "plannedPomodoros": 2
    }
  ]
}
"#,
    )
    .expect("write templates config");
    fs::write(
        &routines_path,
        r#"{
  "routines": [
    {
      "id": "daily-admin",
      "name": "Daily Admin",
      "rrule": "FREQ=DAILY",
      "default": {
        "start": "10:00",
        "durationMinutes": 25,
        "pomodoros": 1
      },
      "firmness": "draft"
    }
  ]
}
"#,
    )
    .expect("write routines config");

    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");

    assert!(generated.len() > 2);
    assert!(generated
        .iter()
        .any(|block| block.instance == "tpl:focus-morning:2026-02-16"));
    assert!(generated
        .iter()
        .any(|block| block.instance == "rtn:daily-admin:2026-02-16"));
    assert!(generated
        .iter()
        .any(|block| block.instance.starts_with("rtn:auto:")));
}

#[tokio::test]
async fn relocate_if_needed_moves_block_when_conflicting_event_exists() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let block = Block {
        id: "blk-relocate".to_string(),
        instance: "rtn:auto:2026-02-16:0".to_string(),
        date: "2026-02-16".to_string(),
        start_at: DateTime::parse_from_rfc3339("2026-02-16T09:00:00Z")
            .expect("start")
            .with_timezone(&Utc),
        end_at: DateTime::parse_from_rfc3339("2026-02-16T09:50:00Z")
            .expect("end")
            .with_timezone(&Utc),
        firmness: Firmness::Draft,
        planned_pomodoros: 2,
        source: "routine".to_string(),
        source_id: Some("auto".to_string()),
        recipe_id: "rcp-default".to_string(),
        auto_drive_mode: AutoDriveMode::Manual,
        contents: BlockContents::default(),
    };
    {
        let mut runtime = lock_runtime(&state).expect("runtime lock");
        runtime.blocks.insert(
            block.id.clone(),
            StoredBlock {
                block: block.clone(),
                calendar_event_id: None,
                calendar_account_id: Some(DEFAULT_ACCOUNT_ID.to_string()),
            },
        );
        runtime.synced_events_by_account.insert(
            DEFAULT_ACCOUNT_ID.to_string(),
            vec![GoogleCalendarEvent {
                id: Some("evt-conflict".to_string()),
                summary: Some("conflict".to_string()),
                description: None,
                status: Some("confirmed".to_string()),
                updated: None,
                etag: None,
                start: CalendarEventDateTime {
                    date_time: "2026-02-16T09:10:00Z".to_string(),
                    time_zone: None,
                },
                end: CalendarEventDateTime {
                    date_time: "2026-02-16T09:40:00Z".to_string(),
                    time_zone: None,
                },
                extended_properties: None,
            }],
        );
    }

    let relocated = relocate_if_needed_impl(&state, block.id.clone(), None)
        .await
        .expect("relocate")
        .expect("block relocated");

    assert_eq!(relocated.id, block.id);
    let conflict_end = DateTime::parse_from_rfc3339("2026-02-16T09:40:00Z")
        .expect("conflict end")
        .with_timezone(&Utc);
    assert!(relocated.start_at >= conflict_end);
    assert_eq!(relocated.end_at - relocated.start_at, block.end_at - block.start_at);
}

#[tokio::test]
async fn delete_and_adjust_block_flow() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");
    let block = generated[0].clone();

    let shifted = adjust_block_time_impl(
        &state,
        block.id.clone(),
        "2026-02-16T10:00:00Z".to_string(),
        "2026-02-16T10:50:00Z".to_string(),
    )
    .await
    .expect("adjust block");
    assert_eq!(shifted.start_at.to_rfc3339(), "2026-02-16T10:00:00+00:00");

    let deleted = delete_block_impl(&state, block.id.clone())
        .await
        .expect("delete block");
    assert!(deleted);
    let blocks = list_blocks_impl(&state, Some("2026-02-16".to_string())).expect("list blocks");
    assert!(blocks.into_iter().all(|candidate| candidate.id != block.id));
}

#[tokio::test]
async fn generate_to_confirm_stays_within_target_for_dense_calendar() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let date = "2026-02-16";
    let day = NaiveDate::parse_from_str(date, "%Y-%m-%d").expect("valid date");
    let day_start = Utc.from_utc_datetime(&day.and_hms_opt(0, 0, 0).expect("midnight"));

    let synced_events = (0..2_000)
        .map(|index| {
            let start = day_start + Duration::minutes(index as i64);
            let end = start + Duration::seconds(30);
            GoogleCalendarEvent {
                id: Some(format!("evt-{index}")),
                summary: Some("busy".to_string()),
                description: None,
                status: Some("confirmed".to_string()),
                updated: None,
                etag: None,
                start: CalendarEventDateTime {
                    date_time: start.to_rfc3339(),
                    time_zone: None,
                },
                end: CalendarEventDateTime {
                    date_time: end.to_rfc3339(),
                    time_zone: None,
                },
                extended_properties: None,
            }
        })
        .collect::<Vec<_>>();

    {
        let mut runtime = lock_runtime(&state).expect("runtime lock");
        runtime
            .synced_events_by_account
            .insert(DEFAULT_ACCOUNT_ID.to_string(), synced_events);
    }

    let started = Instant::now();
    let _generated = generate_blocks_impl(&state, date.to_string(), None)
        .await
        .expect("generate blocks");
    let _listed = list_blocks_impl(&state, Some(date.to_string())).expect("list blocks");
    let elapsed_ms = started.elapsed().as_millis();
    assert!(
        elapsed_ms < BLOCK_GENERATION_TARGET_MS,
        "generate-to-confirm exceeded target: {elapsed_ms}ms"
    );
}

#[tokio::test]
async fn property_8_generated_blocks_do_not_overlap_existing_events() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    {
        let mut runtime = lock_runtime(&state).expect("runtime lock");
        runtime.synced_events_by_account.insert(
            DEFAULT_ACCOUNT_ID.to_string(),
            vec![GoogleCalendarEvent {
                id: Some("evt-busy".to_string()),
                summary: Some("Busy".to_string()),
                description: None,
                status: Some("confirmed".to_string()),
                updated: None,
                etag: None,
                start: CalendarEventDateTime {
                    date_time: "2026-02-16T10:00:00Z".to_string(),
                    time_zone: None,
                },
                end: CalendarEventDateTime {
                    date_time: "2026-02-16T11:00:00Z".to_string(),
                    time_zone: None,
                },
                extended_properties: None,
            }],
        );
    }

    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");
    let busy = Interval {
        start: DateTime::parse_from_rfc3339("2026-02-16T10:00:00Z")
            .expect("busy start")
            .with_timezone(&Utc),
        end: DateTime::parse_from_rfc3339("2026-02-16T11:00:00Z")
            .expect("busy end")
            .with_timezone(&Utc),
    };

    assert!(!generated.is_empty(), "expected blocks outside busy window");
    assert!(generated.iter().all(|block| {
        !intervals_overlap(
            &Interval {
                start: block.start_at,
                end: block.end_at,
            },
            &busy,
        )
    }));
}

#[tokio::test]
async fn property_9_generated_blocks_stay_within_work_hours() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();

    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");

    assert!(!generated.is_empty(), "expected default workday blocks");
    assert!(generated.iter().all(|block| {
        let start = block.start_at.time();
        let end = block.end_at.time();
        start >= NaiveTime::from_hms_opt(9, 0, 0).expect("9am")
            && end <= NaiveTime::from_hms_opt(18, 0, 0).expect("6pm")
    }));
}

#[tokio::test]
async fn property_11_generation_is_prevented_for_overlapping_time_bands() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    {
        let mut runtime = lock_runtime(&state).expect("runtime lock");
        runtime.synced_events_by_account.insert(
            DEFAULT_ACCOUNT_ID.to_string(),
            vec![GoogleCalendarEvent {
                id: Some("evt-full-day".to_string()),
                summary: Some("Occupied".to_string()),
                description: None,
                status: Some("confirmed".to_string()),
                updated: None,
                etag: None,
                start: CalendarEventDateTime {
                    date_time: "2026-02-16T09:00:00Z".to_string(),
                    time_zone: None,
                },
                end: CalendarEventDateTime {
                    date_time: "2026-02-16T18:00:00Z".to_string(),
                    time_zone: None,
                },
                extended_properties: None,
            }],
        );
    }

    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");

    assert!(generated.is_empty(), "full-day overlap should block generation");
}
