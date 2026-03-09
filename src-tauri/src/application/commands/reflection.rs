use crate::application::reflection_service::ReflectionService;
use crate::infrastructure::error::InfraError;

pub use super::legacy::ReflectionSummaryResponse;

pub fn get_reflection_summary_impl(
    state: &super::legacy::AppState,
    start: Option<String>,
    end: Option<String>,
) -> Result<ReflectionSummaryResponse, InfraError> {
    ReflectionService::new(state).get_summary(start, end)
}
