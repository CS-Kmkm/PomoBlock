use crate::application::block_service::BlockService;
use crate::domain::models::Block;
use crate::infrastructure::error::InfraError;

pub async fn generate_blocks_impl(
    state: &super::legacy::AppState,
    date: String,
    account_id: Option<String>,
) -> Result<Vec<Block>, InfraError> {
    BlockService::new(state).generate_blocks(date, account_id).await
}

pub async fn generate_one_block_impl(
    state: &super::legacy::AppState,
    date: String,
    account_id: Option<String>,
) -> Result<Vec<Block>, InfraError> {
    BlockService::new(state)
        .generate_one_block(date, account_id)
        .await
}

pub async fn generate_today_blocks_impl(
    state: &super::legacy::AppState,
    account_id: Option<String>,
) -> Result<Vec<Block>, InfraError> {
    BlockService::new(state).generate_today_blocks(account_id).await
}

pub async fn approve_blocks_impl(
    state: &super::legacy::AppState,
    block_ids: Vec<String>,
) -> Result<Vec<Block>, InfraError> {
    BlockService::new(state).approve_blocks(block_ids).await
}

pub async fn delete_block_impl(
    state: &super::legacy::AppState,
    block_id: String,
) -> Result<bool, InfraError> {
    BlockService::new(state).delete_block(block_id).await
}

pub async fn adjust_block_time_impl(
    state: &super::legacy::AppState,
    block_id: String,
    start_at: String,
    end_at: String,
) -> Result<Block, InfraError> {
    BlockService::new(state)
        .adjust_block_time(block_id, start_at, end_at)
        .await
}

pub async fn relocate_if_needed_impl(
    state: &super::legacy::AppState,
    block_id: String,
    account_id: Option<String>,
) -> Result<Option<Block>, InfraError> {
    BlockService::new(state)
        .relocate_if_needed(block_id, account_id)
        .await
}

pub fn list_blocks_impl(
    state: &super::legacy::AppState,
    date: Option<String>,
) -> Result<Vec<Block>, InfraError> {
    BlockService::new(state).list_blocks(date)
}

pub async fn apply_studio_template_to_today_impl(
    state: &super::legacy::AppState,
    template_id: String,
    date: String,
    trigger_time: String,
    conflict_policy: Option<String>,
    account_id: Option<String>,
) -> Result<super::ApplyStudioResult, InfraError> {
    BlockService::new(state)
        .apply_studio_template_to_today(
            template_id,
            date,
            trigger_time,
            conflict_policy,
            account_id,
        )
        .await
}
