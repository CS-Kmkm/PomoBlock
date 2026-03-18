use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Firmness {
    Draft,
    Soft,
    Hard,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum AutoDriveMode {
    #[default]
    Manual,
    Auto,
    AutoSilent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecipeStepType {
    Pomodoro,
    Micro,
    Free,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OverrunPolicy {
    NotifyAndNext,
    Wait,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecipePomodoroConfig {
    pub focus_seconds: u32,
    pub break_seconds: u32,
    pub cycles: u32,
    pub long_break_seconds: Option<u32>,
    pub long_break_every: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecutionHints {
    #[serde(default)]
    pub allow_skip: bool,
    #[serde(default)]
    pub must_complete_checklist: bool,
    #[serde(default)]
    pub auto_advance: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecipeStudioMeta {
    pub version: u8,
    pub kind: String,
    #[serde(default)]
    pub context: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecipeStep {
    pub id: String,
    pub step_type: RecipeStepType,
    pub title: String,
    pub duration_seconds: u32,
    pub pomodoro: Option<RecipePomodoroConfig>,
    pub overrun_policy: Option<OverrunPolicy>,
    pub module_id: Option<String>,
    #[serde(default)]
    pub checklist: Vec<String>,
    pub note: Option<String>,
    pub execution_hints: Option<ExecutionHints>,
}

impl RecipeStep {
    pub fn validate(&self) -> Result<(), String> {
        validate_non_empty(&self.id, "recipe_step.id")?;
        validate_non_empty(&self.title, "recipe_step.title")?;
        if self.duration_seconds == 0 {
            return Err("recipe_step.duration_seconds must be > 0".to_string());
        }
        if let Some(module_id) = &self.module_id {
            validate_non_empty(module_id, "recipe_step.module_id")?;
        }
        for item in &self.checklist {
            validate_non_empty(item, "recipe_step.checklist[]")?;
        }
        if let Some(pomodoro) = &self.pomodoro {
            if pomodoro.focus_seconds == 0 {
                return Err("recipe_step.pomodoro.focus_seconds must be > 0".to_string());
            }
            if pomodoro.break_seconds == 0 {
                return Err("recipe_step.pomodoro.break_seconds must be > 0".to_string());
            }
            if pomodoro.cycles == 0 {
                return Err("recipe_step.pomodoro.cycles must be > 0".to_string());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Recipe {
    pub id: String,
    pub name: String,
    pub auto_drive_mode: AutoDriveMode,
    pub steps: Vec<RecipeStep>,
    pub studio_meta: Option<RecipeStudioMeta>,
}

impl Recipe {
    pub fn validate(&self) -> Result<(), String> {
        validate_non_empty(&self.id, "recipe.id")?;
        validate_non_empty(&self.name, "recipe.name")?;
        if self.steps.is_empty() {
            return Err("recipe.steps must not be empty".to_string());
        }
        if let Some(meta) = &self.studio_meta {
            if meta.version != 1 {
                return Err("recipe.studio_meta.version must be 1".to_string());
            }
            validate_non_empty(&meta.kind, "recipe.studio_meta.kind")?;
            if let Some(context) = &meta.context {
                validate_non_empty(context, "recipe.studio_meta.context")?;
            }
        }
        for step in &self.steps {
            step.validate()?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModulePomodoroConfig {
    pub focus_seconds: u32,
    pub break_seconds: u32,
    pub cycles: u32,
    pub long_break_seconds: Option<u32>,
    pub long_break_every: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Module {
    pub id: String,
    pub name: String,
    pub category: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub step_type: RecipeStepType,
    pub duration_minutes: u32,
    #[serde(default)]
    pub checklist: Vec<String>,
    pub pomodoro: Option<ModulePomodoroConfig>,
    pub overrun_policy: Option<OverrunPolicy>,
    pub execution_hints: Option<ExecutionHints>,
}

impl Module {
    pub fn validate(&self) -> Result<(), String> {
        validate_non_empty(&self.id, "module.id")?;
        validate_non_empty(&self.name, "module.name")?;
        validate_non_empty(&self.category, "module.category")?;
        if self.duration_minutes == 0 {
            return Err("module.duration_minutes must be > 0".to_string());
        }
        for item in &self.checklist {
            validate_non_empty(item, "module.checklist[]")?;
        }
        if let Some(pomodoro) = &self.pomodoro {
            if pomodoro.focus_seconds == 0 {
                return Err("module.pomodoro.focus_seconds must be > 0".to_string());
            }
            if pomodoro.break_seconds == 0 {
                return Err("module.pomodoro.break_seconds must be > 0".to_string());
            }
            if pomodoro.cycles == 0 {
                return Err("module.pomodoro.cycles must be > 0".to_string());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModuleFolder {
    pub id: String,
    pub name: String,
}

impl ModuleFolder {
    pub fn validate(&self) -> Result<(), String> {
        validate_non_empty(&self.id, "module_folder.id")?;
        validate_non_empty(&self.name, "module_folder.name")?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BlockChecklistItem {
    pub id: String,
    pub label: String,
    pub checked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BlockTimeSplit {
    pub label: String,
    pub minutes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct BlockContents {
    #[serde(default)]
    pub task_refs: Vec<String>,
    pub memo: Option<String>,
    #[serde(default)]
    pub checklist: Vec<BlockChecklistItem>,
    #[serde(default)]
    pub time_splits: Vec<BlockTimeSplit>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Block {
    pub id: String,
    pub instance: String,
    pub date: String,
    pub start_at: DateTime<Utc>,
    pub end_at: DateTime<Utc>,
    pub firmness: Firmness,
    pub planned_pomodoros: i32,
    pub source: String,
    pub source_id: Option<String>,
    #[serde(default = "default_recipe_id")]
    pub recipe_id: String,
    #[serde(default)]
    pub auto_drive_mode: AutoDriveMode,
    #[serde(default)]
    pub contents: BlockContents,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    InProgress,
    Completed,
    Deferred,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub estimated_pomodoros: Option<u32>,
    pub completed_pomodoros: u32,
    pub status: TaskStatus,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PomodoroPhase {
    Focus,
    Break,
    LongBreak,
    Paused,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PomodoroLog {
    pub id: String,
    pub block_id: String,
    pub task_id: Option<String>,
    pub phase: PomodoroPhase,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub interruption_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OAuthToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: DateTime<Utc>,
    pub token_type: String,
    pub scope: Option<String>,
}

impl OAuthToken {
    pub fn is_valid_at(&self, now: DateTime<Utc>, leeway_seconds: i64) -> bool {
        self.expires_at > now + chrono::Duration::seconds(leeway_seconds)
            && !self.access_token.trim().is_empty()
    }
}

fn default_recipe_id() -> String {
    "rcp-default".to_string()
}

fn validate_non_empty(value: &str, field_name: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{field_name} must not be empty"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed_time(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .expect("valid datetime")
            .with_timezone(&Utc)
    }

    fn sample_block() -> Block {
        Block {
            id: "blk-1".to_string(),
            instance: "tpl:deep-1:2026-02-16".to_string(),
            date: "2026-02-16".to_string(),
            start_at: fixed_time("2026-02-16T09:00:00Z"),
            end_at: fixed_time("2026-02-16T10:00:00Z"),
            firmness: Firmness::Draft,
            planned_pomodoros: 2,
            source: "template".to_string(),
            source_id: Some("tpl-deep-1".to_string()),
            recipe_id: "rcp-deep-default".to_string(),
            auto_drive_mode: AutoDriveMode::Manual,
            contents: BlockContents::default(),
        }
    }

    fn sample_task() -> Task {
        Task {
            id: "tsk-1".to_string(),
            title: "Write tests".to_string(),
            description: Some("for domain models".to_string()),
            estimated_pomodoros: Some(3),
            completed_pomodoros: 1,
            status: TaskStatus::InProgress,
            created_at: fixed_time("2026-02-16T08:00:00Z"),
        }
    }

    fn sample_pomodoro() -> PomodoroLog {
        PomodoroLog {
            id: "pom-1".to_string(),
            block_id: "blk-1".to_string(),
            task_id: Some("tsk-1".to_string()),
            phase: PomodoroPhase::Focus,
            start_time: fixed_time("2026-02-16T09:00:00Z"),
            end_time: Some(fixed_time("2026-02-16T09:25:00Z")),
            interruption_reason: None,
        }
    }

    fn sample_recipe() -> Recipe {
        Recipe {
            id: "rcp-deep-default".to_string(),
            name: "Deep Work".to_string(),
            auto_drive_mode: AutoDriveMode::Manual,
            steps: vec![RecipeStep {
                id: "step-1".to_string(),
                step_type: RecipeStepType::Pomodoro,
                title: "Focus Session".to_string(),
                duration_seconds: 1500,
                pomodoro: Some(RecipePomodoroConfig {
                    focus_seconds: 1500,
                    break_seconds: 300,
                    cycles: 1,
                    long_break_seconds: None,
                    long_break_every: None,
                }),
                overrun_policy: Some(OverrunPolicy::Wait),
                module_id: None,
                checklist: Vec::new(),
                note: None,
                execution_hints: None,
            }],
            studio_meta: None,
        }
    }

    #[test]
    fn domain_models_support_serde_roundtrip() {
        let block = sample_block();
        let task = sample_task();
        let pomodoro = sample_pomodoro();
        let recipe = sample_recipe();

        let block_roundtrip: Block =
            serde_json::from_str(&serde_json::to_string(&block).expect("serialize block"))
                .expect("deserialize block");
        let task_roundtrip: Task =
            serde_json::from_str(&serde_json::to_string(&task).expect("serialize task"))
                .expect("deserialize task");
        let pomodoro_roundtrip: PomodoroLog = serde_json::from_str(
            &serde_json::to_string(&pomodoro).expect("serialize pomodoro"),
        )
        .expect("deserialize pomodoro");
        let recipe_roundtrip: Recipe =
            serde_json::from_str(&serde_json::to_string(&recipe).expect("serialize recipe"))
                .expect("deserialize recipe");

        assert_eq!(block_roundtrip, block);
        assert_eq!(task_roundtrip, task);
        assert_eq!(pomodoro_roundtrip, pomodoro);
        assert_eq!(recipe_roundtrip, recipe);
    }
}
