use crate::application::commands::RuntimeState;
use crate::domain::models::TaskStatus;
use crate::infrastructure::error::InfraError;

pub(crate) fn parse_task_status(value: &str) -> Result<TaskStatus, InfraError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "pending" => Ok(TaskStatus::Pending),
        "in_progress" | "in-progress" => Ok(TaskStatus::InProgress),
        "completed" => Ok(TaskStatus::Completed),
        "deferred" => Ok(TaskStatus::Deferred),
        other => Err(InfraError::InvalidConfig(format!(
            "unsupported task status: {}",
            other
        ))),
    }
}

pub(crate) fn task_status_as_str(value: &TaskStatus) -> &'static str {
    match value {
        TaskStatus::Pending => "pending",
        TaskStatus::InProgress => "in_progress",
        TaskStatus::Completed => "completed",
        TaskStatus::Deferred => "deferred",
    }
}

pub(crate) fn assign_task_to_block(runtime: &mut RuntimeState, task_id: &str, block_id: &str) {
    if let Some(previous_block_id) = runtime
        .task_assignments_by_task
        .insert(task_id.to_string(), block_id.to_string())
    {
        runtime.task_assignments_by_block.remove(previous_block_id.as_str());
    }
    if let Some(previous_task_id) = runtime
        .task_assignments_by_block
        .insert(block_id.to_string(), task_id.to_string())
    {
        runtime.task_assignments_by_task.remove(previous_task_id.as_str());
    }
}

pub(crate) fn unassign_task(runtime: &mut RuntimeState, task_id: &str) -> Option<String> {
    let previous_block_id = runtime.task_assignments_by_task.remove(task_id)?;
    runtime
        .task_assignments_by_block
        .remove(previous_block_id.as_str());
    Some(previous_block_id)
}
