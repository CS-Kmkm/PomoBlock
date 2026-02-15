use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Firmness {
    Draft,
    Soft,
    Hard,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BlockType {
    Deep,
    Shallow,
    Admin,
    Learning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Block {
    pub id: String,
    pub instance: String,
    pub date: String,
    pub start_at: DateTime<Utc>,
    pub end_at: DateTime<Utc>,
    pub block_type: BlockType,
    pub firmness: Firmness,
    pub planned_pomodoros: i32,
    pub source: String,
    pub source_id: Option<String>,
}
