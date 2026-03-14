use super::runtime_support::{lock_runtime, TaskStatus};
use crate::application::test_support::workspace::TempWorkspace;
use crate::application::commands::{
    carry_over_task_impl, create_task_impl, delete_task_impl, generate_blocks_impl, list_tasks_impl,
    split_task_impl, update_task_impl,
};

#[test]
fn create_task_rejects_empty_title() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let result = create_task_impl(&state, "   ".to_string(), None, None);
    assert!(result.is_err());
}

#[test]
fn create_and_list_tasks_roundtrip() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();

    let created = create_task_impl(
        &state,
        "Write integration tests".to_string(),
        Some("Task 18.5".to_string()),
        Some(2),
    )
    .expect("create task");
    let listed = list_tasks_impl(&state).expect("list tasks");

    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, created.id);
    assert_eq!(listed[0].status, TaskStatus::Pending);
}

#[test]
fn update_and_delete_task_flow() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let created = create_task_impl(&state, "Original".to_string(), None, Some(1))
        .expect("create task");

    let updated = update_task_impl(
        &state,
        created.id.clone(),
        Some("Updated".to_string()),
        Some("Details".to_string()),
        Some(3),
        Some("in_progress".to_string()),
    )
    .expect("update task");
    assert_eq!(updated.title, "Updated");
    assert_eq!(updated.status, TaskStatus::InProgress);
    assert_eq!(updated.estimated_pomodoros, Some(3));

    let deleted = delete_task_impl(&state, created.id.clone()).expect("delete task");
    assert!(deleted);
    let tasks = list_tasks_impl(&state).expect("list tasks");
    assert!(tasks.is_empty());
}

#[test]
fn split_task_creates_children_and_defers_parent() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let parent = create_task_impl(&state, "Large task".to_string(), Some("split".to_string()), Some(8))
        .expect("create task");

    let children = split_task_impl(&state, parent.id.clone(), 4).expect("split task");
    assert_eq!(children.len(), 4);
    assert!(children
        .iter()
        .all(|child| child.title.starts_with("Large task (")));
    assert!(children
        .iter()
        .all(|child| child.estimated_pomodoros == Some(2)));

    let listed = list_tasks_impl(&state).expect("list tasks");
    let refreshed_parent = listed
        .iter()
        .find(|task| task.id == parent.id)
        .expect("parent task exists");
    assert_eq!(refreshed_parent.status, TaskStatus::Deferred);
}

#[tokio::test]
async fn property_21_tasks_are_not_preassigned_before_block_starts() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");
    let task = create_task_impl(&state, "Unassigned".to_string(), None, Some(1))
        .expect("create task");

    let runtime = lock_runtime(&state).expect("runtime lock");
    assert!(runtime.task_assignments_by_task.get(task.id.as_str()).is_none());
    assert!(runtime
        .task_assignments_by_block
        .get(generated[0].id.as_str())
        .is_none());
}

#[tokio::test]
async fn carry_over_task_moves_to_selected_available_block() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");
    assert!(generated.len() >= 2, "at least two blocks expected");
    let mut sorted = generated.clone();
    sorted.sort_by(|left, right| left.start_at.cmp(&right.start_at));
    let from_block = sorted[0].clone();
    let next_block = sorted[1].clone();
    let task = create_task_impl(&state, "Carry task".to_string(), None, Some(3))
        .expect("create task");

    let result = carry_over_task_impl(
        &state,
        task.id.clone(),
        from_block.id.clone(),
        Some(vec![next_block.id.clone()]),
    )
    .expect("carry over task");

    assert_eq!(result.task_id, task.id);
    assert_eq!(result.from_block_id, from_block.id);
    assert_eq!(result.to_block_id, next_block.id);
    assert_eq!(result.status, "in_progress");
}
