mod application;
mod domain;
mod infrastructure;

use application::bootstrap::bootstrap_workspace;
use application::commands::{
    adjust_block_time_impl, approve_blocks_impl, authenticate_google_impl, complete_pomodoro_impl,
    create_task_impl, delete_block_impl, delete_task_impl, generate_blocks_impl,
    get_pomodoro_state_impl, get_reflection_summary_impl, list_blocks_impl, list_tasks_impl,
    pause_pomodoro_impl, resume_pomodoro_impl, start_pomodoro_impl, sync_calendar_impl,
    update_task_impl, AppState, AuthenticateGoogleResponse, PomodoroStateResponse,
    ReflectionSummaryResponse, SyncCalendarResponse,
};
use domain::models::{Block, Task};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
struct BootstrapResponse {
    workspace_root: String,
    database_path: String,
}

#[tauri::command]
fn bootstrap(root: Option<String>) -> Result<BootstrapResponse, String> {
    let workspace_root = match root {
        Some(path) => PathBuf::from(path),
        None => std::env::current_dir().map_err(|error| error.to_string())?,
    };

    let result = bootstrap_workspace(&workspace_root).map_err(|error| error.to_string())?;
    Ok(BootstrapResponse {
        workspace_root: result.workspace_root.display().to_string(),
        database_path: result.database_path.display().to_string(),
    })
}

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
async fn authenticate_google(
    state: tauri::State<'_, AppState>,
    authorization_code: Option<String>,
) -> Result<AuthenticateGoogleResponse, String> {
    authenticate_google_impl(state.inner(), authorization_code)
        .await
        .map_err(|error| state.command_error("authenticate_google", &error))
}

#[tauri::command]
async fn sync_calendar(
    state: tauri::State<'_, AppState>,
    time_min: Option<String>,
    time_max: Option<String>,
) -> Result<SyncCalendarResponse, String> {
    sync_calendar_impl(state.inner(), time_min, time_max)
        .await
        .map_err(|error| state.command_error("sync_calendar", &error))
}

#[tauri::command]
async fn generate_blocks(
    state: tauri::State<'_, AppState>,
    date: String,
) -> Result<Vec<Block>, String> {
    generate_blocks_impl(state.inner(), date)
        .await
        .map_err(|error| state.command_error("generate_blocks", &error))
}

#[tauri::command]
async fn approve_blocks(
    state: tauri::State<'_, AppState>,
    block_ids: Vec<String>,
) -> Result<Vec<Block>, String> {
    approve_blocks_impl(state.inner(), block_ids)
        .await
        .map_err(|error| state.command_error("approve_blocks", &error))
}

#[tauri::command]
async fn delete_block(state: tauri::State<'_, AppState>, block_id: String) -> Result<bool, String> {
    delete_block_impl(state.inner(), block_id)
        .await
        .map_err(|error| state.command_error("delete_block", &error))
}

#[tauri::command]
async fn adjust_block_time(
    state: tauri::State<'_, AppState>,
    block_id: String,
    start_at: String,
    end_at: String,
) -> Result<Block, String> {
    adjust_block_time_impl(state.inner(), block_id, start_at, end_at)
        .await
        .map_err(|error| state.command_error("adjust_block_time", &error))
}

#[tauri::command]
fn list_blocks(state: tauri::State<'_, AppState>, date: Option<String>) -> Result<Vec<Block>, String> {
    list_blocks_impl(state.inner(), date).map_err(|error| state.command_error("list_blocks", &error))
}

#[tauri::command]
fn start_pomodoro(
    state: tauri::State<'_, AppState>,
    block_id: String,
    task_id: Option<String>,
) -> Result<PomodoroStateResponse, String> {
    start_pomodoro_impl(state.inner(), block_id, task_id)
        .map_err(|error| state.command_error("start_pomodoro", &error))
}

#[tauri::command]
fn pause_pomodoro(
    state: tauri::State<'_, AppState>,
    reason: Option<String>,
) -> Result<PomodoroStateResponse, String> {
    pause_pomodoro_impl(state.inner(), reason)
        .map_err(|error| state.command_error("pause_pomodoro", &error))
}

#[tauri::command]
fn get_pomodoro_state(state: tauri::State<'_, AppState>) -> Result<PomodoroStateResponse, String> {
    get_pomodoro_state_impl(state.inner())
        .map_err(|error| state.command_error("get_pomodoro_state", &error))
}

#[tauri::command]
fn resume_pomodoro(state: tauri::State<'_, AppState>) -> Result<PomodoroStateResponse, String> {
    resume_pomodoro_impl(state.inner()).map_err(|error| state.command_error("resume_pomodoro", &error))
}

#[tauri::command]
fn complete_pomodoro(state: tauri::State<'_, AppState>) -> Result<PomodoroStateResponse, String> {
    complete_pomodoro_impl(state.inner())
        .map_err(|error| state.command_error("complete_pomodoro", &error))
}

#[tauri::command]
fn list_tasks(state: tauri::State<'_, AppState>) -> Result<Vec<Task>, String> {
    list_tasks_impl(state.inner()).map_err(|error| state.command_error("list_tasks", &error))
}

#[tauri::command]
fn create_task(
    state: tauri::State<'_, AppState>,
    title: String,
    description: Option<String>,
    estimated_pomodoros: Option<u32>,
) -> Result<Task, String> {
    create_task_impl(state.inner(), title, description, estimated_pomodoros)
        .map_err(|error| state.command_error("create_task", &error))
}

#[tauri::command]
fn update_task(
    state: tauri::State<'_, AppState>,
    task_id: String,
    title: Option<String>,
    description: Option<String>,
    estimated_pomodoros: Option<u32>,
    status: Option<String>,
) -> Result<Task, String> {
    update_task_impl(
        state.inner(),
        task_id,
        title,
        description,
        estimated_pomodoros,
        status,
    )
    .map_err(|error| state.command_error("update_task", &error))
}

#[tauri::command]
fn delete_task(state: tauri::State<'_, AppState>, task_id: String) -> Result<bool, String> {
    delete_task_impl(state.inner(), task_id).map_err(|error| state.command_error("delete_task", &error))
}

#[tauri::command]
fn get_reflection_summary(
    state: tauri::State<'_, AppState>,
    start: Option<String>,
    end: Option<String>,
) -> Result<ReflectionSummaryResponse, String> {
    get_reflection_summary_impl(state.inner(), start, end)
        .map_err(|error| state.command_error("get_reflection_summary", &error))
}

pub fn run() {
    let workspace_root = std::env::current_dir().expect("failed to resolve current directory");
    let app_state = AppState::new(workspace_root).expect("failed to initialize app state");

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            ping,
            bootstrap,
            authenticate_google,
            sync_calendar,
            generate_blocks,
            approve_blocks,
            delete_block,
            adjust_block_time,
            list_blocks,
            start_pomodoro,
            pause_pomodoro,
            get_pomodoro_state,
            resume_pomodoro,
            complete_pomodoro,
            list_tasks,
            create_task,
            update_task,
            delete_task,
            get_reflection_summary
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}
