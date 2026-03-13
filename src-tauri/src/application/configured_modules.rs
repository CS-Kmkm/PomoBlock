use crate::domain::models::{
    ExecutionHints, Module, ModulePomodoroConfig, OverrunPolicy, RecipeStepType,
};
use crate::infrastructure::error::InfraError;
use std::fs;
use std::path::{Path, PathBuf};

const POMODORO_FOCUS_SECONDS: u32 = 25 * 60;
const POMODORO_BREAK_SECONDS: u32 = 5 * 60;
const MODULES_FILE_NAME: &str = "modules.json";

pub fn load_configured_modules(config_dir: &Path) -> Vec<Module> {
    let mut modules = read_config_array(config_dir, MODULES_FILE_NAME, "modules")
        .iter()
        .filter_map(parse_module_from_value)
        .collect::<Vec<_>>();
    if modules.is_empty() {
        modules = default_modules_catalog();
    }
    modules
}

pub fn create_module(config_dir: &Path, payload: &serde_json::Value) -> Result<Module, InfraError> {
    let module = parse_module_payload(payload)?;
    let existing = load_configured_modules(config_dir);
    if existing.iter().any(|candidate| candidate.id == module.id) {
        return Err(InfraError::InvalidConfig(format!(
            "module already exists: {}",
            module.id
        )));
    }

    let mut document = read_modules_document(config_dir)?;
    let modules = modules_array_mut(&mut document)?;
    modules.push(module_to_json_value(&module));
    write_modules_document(config_dir, &document)?;
    Ok(module)
}

pub fn update_module(
    config_dir: &Path,
    module_id: &str,
    payload: &serde_json::Value,
) -> Result<Module, InfraError> {
    let module_id = module_id.trim();
    if module_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "module_id must not be empty".to_string(),
        ));
    }
    let module = parse_module_payload_with_id(payload, module_id)?;

    let mut document = read_modules_document(config_dir)?;
    let modules = modules_array_mut(&mut document)?;
    let mut updated = false;
    for existing in modules.iter_mut() {
        let existing_id = existing
            .as_object()
            .and_then(|object| object.get("id"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        if existing_id == module_id {
            *existing = module_to_json_value(&module);
            updated = true;
            break;
        }
    }
    if !updated {
        modules.push(module_to_json_value(&module));
    }

    write_modules_document(config_dir, &document)?;
    Ok(module)
}

pub fn delete_module(config_dir: &Path, module_id: &str) -> Result<bool, InfraError> {
    let module_id = module_id.trim();
    if module_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "module_id must not be empty".to_string(),
        ));
    }

    let mut document = read_modules_document(config_dir)?;
    let modules = modules_array_mut(&mut document)?;
    let before = modules.len();
    modules.retain(|entry| {
        let existing_id = entry
            .as_object()
            .and_then(|object| object.get("id"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        existing_id != module_id
    });
    let deleted = modules.len() != before;
    if deleted {
        write_modules_document(config_dir, &document)?;
    }
    Ok(deleted)
}

fn modules_config_path(config_dir: &Path) -> PathBuf {
    config_dir.join(MODULES_FILE_NAME)
}

fn read_modules_document(config_dir: &Path) -> Result<serde_json::Value, InfraError> {
    let path = modules_config_path(config_dir);
    if !path.exists() {
        return Ok(serde_json::json!({
            "schema": 1,
            "modules": default_modules_catalog()
                .iter()
                .map(module_to_json_value)
                .collect::<Vec<_>>(),
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

fn write_modules_document(
    config_dir: &Path,
    document: &serde_json::Value,
) -> Result<(), InfraError> {
    let path = modules_config_path(config_dir);
    let formatted = serde_json::to_string_pretty(document)?;
    fs::write(path, format!("{formatted}\n"))?;
    Ok(())
}

fn modules_array_mut(
    document: &mut serde_json::Value,
) -> Result<&mut Vec<serde_json::Value>, InfraError> {
    let object = document
        .as_object_mut()
        .ok_or_else(|| InfraError::InvalidConfig("modules document must be object".to_string()))?;
    object
        .entry("schema".to_string())
        .or_insert_with(|| serde_json::Value::from(1_u8));
    let modules_entry = object
        .entry("modules".to_string())
        .or_insert_with(|| serde_json::Value::Array(Vec::new()));
    modules_entry.as_array_mut().ok_or_else(|| {
        InfraError::InvalidConfig("modules must be an array in modules.json".to_string())
    })
}

fn parse_module_payload(payload: &serde_json::Value) -> Result<Module, InfraError> {
    parse_module_from_value(payload).ok_or_else(|| {
        InfraError::InvalidConfig("invalid module payload; check id/name/category/duration".to_string())
    })
}

fn parse_module_payload_with_id(
    payload: &serde_json::Value,
    module_id: &str,
) -> Result<Module, InfraError> {
    let mut object = payload
        .as_object()
        .cloned()
        .ok_or_else(|| InfraError::InvalidConfig("module payload must be object".to_string()))?;
    object.insert(
        "id".to_string(),
        serde_json::Value::String(module_id.to_string()),
    );
    parse_module_payload(&serde_json::Value::Object(object))
}

fn parse_module_from_value(raw: &serde_json::Value) -> Option<Module> {
    let object = raw.as_object()?;
    let id = value_by_keys(object, &["id"])
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let name = value_by_keys(object, &["name"])
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let category = value_by_keys(object, &["category"])
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("General")
        .to_string();
    let description = value_by_keys(object, &["description"])
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let icon = value_by_keys(object, &["icon"])
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let step_type = parse_recipe_step_type_value(value_by_keys(
        object,
        &["stepType", "step_type", "type"],
    ))
    .unwrap_or(RecipeStepType::Micro);
    let duration_minutes = value_by_keys(object, &["durationMinutes", "duration_minutes"])
        .and_then(parse_positive_u32_value)
        .unwrap_or(1);
    let checklist = value_by_keys(object, &["checklist"])
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
    let pomodoro = value_by_keys(object, &["pomodoro"])
        .and_then(serde_json::Value::as_object)
        .map(|pomodoro| ModulePomodoroConfig {
            focus_seconds: value_by_keys(pomodoro, &["focusSeconds", "focus_seconds"])
                .and_then(parse_positive_u32_value)
                .unwrap_or(POMODORO_FOCUS_SECONDS),
            break_seconds: value_by_keys(pomodoro, &["breakSeconds", "break_seconds"])
                .and_then(parse_positive_u32_value)
                .unwrap_or(POMODORO_BREAK_SECONDS),
            cycles: value_by_keys(pomodoro, &["cycles"])
                .and_then(parse_positive_u32_value)
                .unwrap_or(1),
            long_break_seconds: value_by_keys(pomodoro, &["longBreakSeconds", "long_break_seconds"])
                .and_then(parse_positive_u32_value),
            long_break_every: value_by_keys(pomodoro, &["longBreakEvery", "long_break_every"])
                .and_then(parse_positive_u32_value),
        });
    let overrun_policy =
        parse_overrun_policy_value(value_by_keys(object, &["overrunPolicy", "overrun_policy"]));
    let execution_hints = value_by_keys(object, &["executionHints", "execution_hints"])
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
    let module = Module {
        id,
        name,
        category,
        description,
        icon,
        step_type,
        duration_minutes,
        checklist,
        pomodoro,
        overrun_policy,
        execution_hints,
    };
    module.validate().ok()?;
    Some(module)
}

fn module_to_json_value(module: &Module) -> serde_json::Value {
    let mut object = serde_json::Map::new();
    object.insert("id".to_string(), serde_json::Value::String(module.id.clone()));
    object.insert(
        "name".to_string(),
        serde_json::Value::String(module.name.clone()),
    );
    object.insert(
        "category".to_string(),
        serde_json::Value::String(module.category.clone()),
    );
    if let Some(description) = &module.description {
        object.insert(
            "description".to_string(),
            serde_json::Value::String(description.clone()),
        );
    }
    if let Some(icon) = &module.icon {
        object.insert("icon".to_string(), serde_json::Value::String(icon.clone()));
    }
    object.insert(
        "stepType".to_string(),
        serde_json::Value::String(recipe_step_type_as_str(&module.step_type).to_string()),
    );
    object.insert(
        "durationMinutes".to_string(),
        serde_json::Value::from(module.duration_minutes),
    );
    object.insert(
        "checklist".to_string(),
        serde_json::Value::Array(
            module
                .checklist
                .iter()
                .map(|item| serde_json::Value::String(item.clone()))
                .collect::<Vec<_>>(),
        ),
    );
    if let Some(pomodoro) = &module.pomodoro {
        object.insert(
            "pomodoro".to_string(),
            serde_json::json!({
                "focusSeconds": pomodoro.focus_seconds,
                "breakSeconds": pomodoro.break_seconds,
                "cycles": pomodoro.cycles,
                "longBreakSeconds": pomodoro.long_break_seconds,
                "longBreakEvery": pomodoro.long_break_every,
            }),
        );
    }
    if let Some(overrun_policy) = &module.overrun_policy {
        object.insert(
            "overrunPolicy".to_string(),
            serde_json::Value::String(overrun_policy_as_str(overrun_policy).to_string()),
        );
    }
    if let Some(hints) = &module.execution_hints {
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
}

fn default_modules_catalog() -> Vec<Module> {
    vec![
        Module {
            id: "mod-deep-work-init".to_string(),
            name: "Deep Work Init".to_string(),
            category: "Focus Work".to_string(),
            description: Some("Environment prep".to_string()),
            icon: Some("spark".to_string()),
            step_type: RecipeStepType::Micro,
            duration_minutes: 5,
            checklist: vec![
                "Close distracting tabs".to_string(),
                "Set Slack to Away".to_string(),
                "Enable Do Not Disturb".to_string(),
            ],
            pomodoro: None,
            overrun_policy: Some(OverrunPolicy::Wait),
            execution_hints: Some(ExecutionHints {
                allow_skip: true,
                must_complete_checklist: false,
                auto_advance: true,
            }),
        },
        Module {
            id: "mod-pomodoro-focus".to_string(),
            name: "Pomodoro Focus".to_string(),
            category: "Focus Work".to_string(),
            description: Some("25m work block".to_string()),
            icon: Some("timer".to_string()),
            step_type: RecipeStepType::Pomodoro,
            duration_minutes: 25,
            checklist: vec![
                "Focus on one task only".to_string(),
                "No context switching".to_string(),
            ],
            pomodoro: Some(ModulePomodoroConfig {
                focus_seconds: 1500,
                break_seconds: 300,
                cycles: 1,
                long_break_seconds: Some(900),
                long_break_every: Some(4),
            }),
            overrun_policy: Some(OverrunPolicy::Wait),
            execution_hints: Some(ExecutionHints {
                allow_skip: true,
                must_complete_checklist: false,
                auto_advance: true,
            }),
        },
        Module {
            id: "mod-two-min-triage".to_string(),
            name: "2m Triage".to_string(),
            category: "Communication".to_string(),
            description: Some("Quick inbox sort".to_string()),
            icon: Some("mail".to_string()),
            step_type: RecipeStepType::Micro,
            duration_minutes: 2,
            checklist: vec![
                "Reply, archive, or defer".to_string(),
                "No deep replies".to_string(),
            ],
            pomodoro: None,
            overrun_policy: Some(OverrunPolicy::Wait),
            execution_hints: Some(ExecutionHints {
                allow_skip: true,
                must_complete_checklist: false,
                auto_advance: true,
            }),
        },
    ]
}

fn parse_recipe_step_type_value(value: Option<&serde_json::Value>) -> Option<RecipeStepType> {
    match value?.as_str()?.trim().to_ascii_lowercase().as_str() {
        "pomodoro" => Some(RecipeStepType::Pomodoro),
        "micro" => Some(RecipeStepType::Micro),
        "free" => Some(RecipeStepType::Free),
        _ => None,
    }
}

fn recipe_step_type_as_str(value: &RecipeStepType) -> &'static str {
    match value {
        RecipeStepType::Pomodoro => "pomodoro",
        RecipeStepType::Micro => "micro",
        RecipeStepType::Free => "free",
    }
}

fn parse_overrun_policy_value(value: Option<&serde_json::Value>) -> Option<OverrunPolicy> {
    match value?.as_str()?.trim().to_ascii_lowercase().as_str() {
        "notify_and_next" | "notify-and-next" => Some(OverrunPolicy::NotifyAndNext),
        "wait" => Some(OverrunPolicy::Wait),
        _ => None,
    }
}

fn overrun_policy_as_str(value: &OverrunPolicy) -> &'static str {
    match value {
        OverrunPolicy::NotifyAndNext => "notify_and_next",
        OverrunPolicy::Wait => "wait",
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
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_config_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir().join(format!("pomoblock-modules-{label}-{nanos}"))
    }

    #[test]
    fn module_crud_roundtrip_preserves_pomodoro_and_hints() {
        let config_dir = temp_config_dir("crud");
        fs::create_dir_all(&config_dir).expect("config dir");
        let created = create_module(
            &config_dir,
            &serde_json::json!({
                "id": "mod-test",
                "name": "Test Module",
                "category": "Focus",
                "durationMinutes": 15,
                "stepType": "pomodoro",
                "pomodoro": {
                    "focusSeconds": 900,
                    "breakSeconds": 180,
                    "cycles": 2
                },
                "executionHints": {
                    "allowSkip": true,
                    "mustCompleteChecklist": false,
                    "autoAdvance": true
                }
            }),
        )
        .expect("create module");
        let updated = update_module(
            &config_dir,
            "mod-test",
            &serde_json::json!({
                "name": "Test Module Updated",
                "category": "Focus",
                "durationMinutes": 20,
                "stepType": "micro",
                "checklist": ["A", "B"]
            }),
        )
        .expect("update module");
        let listed = load_configured_modules(&config_dir);
        let deleted = delete_module(&config_dir, "mod-test").expect("delete module");

        assert_eq!(created.id, "mod-test");
        assert_eq!(updated.name, "Test Module Updated");
        assert!(listed.iter().any(|module| module.id == "mod-test"));
        assert!(deleted);
    }

    #[test]
    fn load_configured_modules_falls_back_to_default_catalog() {
        let config_dir = temp_config_dir("defaults");
        fs::create_dir_all(&config_dir).expect("config dir");

        let modules = load_configured_modules(&config_dir);

        assert!(!modules.is_empty());
        assert!(modules.iter().any(|module| module.id == "mod-pomodoro-focus"));
    }
}
