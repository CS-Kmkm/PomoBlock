use crate::domain::models::{Block, Recipe, RecipeStepType};

const DEFAULT_POMODORO_FOCUS_SECONDS: u32 = 25 * 60;
const MIN_POMODORO_BREAK_SECONDS: u32 = 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PomodoroSessionPlan {
    pub total_cycles: u32,
    pub focus_seconds: u32,
    pub break_seconds: u32,
}

pub fn build_pomodoro_session_plan(
    block: &Block,
    break_duration_minutes: u32,
    recipes: &[Recipe],
) -> PomodoroSessionPlan {
    let fallback_cycles = u32::try_from(block.planned_pomodoros)
        .ok()
        .filter(|value| *value > 0)
        .unwrap_or(1);
    let recipe_pomodoro = recipes
        .iter()
        .find(|recipe| recipe.id == block.recipe_id)
        .and_then(|recipe| {
            recipe.steps.iter().find_map(|step| match step.step_type {
                RecipeStepType::Pomodoro => step.pomodoro.as_ref(),
                _ => None,
            })
        });
    let focus_seconds = recipe_pomodoro
        .map(|pomodoro| pomodoro.focus_seconds.max(1))
        .unwrap_or(DEFAULT_POMODORO_FOCUS_SECONDS);
    let break_seconds = recipe_pomodoro
        .map(|pomodoro| pomodoro.break_seconds.max(1))
        .unwrap_or_else(|| {
            (break_duration_minutes.saturating_mul(60)).max(MIN_POMODORO_BREAK_SECONDS)
        });
    let requested_cycles = recipe_pomodoro
        .map(|pomodoro| pomodoro.cycles.max(1))
        .unwrap_or(fallback_cycles);
    let cycle_seconds = focus_seconds.saturating_add(break_seconds).max(1);
    let block_seconds = (block.end_at - block.start_at).num_seconds().max(0) as u32;
    let max_cycles_by_duration = (block_seconds / cycle_seconds).max(1);
    let total_cycles = requested_cycles.min(max_cycles_by_duration).max(1);

    PomodoroSessionPlan {
        total_cycles,
        focus_seconds,
        break_seconds,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::models::{
        AutoDriveMode, BlockContents, Firmness, RecipePomodoroConfig, RecipeStep,
    };
    use chrono::{DateTime, Utc};

    fn sample_block(planned_pomodoros: i32, recipe_id: &str, end_at: &str) -> Block {
        Block {
            id: "blk-1".to_string(),
            instance: "inst-1".to_string(),
            date: "2026-02-16".to_string(),
            start_at: DateTime::parse_from_rfc3339("2026-02-16T09:00:00Z")
                .expect("start")
                .with_timezone(&Utc),
            end_at: DateTime::parse_from_rfc3339(end_at)
                .expect("end")
                .with_timezone(&Utc),
            firmness: Firmness::Draft,
            planned_pomodoros,
            source: "routine".to_string(),
            source_id: Some("rtn-1".to_string()),
            recipe_id: recipe_id.to_string(),
            auto_drive_mode: AutoDriveMode::Manual,
            contents: BlockContents::default(),
        }
    }

    #[test]
    fn session_plan_uses_recipe_pomodoro_settings() {
        let block = sample_block(3, "rcp-deep", "2026-02-16T10:30:00Z");
        let recipes = vec![Recipe {
            id: "rcp-deep".to_string(),
            name: "Deep".to_string(),
            auto_drive_mode: AutoDriveMode::Manual,
            steps: vec![RecipeStep {
                id: "step-1".to_string(),
                step_type: RecipeStepType::Pomodoro,
                title: "Focus".to_string(),
                duration_seconds: 1,
                pomodoro: Some(RecipePomodoroConfig {
                    focus_seconds: 1500,
                    break_seconds: 300,
                    cycles: 4,
                    long_break_seconds: None,
                    long_break_every: None,
                }),
                overrun_policy: None,
                module_id: None,
                checklist: Vec::new(),
                note: None,
                execution_hints: None,
            }],
            studio_meta: None,
        }];

        let plan = build_pomodoro_session_plan(&block, 5, &recipes);

        assert_eq!(plan.focus_seconds, 1500);
        assert_eq!(plan.break_seconds, 300);
        assert_eq!(plan.total_cycles, 3);
    }

    #[test]
    fn session_plan_falls_back_to_block_estimate_when_recipe_missing() {
        let block = sample_block(2, "missing", "2026-02-16T10:00:00Z");

        let plan = build_pomodoro_session_plan(&block, 10, &[]);

        assert_eq!(plan.focus_seconds, DEFAULT_POMODORO_FOCUS_SECONDS);
        assert_eq!(plan.break_seconds, 600);
        assert_eq!(plan.total_cycles, 1);
    }
}
