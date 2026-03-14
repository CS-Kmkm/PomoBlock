use super::auth_support::DEFAULT_ACCOUNT_ID;
use super::block_support::{collect_relocation_target_block_ids, Block, DateTime, Interval, Utc};
use super::pomodoro_support::configured_recipes;
use super::runtime_support::{lock_runtime, RuntimeState, StoredBlock};
use super::workspace_support::TempWorkspace;
use crate::application::commands::{
    create_module_impl, create_recipe_impl, delete_module_impl, list_blocks_impl,
    list_modules_impl, list_recipes_impl, update_module_impl, update_recipe_impl,
};
use crate::application::studio_template_application;
use crate::domain::models::{AutoDriveMode, BlockContents, Firmness};
use serde_json::json;

#[test]
fn modules_crud_persists_to_modules_json() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();

    let before = list_modules_impl(&state).expect("list modules");
    assert!(!before.is_empty());

    let created = create_module_impl(
        &state,
        json!({
            "id": "mod-test-module",
            "name": "Test Module",
            "category": "Testing",
            "description": "integration test module",
            "icon": "beaker",
            "stepType": "micro",
            "durationMinutes": 7,
            "checklist": ["one", "two"],
            "overrunPolicy": "wait",
            "executionHints": {
                "allowSkip": true,
                "mustCompleteChecklist": false,
                "autoAdvance": true
            }
        }),
    )
    .expect("create module");
    assert_eq!(created.id, "mod-test-module");

    let updated = update_module_impl(
        &state,
        "mod-test-module".to_string(),
        json!({
            "name": "Test Module Updated",
            "category": "Testing",
            "stepType": "micro",
            "durationMinutes": 9,
            "checklist": ["three"],
            "overrunPolicy": "wait"
        }),
    )
    .expect("update module");
    assert_eq!(updated.name, "Test Module Updated");
    assert_eq!(updated.duration_minutes, 9);

    let listed = list_modules_impl(&state).expect("list modules");
    assert!(listed.iter().any(|module| module.id == "mod-test-module"));

    let deleted = delete_module_impl(&state, "mod-test-module".to_string()).expect("delete module");
    assert!(deleted);
    let after_delete = list_modules_impl(&state).expect("list modules");
    assert!(after_delete
        .iter()
        .all(|module| module.id != "mod-test-module"));
}

#[tokio::test]
async fn apply_studio_template_to_today_creates_block_without_shift() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();

    create_recipe_impl(
        &state,
        json!({
            "id": "rcp-studio-a",
            "name": "Studio A",
            "autoDriveMode": "manual",
            "studioMeta": {
                "version": 1,
                "kind": "routine_studio"
            },
            "steps": [
                {
                    "id": "step-1",
                    "type": "micro",
                    "title": "A",
                    "durationSeconds": 900
                }
            ]
        }),
    )
    .expect("create studio recipe");

    let result = studio_template_application::apply_studio_template_to_today(
        &state,
        "rcp-studio-a".to_string(),
        "2026-02-16".to_string(),
        "09:00".to_string(),
        Some("shift".to_string()),
        None,
    )
    .await
    .expect("apply studio template");

    assert!(!result.shifted);
    assert_eq!(result.conflict_count, 0);
    let blocks = list_blocks_impl(&state, Some("2026-02-16".to_string())).expect("list blocks");
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].source, "routine_studio");
    assert_eq!(blocks[0].recipe_id, "rcp-studio-a");
}

#[tokio::test]
async fn apply_studio_template_to_today_shifts_when_conflict_exists() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();

    create_recipe_impl(
        &state,
        json!({
            "id": "rcp-studio-b",
            "name": "Studio B",
            "autoDriveMode": "manual",
            "studioMeta": {
                "version": 1,
                "kind": "routine_studio"
            },
            "steps": [
                {
                    "id": "step-1",
                    "type": "micro",
                    "title": "B",
                    "durationSeconds": 1800
                }
            ]
        }),
    )
    .expect("create studio recipe");

    let busy_block = Block {
        id: "blk-busy".to_string(),
        instance: "manual:busy".to_string(),
        date: "2026-02-16".to_string(),
        start_at: DateTime::parse_from_rfc3339("2026-02-16T09:00:00Z")
            .expect("start")
            .with_timezone(&Utc),
        end_at: DateTime::parse_from_rfc3339("2026-02-16T09:30:00Z")
            .expect("end")
            .with_timezone(&Utc),
        firmness: Firmness::Hard,
        planned_pomodoros: 1,
        source: "manual".to_string(),
        source_id: Some("busy".to_string()),
        recipe_id: "rcp-default".to_string(),
        auto_drive_mode: AutoDriveMode::Manual,
        contents: BlockContents::default(),
    };
    {
        let mut runtime = lock_runtime(&state).expect("runtime lock");
        runtime.blocks.insert(
            busy_block.id.clone(),
            StoredBlock {
                block: busy_block.clone(),
                calendar_event_id: None,
                calendar_account_id: Some(DEFAULT_ACCOUNT_ID.to_string()),
            },
        );
    }

    let result = studio_template_application::apply_studio_template_to_today(
        &state,
        "rcp-studio-b".to_string(),
        "2026-02-16".to_string(),
        "09:00".to_string(),
        Some("shift".to_string()),
        None,
    )
    .await
    .expect("apply studio template with shift");
    assert!(result.shifted);
    assert!(result.conflict_count >= 1);
    let applied_start = DateTime::parse_from_rfc3339(&result.applied_start_at)
        .expect("parse applied start")
        .with_timezone(&Utc);
    assert!(applied_start >= busy_block.end_at);
}

#[tokio::test]
async fn apply_studio_template_to_today_fails_when_no_free_slot() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();

    create_recipe_impl(
        &state,
        json!({
            "id": "rcp-studio-c",
            "name": "Studio C",
            "autoDriveMode": "manual",
            "studioMeta": {
                "version": 1,
                "kind": "routine_studio"
            },
            "steps": [
                {
                    "id": "step-1",
                    "type": "micro",
                    "title": "C",
                    "durationSeconds": 3600
                }
            ]
        }),
    )
    .expect("create studio recipe");

    let full_day_block = Block {
        id: "blk-full".to_string(),
        instance: "manual:full".to_string(),
        date: "2026-02-16".to_string(),
        start_at: DateTime::parse_from_rfc3339("2026-02-16T00:00:00Z")
            .expect("start")
            .with_timezone(&Utc),
        end_at: DateTime::parse_from_rfc3339("2026-02-17T00:00:00Z")
            .expect("end")
            .with_timezone(&Utc),
        firmness: Firmness::Hard,
        planned_pomodoros: 1,
        source: "manual".to_string(),
        source_id: Some("full".to_string()),
        recipe_id: "rcp-default".to_string(),
        auto_drive_mode: AutoDriveMode::Manual,
        contents: BlockContents::default(),
    };
    {
        let mut runtime = lock_runtime(&state).expect("runtime lock");
        runtime.blocks.insert(
            full_day_block.id.clone(),
            StoredBlock {
                block: full_day_block,
                calendar_event_id: None,
                calendar_account_id: Some(DEFAULT_ACCOUNT_ID.to_string()),
            },
        );
    }

    let error = studio_template_application::apply_studio_template_to_today(
        &state,
        "rcp-studio-c".to_string(),
        "2026-02-16".to_string(),
        "09:00".to_string(),
        Some("shift".to_string()),
        None,
    )
    .await
    .expect_err("apply should fail");
    assert!(error.to_string().contains("no available free slot"));
}

#[tokio::test]
async fn apply_studio_template_to_today_rejects_non_studio_recipe() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();

    create_recipe_impl(
        &state,
        json!({
            "id": "rcp-legacy",
            "name": "Legacy",
            "autoDriveMode": "manual",
            "steps": [
                {
                    "id": "step-1",
                    "type": "micro",
                    "title": "legacy",
                    "durationSeconds": 600
                }
            ]
        }),
    )
    .expect("create legacy recipe");

    let error = studio_template_application::apply_studio_template_to_today(
        &state,
        "rcp-legacy".to_string(),
        "2026-02-16".to_string(),
        "09:00".to_string(),
        Some("shift".to_string()),
        None,
    )
    .await
    .expect_err("legacy apply should fail");
    assert!(error.to_string().contains("routine studio"));
}

#[test]
fn recipe_studio_fields_are_preserved_across_create_update_list() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();

    create_recipe_impl(
        &state,
        json!({
            "id": "rcp-studio-meta",
            "name": "Studio Meta",
            "autoDriveMode": "auto",
            "studioMeta": {
                "version": 1,
                "kind": "routine_studio"
            },
            "steps": [
                {
                    "id": "step-1",
                    "type": "pomodoro",
                    "title": "Focus",
                    "durationSeconds": 1500,
                    "moduleId": "mod-pomodoro-focus",
                    "checklist": ["Do one thing"],
                    "note": "initial",
                    "overrunPolicy": "wait",
                    "executionHints": {
                        "allowSkip": false,
                        "mustCompleteChecklist": true,
                        "autoAdvance": true
                    },
                    "pomodoro": {
                        "focusSeconds": 1500,
                        "breakSeconds": 300,
                        "cycles": 1,
                        "longBreakSeconds": 900,
                        "longBreakEvery": 4
                    }
                }
            ]
        }),
    )
    .expect("create studio recipe");

    update_recipe_impl(
        &state,
        "rcp-studio-meta".to_string(),
        json!({
            "name": "Studio Meta Updated",
            "autoDriveMode": "manual",
            "studioMeta": {
                "version": 1,
                "kind": "routine_studio"
            },
            "steps": [
                {
                    "id": "step-1",
                    "type": "micro",
                    "title": "Focus Updated",
                    "durationSeconds": 1200,
                    "moduleId": "mod-deep-work-init",
                    "checklist": ["Updated one", "Updated two"],
                    "note": "updated",
                    "overrunPolicy": "wait",
                    "executionHints": {
                        "allowSkip": true,
                        "mustCompleteChecklist": false,
                        "autoAdvance": true
                    }
                }
            ]
        }),
    )
    .expect("update studio recipe");

    let listed = list_recipes_impl(&state).expect("list recipes");
    let target = listed
        .into_iter()
        .find(|recipe| recipe.id == "rcp-studio-meta")
        .expect("recipe exists");
    assert!(configured_recipes::recipe_is_routine_studio(&target));
    assert_eq!(target.name, "Studio Meta Updated");
    assert_eq!(target.steps.len(), 1);
    let step = &target.steps[0];
    assert_eq!(step.module_id.as_deref(), Some("mod-deep-work-init"));
    assert_eq!(step.checklist.len(), 2);
    assert_eq!(step.note.as_deref(), Some("updated"));
    assert!(step.execution_hints.as_ref().map(|h| h.allow_skip).unwrap_or(false));
}

#[test]
fn collect_relocation_target_block_ids_filters_by_changes_and_limit() {
    let make_block = |id: &str, start_at: &str, end_at: &str| Block {
        id: id.to_string(),
        instance: format!("rtn:auto:2026-02-16:{id}"),
        date: "2026-02-16".to_string(),
        start_at: DateTime::parse_from_rfc3339(start_at)
            .expect("start")
            .with_timezone(&Utc),
        end_at: DateTime::parse_from_rfc3339(end_at)
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

    let mut runtime = RuntimeState::default();
    let block_a = make_block("a", "2026-02-16T09:00:00Z", "2026-02-16T09:30:00Z");
    let block_b = make_block("b", "2026-02-16T10:00:00Z", "2026-02-16T10:30:00Z");
    let block_c = make_block("c", "2026-02-16T09:10:00Z", "2026-02-16T09:40:00Z");
    runtime.blocks.insert(
        block_a.id.clone(),
        StoredBlock {
            block: block_a.clone(),
            calendar_event_id: None,
            calendar_account_id: Some(DEFAULT_ACCOUNT_ID.to_string()),
        },
    );
    runtime.blocks.insert(
        block_b.id.clone(),
        StoredBlock {
            block: block_b,
            calendar_event_id: None,
            calendar_account_id: Some(DEFAULT_ACCOUNT_ID.to_string()),
        },
    );
    runtime.blocks.insert(
        block_c.id.clone(),
        StoredBlock {
            block: block_c.clone(),
            calendar_event_id: None,
            calendar_account_id: Some(DEFAULT_ACCOUNT_ID.to_string()),
        },
    );
    let block_other = make_block("other", "2026-02-16T09:05:00Z", "2026-02-16T09:20:00Z");
    runtime.blocks.insert(
        block_other.id.clone(),
        StoredBlock {
            block: block_other,
            calendar_event_id: None,
            calendar_account_id: Some("other-account".to_string()),
        },
    );

    let changed = vec![Interval {
        start: DateTime::parse_from_rfc3339("2026-02-16T09:15:00Z")
            .expect("interval start")
            .with_timezone(&Utc),
        end: DateTime::parse_from_rfc3339("2026-02-16T09:25:00Z")
            .expect("interval end")
            .with_timezone(&Utc),
    }];

    let limited = collect_relocation_target_block_ids(&runtime, DEFAULT_ACCOUNT_ID, &changed, 1);
    assert_eq!(limited.len(), 1);
    assert_eq!(limited[0], block_a.id);

    let full = collect_relocation_target_block_ids(&runtime, DEFAULT_ACCOUNT_ID, &changed, 10);
    assert_eq!(full, vec![block_a.id.clone(), block_c.id.clone()]);

    let none = collect_relocation_target_block_ids(&runtime, DEFAULT_ACCOUNT_ID, &[], 10);
    assert!(none.is_empty());
}
