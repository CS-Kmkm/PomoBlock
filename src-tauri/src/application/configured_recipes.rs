use crate::domain::models::{
    AutoDriveMode, ExecutionHints, OverrunPolicy, Recipe, RecipePomodoroConfig, RecipeStep,
    RecipeStepType, RecipeStudioMeta,
};
use crate::infrastructure::error::InfraError;
use std::fs;
use std::path::Path;

const POMODORO_FOCUS_SECONDS: u32 = 25 * 60;
const POMODORO_BREAK_SECONDS: u32 = 5 * 60;
const RECIPES_FILE_NAME: &str = "recipes.json";

pub fn load_configured_recipes(config_dir: &Path) -> Vec<Recipe> {
    let mut recipes = read_config_array(config_dir, RECIPES_FILE_NAME, "recipes")
        .iter()
        .filter_map(parse_recipe_from_value)
        .collect::<Vec<_>>();
    if recipes.is_empty() {
        return default_recipe_catalog();
    }
    for default_recipe in default_recipe_catalog() {
        if recipes.iter().all(|recipe| recipe.id != default_recipe.id) {
            recipes.push(default_recipe);
        }
    }
    recipes
}

pub fn create_recipe(config_dir: &Path, payload: &serde_json::Value) -> Result<Recipe, InfraError> {
    let recipe = parse_recipe_payload(payload)?;
    let existing = load_configured_recipes(config_dir);
    if existing.iter().any(|candidate| candidate.id == recipe.id) {
        return Err(InfraError::InvalidConfig(format!(
            "recipe already exists: {}",
            recipe.id
        )));
    }

    let mut document = read_recipes_document(config_dir)?;
    let recipes = recipes_array_mut(&mut document)?;
    recipes.push(recipe_to_json_value(&recipe));
    write_recipes_document(config_dir, &document)?;
    Ok(recipe)
}

pub fn update_recipe(
    config_dir: &Path,
    recipe_id: &str,
    payload: &serde_json::Value,
) -> Result<Recipe, InfraError> {
    let recipe_id = recipe_id.trim();
    if recipe_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "recipe_id must not be empty".to_string(),
        ));
    }
    let recipe = parse_recipe_payload_with_id(payload, recipe_id)?;

    let mut document = read_recipes_document(config_dir)?;
    let recipes = recipes_array_mut(&mut document)?;
    let mut updated = false;
    for existing in recipes.iter_mut() {
        let existing_id = existing
            .as_object()
            .and_then(|object| object.get("id"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        if existing_id == recipe_id {
            *existing = recipe_to_json_value(&recipe);
            updated = true;
            break;
        }
    }
    if !updated {
        recipes.push(recipe_to_json_value(&recipe));
    }

    write_recipes_document(config_dir, &document)?;
    Ok(recipe)
}

pub fn delete_recipe(config_dir: &Path, recipe_id: &str) -> Result<bool, InfraError> {
    let recipe_id = recipe_id.trim();
    if recipe_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "recipe_id must not be empty".to_string(),
        ));
    }

    let mut document = read_recipes_document(config_dir)?;
    let recipes = recipes_array_mut(&mut document)?;
    let before = recipes.len();
    recipes.retain(|entry| {
        let existing_id = entry
            .as_object()
            .and_then(|object| object.get("id"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        existing_id != recipe_id
    });
    let deleted = recipes.len() != before;
    if deleted {
        write_recipes_document(config_dir, &document)?;
    }
    Ok(deleted)
}

pub fn recipe_is_routine_studio(recipe: &Recipe) -> bool {
    recipe
        .studio_meta
        .as_ref()
        .map(|meta| meta.version == 1 && meta.kind.eq_ignore_ascii_case("routine_studio"))
        .unwrap_or(false)
}

fn default_recipe_id() -> &'static str {
    "rcp-default"
}

fn default_recipe_steps() -> Vec<RecipeStep> {
    vec![RecipeStep {
        id: "step-1".to_string(),
        step_type: RecipeStepType::Pomodoro,
        title: "Focus".to_string(),
        duration_seconds: POMODORO_FOCUS_SECONDS,
        pomodoro: Some(RecipePomodoroConfig {
            focus_seconds: POMODORO_FOCUS_SECONDS,
            break_seconds: POMODORO_BREAK_SECONDS,
            cycles: 1,
            long_break_seconds: None,
            long_break_every: None,
        }),
        overrun_policy: Some(OverrunPolicy::Wait),
        module_id: None,
        checklist: Vec::new(),
        note: None,
        execution_hints: None,
    }]
}

fn default_recipe() -> Recipe {
    Recipe {
        id: default_recipe_id().to_string(),
        name: "Default Focus".to_string(),
        auto_drive_mode: AutoDriveMode::Manual,
        steps: default_recipe_steps(),
        studio_meta: None,
    }
}

fn default_recipe_catalog() -> Vec<Recipe> {
    vec![default_recipe()]
}

fn parse_recipe_step_type_value(value: Option<&serde_json::Value>) -> Option<RecipeStepType> {
    match value?.as_str()?.trim().to_ascii_lowercase().as_str() {
        "pomodoro" => Some(RecipeStepType::Pomodoro),
        "micro" => Some(RecipeStepType::Micro),
        "free" => Some(RecipeStepType::Free),
        _ => None,
    }
}

fn parse_overrun_policy_value(value: Option<&serde_json::Value>) -> Option<OverrunPolicy> {
    match value?.as_str()?.trim().to_ascii_lowercase().as_str() {
        "notify_and_next" | "notify-and-next" => Some(OverrunPolicy::NotifyAndNext),
        "wait" => Some(OverrunPolicy::Wait),
        _ => None,
    }
}

fn parse_auto_drive_mode_value(value: Option<&serde_json::Value>) -> Option<AutoDriveMode> {
    match value?.as_str()?.trim().to_ascii_lowercase().as_str() {
        "manual" => Some(AutoDriveMode::Manual),
        "auto" => Some(AutoDriveMode::Auto),
        "auto-silent" | "auto_silent" => Some(AutoDriveMode::AutoSilent),
        _ => None,
    }
}

fn parse_positive_u32_value(value: &serde_json::Value) -> Option<u32> {
    if let Some(parsed) = value.as_u64() {
        let parsed = u32::try_from(parsed).ok()?;
        return (parsed > 0).then_some(parsed);
    }
    if let Some(parsed) = value.as_i64() {
        return (parsed > 0).then_some(parsed as u32);
    }
    let parsed = value.as_str()?.trim().parse::<u32>().ok()?;
    (parsed > 0).then_some(parsed)
}

fn parse_recipe_from_value(raw: &serde_json::Value) -> Option<Recipe> {
    let object = raw.as_object()?;
    let id = value_by_keys(object, &["id"])
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let name = value_by_keys(object, &["name"])
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(id.as_str())
        .to_string();
    let auto_drive_mode =
        parse_auto_drive_mode_value(value_by_keys(object, &["autoDriveMode", "auto_drive_mode"]))
            .unwrap_or(AutoDriveMode::Manual);
    let mut steps = value_by_keys(object, &["steps"])
        .and_then(serde_json::Value::as_array)
        .map(|steps_raw| {
            steps_raw
                .iter()
                .enumerate()
                .filter_map(|(index, step_raw)| {
                    let step_object = step_raw.as_object()?;
                    let step_id = value_by_keys(step_object, &["id"])
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned)
                        .unwrap_or_else(|| format!("step-{}", index.saturating_add(1)));
                    let title = value_by_keys(step_object, &["title", "name"])
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .unwrap_or("Step")
                        .to_string();
                    let step_type = parse_recipe_step_type_value(value_by_keys(
                        step_object,
                        &["type", "stepType", "step_type"],
                    ))
                    .unwrap_or(RecipeStepType::Micro);
                    let duration_seconds = value_by_keys(
                        step_object,
                        &["durationSeconds", "duration_seconds", "seconds"],
                    )
                    .and_then(parse_positive_u32_value)
                    .unwrap_or(60);
                    let pomodoro = value_by_keys(step_object, &["pomodoro"])
                        .and_then(serde_json::Value::as_object)
                        .map(|pomodoro| RecipePomodoroConfig {
                            focus_seconds: value_by_keys(
                                pomodoro,
                                &["focusSeconds", "focus_seconds"],
                            )
                            .and_then(parse_positive_u32_value)
                            .unwrap_or(POMODORO_FOCUS_SECONDS),
                            break_seconds: value_by_keys(
                                pomodoro,
                                &["breakSeconds", "break_seconds"],
                            )
                            .and_then(parse_positive_u32_value)
                            .unwrap_or(POMODORO_BREAK_SECONDS),
                            cycles: value_by_keys(pomodoro, &["cycles"])
                                .and_then(parse_positive_u32_value)
                                .unwrap_or(1),
                            long_break_seconds: value_by_keys(
                                pomodoro,
                                &["longBreakSeconds", "long_break_seconds"],
                            )
                            .and_then(parse_positive_u32_value),
                            long_break_every: value_by_keys(
                                pomodoro,
                                &["longBreakEvery", "long_break_every"],
                            )
                            .and_then(parse_positive_u32_value),
                        });
                    let overrun_policy = parse_overrun_policy_value(value_by_keys(
                        step_object,
                        &["overrunPolicy", "overrun_policy"],
                    ));
                    let module_id = value_by_keys(step_object, &["moduleId", "module_id"])
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned);
                    let checklist = value_by_keys(step_object, &["checklist"])
                        .and_then(serde_json::Value::as_array)
                        .map(|items| {
                            items
                                .iter()
                                .filter_map(serde_json::Value::as_str)
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .map(ToOwned::to_owned)
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    let note = value_by_keys(step_object, &["note"])
                        .and_then(serde_json::Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned);
                    let execution_hints = value_by_keys(step_object, &["executionHints", "execution_hints"])
                        .and_then(serde_json::Value::as_object)
                        .map(|hints| ExecutionHints {
                            allow_skip: value_by_keys(hints, &["allowSkip", "allow_skip"])
                                .and_then(serde_json::Value::as_bool)
                                .unwrap_or(false),
                            must_complete_checklist: value_by_keys(
                                hints,
                                &["mustCompleteChecklist", "must_complete_checklist"],
                            )
                            .and_then(serde_json::Value::as_bool)
                            .unwrap_or(false),
                            auto_advance: value_by_keys(hints, &["autoAdvance", "auto_advance"])
                                .and_then(serde_json::Value::as_bool)
                                .unwrap_or(false),
                        });
                    Some(RecipeStep {
                        id: step_id,
                        step_type,
                        title,
                        duration_seconds,
                        pomodoro,
                        overrun_policy,
                        module_id,
                        checklist,
                        note,
                        execution_hints,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if steps.is_empty() {
        steps = default_recipe_steps();
    }
    let recipe = Recipe {
        id,
        name,
        auto_drive_mode,
        steps,
        studio_meta: value_by_keys(object, &["studioMeta", "studio_meta"])
            .and_then(serde_json::Value::as_object)
            .map(|meta| RecipeStudioMeta {
                version: value_by_keys(meta, &["version"])
                    .and_then(serde_json::Value::as_u64)
                    .map(|value| value as u8)
                    .unwrap_or(1),
                kind: value_by_keys(meta, &["kind"])
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("routine_studio")
                    .to_string(),
            }),
    };
    recipe.validate().ok()?;
    Some(recipe)
}

fn parse_recipe_payload(payload: &serde_json::Value) -> Result<Recipe, InfraError> {
    parse_recipe_from_value(payload).ok_or_else(|| {
        InfraError::InvalidConfig("invalid recipe payload; check id/name/steps".to_string())
    })
}

fn parse_recipe_payload_with_id(
    payload: &serde_json::Value,
    recipe_id: &str,
) -> Result<Recipe, InfraError> {
    let mut object = payload
        .as_object()
        .cloned()
        .ok_or_else(|| InfraError::InvalidConfig("recipe payload must be object".to_string()))?;
    object.insert(
        "id".to_string(),
        serde_json::Value::String(recipe_id.to_string()),
    );
    parse_recipe_payload(&serde_json::Value::Object(object))
}

fn auto_drive_mode_as_str(value: &AutoDriveMode) -> &'static str {
    match value {
        AutoDriveMode::Manual => "manual",
        AutoDriveMode::Auto => "auto",
        AutoDriveMode::AutoSilent => "auto-silent",
    }
}

fn recipe_step_type_as_str(value: &RecipeStepType) -> &'static str {
    match value {
        RecipeStepType::Pomodoro => "pomodoro",
        RecipeStepType::Micro => "micro",
        RecipeStepType::Free => "free",
    }
}

fn overrun_policy_as_str(value: &OverrunPolicy) -> &'static str {
    match value {
        OverrunPolicy::NotifyAndNext => "notify_and_next",
        OverrunPolicy::Wait => "wait",
    }
}

fn recipe_to_json_value(recipe: &Recipe) -> serde_json::Value {
    let steps = recipe
        .steps
        .iter()
        .map(|step| {
            let mut object = serde_json::Map::new();
            object.insert(
                "id".to_string(),
                serde_json::Value::String(step.id.clone()),
            );
            object.insert(
                "type".to_string(),
                serde_json::Value::String(recipe_step_type_as_str(&step.step_type).to_string()),
            );
            object.insert(
                "title".to_string(),
                serde_json::Value::String(step.title.clone()),
            );
            object.insert(
                "durationSeconds".to_string(),
                serde_json::Value::from(step.duration_seconds),
            );
            if let Some(pomodoro) = &step.pomodoro {
                let mut pomodoro_object = serde_json::Map::new();
                pomodoro_object.insert(
                    "focusSeconds".to_string(),
                    serde_json::Value::from(pomodoro.focus_seconds),
                );
                pomodoro_object.insert(
                    "breakSeconds".to_string(),
                    serde_json::Value::from(pomodoro.break_seconds),
                );
                pomodoro_object.insert(
                    "cycles".to_string(),
                    serde_json::Value::from(pomodoro.cycles),
                );
                if let Some(long_break_seconds) = pomodoro.long_break_seconds {
                    pomodoro_object.insert(
                        "longBreakSeconds".to_string(),
                        serde_json::Value::from(long_break_seconds),
                    );
                }
                if let Some(long_break_every) = pomodoro.long_break_every {
                    pomodoro_object.insert(
                        "longBreakEvery".to_string(),
                        serde_json::Value::from(long_break_every),
                    );
                }
                object.insert(
                    "pomodoro".to_string(),
                    serde_json::Value::Object(pomodoro_object),
                );
            }
            if let Some(overrun_policy) = &step.overrun_policy {
                object.insert(
                    "overrunPolicy".to_string(),
                    serde_json::Value::String(overrun_policy_as_str(overrun_policy).to_string()),
                );
            }
            if let Some(module_id) = &step.module_id {
                object.insert(
                    "moduleId".to_string(),
                    serde_json::Value::String(module_id.clone()),
                );
            }
            if !step.checklist.is_empty() {
                object.insert(
                    "checklist".to_string(),
                    serde_json::Value::Array(
                        step.checklist
                            .iter()
                            .map(|item| serde_json::Value::String(item.clone()))
                            .collect::<Vec<_>>(),
                    ),
                );
            }
            if let Some(note) = &step.note {
                object.insert(
                    "note".to_string(),
                    serde_json::Value::String(note.clone()),
                );
            }
            if let Some(hints) = &step.execution_hints {
                object.insert(
                    "executionHints".to_string(),
                    serde_json::json!({
                        "allowSkip": hints.allow_skip,
                        "mustCompleteChecklist": hints.must_complete_checklist,
                        "autoAdvance": hints.auto_advance,
                    }),
                );
            }
            serde_json::Value::Object(object)
        })
        .collect::<Vec<_>>();
    let mut object = serde_json::Map::new();
    object.insert("id".to_string(), serde_json::Value::String(recipe.id.clone()));
    object.insert("name".to_string(), serde_json::Value::String(recipe.name.clone()));
    object.insert(
        "autoDriveMode".to_string(),
        serde_json::Value::String(auto_drive_mode_as_str(&recipe.auto_drive_mode).to_string()),
    );
    object.insert("steps".to_string(), serde_json::Value::Array(steps));
    if let Some(meta) = &recipe.studio_meta {
        object.insert(
            "studioMeta".to_string(),
            serde_json::json!({
                "version": meta.version,
                "kind": meta.kind,
            }),
        );
    }
    serde_json::Value::Object(object)
}

fn recipes_config_path(config_dir: &Path) -> std::path::PathBuf {
    config_dir.join(RECIPES_FILE_NAME)
}

fn read_recipes_document(config_dir: &Path) -> Result<serde_json::Value, InfraError> {
    let path = recipes_config_path(config_dir);
    if !path.exists() {
        return Ok(serde_json::json!({
            "schema": 1,
            "recipes": [],
        }));
    }
    let raw = fs::read_to_string(&path)?;
    let parsed: serde_json::Value = serde_json::from_str(&raw)?;
    if !parsed.is_object() {
        return Err(InfraError::InvalidConfig(format!(
            "{} must be a JSON object",
            path.display()
        )));
    }
    let schema = parsed
        .get("schema")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(1);
    if schema != 1 {
        return Err(InfraError::InvalidConfig(format!(
            "unsupported schema {} in {}",
            schema,
            path.display()
        )));
    }
    Ok(parsed)
}

fn write_recipes_document(
    config_dir: &Path,
    document: &serde_json::Value,
) -> Result<(), InfraError> {
    let path = recipes_config_path(config_dir);
    let formatted = serde_json::to_string_pretty(document)?;
    fs::write(path, format!("{formatted}\n"))?;
    Ok(())
}

fn recipes_array_mut(
    document: &mut serde_json::Value,
) -> Result<&mut Vec<serde_json::Value>, InfraError> {
    let object = document
        .as_object_mut()
        .ok_or_else(|| InfraError::InvalidConfig("recipes document must be object".to_string()))?;
    object
        .entry("schema".to_string())
        .or_insert_with(|| serde_json::Value::from(1_u8));
    let recipes_entry = object
        .entry("recipes".to_string())
        .or_insert_with(|| serde_json::Value::Array(Vec::new()));
    recipes_entry.as_array_mut().ok_or_else(|| {
        InfraError::InvalidConfig("recipes must be an array in recipes.json".to_string())
    })
}

fn read_config_array(config_dir: &Path, file_name: &str, array_key: &str) -> Vec<serde_json::Value> {
    let path = config_dir.join(file_name);
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    parsed
        .get(array_key)
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn value_by_keys<'a>(
    object: &'a serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<&'a serde_json::Value> {
    for key in keys {
        if let Some(value) = object.get(*key) {
            return Some(value);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::test_support::config_fs::TempConfigDir;

    #[test]
    fn recipe_crud_roundtrip_preserves_studio_metadata() {
        let config_dir = TempConfigDir::new("recipes", "crud");
        let created = create_recipe(
            config_dir.path(),
            &serde_json::json!({
                "id": "tpl-standup",
                "name": "Standup",
                "autoDriveMode": "auto",
                "steps": [
                    {
                        "id": "step-1",
                        "type": "micro",
                        "title": "Post update",
                        "durationSeconds": 300
                    }
                ],
                "studioMeta": {
                    "version": 1,
                    "kind": "routine_studio"
                }
            }),
        )
        .expect("create recipe");
        let updated = update_recipe(
            config_dir.path(),
            "tpl-standup",
            &serde_json::json!({
                "name": "Standup Updated",
                "steps": [
                    {
                        "id": "step-1",
                        "type": "micro",
                        "title": "Post update",
                        "durationSeconds": 360
                    }
                ],
                "studioMeta": {
                    "version": 1,
                    "kind": "routine_studio"
                }
            }),
        )
        .expect("update recipe");
        let listed = load_configured_recipes(config_dir.path());
        let deleted = delete_recipe(config_dir.path(), "tpl-standup").expect("delete recipe");

        assert_eq!(created.id, "tpl-standup");
        assert_eq!(updated.name, "Standup Updated");
        assert!(recipe_is_routine_studio(&updated));
        assert!(listed.iter().any(|recipe| recipe.id == "tpl-standup"));
        assert!(deleted);
    }

    #[test]
    fn load_configured_recipes_falls_back_to_default_catalog() {
        let config_dir = TempConfigDir::new("recipes", "defaults");

        let recipes = load_configured_recipes(config_dir.path());

        assert_eq!(recipes.len(), 1);
        assert_eq!(recipes[0].id, "rcp-default");
        assert_eq!(recipes[0].auto_drive_mode, AutoDriveMode::Manual);
    }
}
