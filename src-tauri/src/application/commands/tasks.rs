use crate::application::task_service::TaskService;
use crate::domain::models::Task;
use crate::infrastructure::error::InfraError;

pub use super::legacy::CarryOverTaskResponse;

pub fn create_task_impl(
    state: &super::legacy::AppState,
    title: String,
    description: Option<String>,
    estimated_pomodoros: Option<u32>,
) -> Result<Task, InfraError> {
    TaskService::new(state).create_task(title, description, estimated_pomodoros)
}

pub fn list_tasks_impl(state: &super::legacy::AppState) -> Result<Vec<Task>, InfraError> {
    TaskService::new(state).list_tasks()
}

pub fn update_task_impl(
    state: &super::legacy::AppState,
    task_id: String,
    title: Option<String>,
    description: Option<String>,
    estimated_pomodoros: Option<u32>,
    status: Option<String>,
) -> Result<Task, InfraError> {
    TaskService::new(state).update_task(task_id, title, description, estimated_pomodoros, status)
}

pub fn delete_task_impl(
    state: &super::legacy::AppState,
    task_id: String,
) -> Result<bool, InfraError> {
    TaskService::new(state).delete_task(task_id)
}

pub fn split_task_impl(
    state: &super::legacy::AppState,
    task_id: String,
    parts: u32,
) -> Result<Vec<Task>, InfraError> {
    TaskService::new(state).split_task(task_id, parts)
}

pub fn carry_over_task_impl(
    state: &super::legacy::AppState,
    task_id: String,
    from_block_id: String,
    candidate_block_ids: Option<Vec<String>>,
) -> Result<CarryOverTaskResponse, InfraError> {
    TaskService::new(state).carry_over_task(task_id, from_block_id, candidate_block_ids)
}
