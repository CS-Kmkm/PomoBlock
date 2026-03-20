use crate::application::configured_routines::{
    delete_routine_schedule, load_configured_routines, save_routine_schedule,
    save_routine_schedule_group,
};
use crate::infrastructure::error::InfraError;

pub fn list_routine_schedules_impl(state: &super::bootstrap::AppState) -> Result<Vec<serde_json::Value>, InfraError> {
    Ok(load_configured_routines(state.config_dir()))
}

pub fn list_routines_impl(state: &super::bootstrap::AppState) -> Result<Vec<serde_json::Value>, InfraError> {
    list_routine_schedules_impl(state)
}

pub fn save_routine_schedule_impl(
    state: &super::bootstrap::AppState,
    payload: serde_json::Value,
) -> Result<serde_json::Value, InfraError> {
    let routine = save_routine_schedule(state.config_dir(), &payload)?;
    state.log_info(
        "save_routine_schedule",
        &format!(
            "saved routine_id={}",
            routine
                .get("id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
        ),
    );
    Ok(routine)
}

pub fn save_routine_schedule_group_impl(
    state: &super::bootstrap::AppState,
    payload: serde_json::Value,
) -> Result<Vec<serde_json::Value>, InfraError> {
    let saved = save_routine_schedule_group(state.config_dir(), &payload)?;
    state.log_info(
        "save_routine_schedule_group",
        &format!("saved routine_count={}", saved.len()),
    );
    Ok(saved)
}

pub fn delete_routine_schedule_impl(
    state: &super::bootstrap::AppState,
    routine_id: String,
) -> Result<bool, InfraError> {
    let deleted = delete_routine_schedule(state.config_dir(), &routine_id)?;
    if deleted {
        state.log_info(
            "delete_routine_schedule",
            &format!("deleted routine_id={routine_id}"),
        );
    }
    Ok(deleted)
}
