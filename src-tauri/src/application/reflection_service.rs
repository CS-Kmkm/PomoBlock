use crate::application::commands::legacy;
use crate::infrastructure::error::InfraError;

pub struct ReflectionService<'a> {
    state: &'a legacy::AppState,
}

impl<'a> ReflectionService<'a> {
    pub fn new(state: &'a legacy::AppState) -> Self {
        Self { state }
    }

    pub fn get_summary(
        &self,
        start: Option<String>,
        end: Option<String>,
    ) -> Result<legacy::ReflectionSummaryResponse, InfraError> {
        legacy::get_reflection_summary_impl(self.state, start, end)
    }
}
