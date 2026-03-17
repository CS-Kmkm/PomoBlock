mod auth;
mod blocks;
mod bootstrap;
mod calendar;
mod catalog;
#[cfg(test)]
mod regression_tests;
mod pomodoro;
mod reflection;
mod state;
mod tasks;

pub use blocks::{
    adjust_block_time_impl, apply_studio_template_to_today_impl, approve_blocks_impl,
    delete_block_impl, generate_blocks_impl, generate_one_block_impl, generate_today_blocks_impl,
    list_blocks_impl, relocate_if_needed_impl,
};
pub use bootstrap::AppState;
pub use calendar::{
    authenticate_google_impl, authenticate_google_sso_impl, list_synced_events_impl,
    sync_calendar_impl, AuthenticateGoogleResponse, SyncedEventSlotResponse,
    SyncCalendarResponse,
};
pub use catalog::{
    create_module_folder_impl, create_module_impl, create_recipe_impl, delete_module_folder_impl,
    delete_module_impl, delete_recipe_impl, list_module_folders_impl, list_modules_impl,
    list_recipes_impl, move_module_folder_impl, move_module_impl, update_module_impl,
    update_recipe_impl,
};
pub use pomodoro::{
    advance_pomodoro_impl, complete_pomodoro_impl, get_pomodoro_state_impl, interrupt_timer_impl,
    next_step_impl, pause_pomodoro_impl, pause_timer_impl, resume_pomodoro_impl,
    resume_timer_impl, start_block_timer_impl, start_pomodoro_impl, PomodoroStateResponse,
};
pub use reflection::{get_reflection_summary_impl, ReflectionSummaryResponse};
pub use crate::application::studio_template_application::ApplyStudioResult;
pub use tasks::{
    carry_over_task_impl, create_task_impl, delete_task_impl, list_tasks_impl, split_task_impl,
    update_task_impl, CarryOverTaskResponse,
};
pub(crate) use auth::{
    ensure_blocks_calendar_id, normalize_account_id, try_access_token, DEFAULT_ACCOUNT_ID,
};
pub(crate) use state::{
    block_runtime_snapshot, lock_runtime, persist_generated_block, persist_generated_blocks,
    studio_runtime_snapshot, RuntimeState, StoredBlock,
};
