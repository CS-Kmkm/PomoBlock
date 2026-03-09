use crate::application::commands::legacy;
use crate::domain::models::Block;
use crate::infrastructure::error::InfraError;

pub struct BlockService<'a> {
    state: &'a legacy::AppState,
}

impl<'a> BlockService<'a> {
    pub fn new(state: &'a legacy::AppState) -> Self {
        Self { state }
    }

    pub async fn generate_blocks(
        &self,
        date: String,
        account_id: Option<String>,
    ) -> Result<Vec<Block>, InfraError> {
        legacy::generate_blocks_impl(self.state, date, account_id).await
    }

    pub async fn generate_one_block(
        &self,
        date: String,
        account_id: Option<String>,
    ) -> Result<Vec<Block>, InfraError> {
        legacy::generate_one_block_impl(self.state, date, account_id).await
    }

    pub async fn generate_today_blocks(
        &self,
        account_id: Option<String>,
    ) -> Result<Vec<Block>, InfraError> {
        legacy::generate_today_blocks_impl(self.state, account_id).await
    }

    pub async fn approve_blocks(&self, block_ids: Vec<String>) -> Result<Vec<Block>, InfraError> {
        legacy::approve_blocks_impl(self.state, block_ids).await
    }

    pub async fn delete_block(&self, block_id: String) -> Result<bool, InfraError> {
        legacy::delete_block_impl(self.state, block_id).await
    }

    pub async fn adjust_block_time(
        &self,
        block_id: String,
        start_at: String,
        end_at: String,
    ) -> Result<Block, InfraError> {
        legacy::adjust_block_time_impl(self.state, block_id, start_at, end_at).await
    }

    pub async fn relocate_if_needed(
        &self,
        block_id: String,
        account_id: Option<String>,
    ) -> Result<Option<Block>, InfraError> {
        legacy::relocate_if_needed_impl(self.state, block_id, account_id).await
    }

    pub fn list_blocks(&self, date: Option<String>) -> Result<Vec<Block>, InfraError> {
        legacy::list_blocks_impl(self.state, date)
    }

    pub async fn apply_studio_template_to_today(
        &self,
        template_id: String,
        date: String,
        trigger_time: String,
        conflict_policy: Option<String>,
        account_id: Option<String>,
    ) -> Result<legacy::ApplyStudioResult, InfraError> {
        legacy::apply_studio_template_to_today_impl(
            self.state,
            template_id,
            date,
            trigger_time,
            conflict_policy,
            account_id,
        )
        .await
    }
}
