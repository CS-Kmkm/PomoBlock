use super::pomodoro_support::{configured_recipes, load_runtime_policy, pomodoro_session_plan};
use super::workspace_support::TempWorkspace;
use crate::application::commands::{
    advance_pomodoro_impl, complete_pomodoro_impl, generate_blocks_impl, get_pomodoro_state_impl,
    get_reflection_summary_impl, pause_pomodoro_impl, resume_pomodoro_impl, start_pomodoro_impl,
};

#[test]
fn start_pomodoro_requires_existing_block() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let result = start_pomodoro_impl(&state, "missing-block".to_string(), None);
    assert!(result.is_err());
}

#[tokio::test]
async fn start_pause_and_get_pomodoro_state_flow() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");
    let block_id = generated[0].id.clone();
    let policy = load_runtime_policy(state.config_dir());
    let recipes = configured_recipes::load_configured_recipes(state.config_dir());
    let expected_plan = pomodoro_session_plan::build_pomodoro_session_plan(
        &generated[0],
        policy.break_duration_minutes,
        &recipes,
    );

    let started = start_pomodoro_impl(&state, block_id.clone(), None).expect("start pomodoro");
    assert_eq!(started.phase, "focus");
    assert_eq!(started.current_block_id, Some(block_id.clone()));
    assert_eq!(started.remaining_seconds, expected_plan.focus_seconds);
    assert_eq!(started.total_cycles, expected_plan.total_cycles);
    assert_eq!(started.completed_cycles, 0);
    assert_eq!(started.current_cycle, 1);

    let paused =
        pause_pomodoro_impl(&state, Some("interruption".to_string())).expect("pause pomodoro");
    assert_eq!(paused.phase, "paused");

    let snapshot = get_pomodoro_state_impl(&state).expect("get pomodoro state");
    assert_eq!(snapshot.phase, "paused");
    assert_eq!(snapshot.current_block_id, Some(block_id));
}

#[tokio::test]
async fn property_15_starting_pomodoro_activates_running_timer() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");

    let snapshot =
        start_pomodoro_impl(&state, generated[0].id.clone(), None).expect("start pomodoro");

    assert_eq!(snapshot.phase, "focus");
    assert!(snapshot.remaining_seconds > 0);
    assert_eq!(
        snapshot.current_block_id.as_deref(),
        Some(generated[0].id.as_str())
    );
}

#[tokio::test]
async fn advance_pomodoro_tracks_cycles_inside_block() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");
    let block = generated[0].clone();
    let policy = load_runtime_policy(state.config_dir());
    let recipes = configured_recipes::load_configured_recipes(state.config_dir());
    let expected_plan = pomodoro_session_plan::build_pomodoro_session_plan(
        &block,
        policy.break_duration_minutes,
        &recipes,
    );

    let started =
        start_pomodoro_impl(&state, block.id.clone(), None).expect("start pomodoro session");
    assert_eq!(started.total_cycles, expected_plan.total_cycles);

    let mut snapshot = advance_pomodoro_impl(&state).expect("advance to break");
    assert_eq!(snapshot.phase, "break");
    assert_eq!(snapshot.completed_cycles, 1);

    if expected_plan.total_cycles > 1 {
        snapshot = advance_pomodoro_impl(&state).expect("advance back to focus");
        assert_eq!(snapshot.phase, "focus");
        assert_eq!(snapshot.current_cycle, 2);
    }

    let mut guard = 0;
    while (snapshot.phase != "break" || snapshot.completed_cycles < expected_plan.total_cycles)
        && guard < 16
    {
        snapshot = advance_pomodoro_impl(&state).expect("advance until final break");
        guard += 1;
    }
    assert_eq!(snapshot.phase, "break");
    assert_eq!(snapshot.completed_cycles, expected_plan.total_cycles);

    snapshot = advance_pomodoro_impl(&state).expect("advance from final break to idle");
    assert_eq!(snapshot.phase, "idle");
    assert_eq!(snapshot.current_block_id, None);
}

#[tokio::test]
async fn resume_complete_and_reflection_flow() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");
    let block_id = generated[0].id.clone();

    let _ = start_pomodoro_impl(&state, block_id, None).expect("start");
    let _ = pause_pomodoro_impl(&state, Some("break".to_string())).expect("pause");
    let resumed = resume_pomodoro_impl(&state).expect("resume");
    assert!(resumed.phase == "focus" || resumed.phase == "break");

    let completed = complete_pomodoro_impl(&state).expect("complete");
    assert_eq!(completed.phase, "idle");

    let summary = get_reflection_summary_impl(&state, None, None).expect("summary");
    assert!(summary.interrupted_count >= 1);
}

#[tokio::test]
async fn reflection_summary_survives_app_state_restart() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");
    let block_id = generated[0].id.clone();

    let _ = start_pomodoro_impl(&state, block_id, None).expect("start");
    let _ = pause_pomodoro_impl(&state, Some("restart-check".to_string())).expect("pause");
    let _ = complete_pomodoro_impl(&state).expect("complete");

    let restarted_state = workspace.app_state();
    let summary = get_reflection_summary_impl(&restarted_state, None, None).expect("summary");

    assert!(summary.interrupted_count >= 1);
    assert!(!summary.logs.is_empty());
}

#[tokio::test]
async fn property_32_reflection_aggregates_match_underlying_logs() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");

    let _ = start_pomodoro_impl(&state, generated[0].id.clone(), None).expect("start first");
    let _ = pause_pomodoro_impl(&state, Some("property-32".to_string())).expect("pause first");
    let _ = complete_pomodoro_impl(&state).expect("complete first");

    let _ = start_pomodoro_impl(&state, generated[1].id.clone(), None).expect("start second");
    let _ = advance_pomodoro_impl(&state).expect("advance second");
    let _ = complete_pomodoro_impl(&state).expect("complete second");

    let summary = get_reflection_summary_impl(&state, None, None).expect("summary");

    assert_eq!(summary.logs.len() as u32, summary.completed_count + summary.interrupted_count);
    assert!(summary.total_focus_minutes >= 0);
}

#[tokio::test]
async fn property_17_interruption_reason_and_time_are_logged_on_pause() {
    let workspace = TempWorkspace::new();
    let state = workspace.app_state();
    let generated = generate_blocks_impl(&state, "2026-02-16".to_string(), None)
        .await
        .expect("generate blocks");

    let _ = start_pomodoro_impl(&state, generated[0].id.clone(), None).expect("start");
    let _ = pause_pomodoro_impl(&state, Some("meeting".to_string())).expect("pause");
    let summary = get_reflection_summary_impl(&state, None, None).expect("summary");
    let paused_log = summary
        .logs
        .iter()
        .find(|log| log.interruption_reason.as_deref() == Some("meeting"))
        .expect("paused log");

    assert_eq!(paused_log.phase, "focus");
    assert!(paused_log.end_time.is_some());
}
