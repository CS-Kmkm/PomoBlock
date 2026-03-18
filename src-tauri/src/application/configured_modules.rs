use crate::domain::models::{
    ExecutionHints, Module, ModuleFolder, ModulePomodoroConfig, OverrunPolicy, RecipeStepType,
};
use crate::infrastructure::error::InfraError;
use std::fs;
use std::path::{Path, PathBuf};

const POMODORO_FOCUS_SECONDS: u32 = 25 * 60;
const POMODORO_BREAK_SECONDS: u32 = 5 * 60;
const MODULES_FILE_NAME: &str = "modules.json";
const GENERAL_FOLDER_ID: &str = "General";
const GENERAL_FOLDER_NAME: &str = "General";

pub fn load_configured_modules(config_dir: &Path) -> Vec<Module> {
    let mut modules = read_modules_document(config_dir)
        .ok()
        .map(|document| parse_modules_from_document(&document))
        .unwrap_or_default();
    if modules.is_empty() {
        modules = default_modules_catalog();
    }
    modules
}

pub fn load_configured_module_folders(config_dir: &Path) -> Vec<ModuleFolder> {
    read_modules_document(config_dir)
        .ok()
        .map(|document| collect_document_folders(&document))
        .unwrap_or_else(|| synthesize_folders_from_modules(&default_modules_catalog()))
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
    ensure_document_folders(&mut document)?;
    let modules = modules_array_mut(&mut document)?;
    modules.push(module_to_json_value(&module));
    ensure_folder_for_category(&mut document, &module.category)?;
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
    ensure_document_folders(&mut document)?;
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

    ensure_folder_for_category(&mut document, &module.category)?;
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
    ensure_document_folders(&mut document)?;
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

pub fn create_module_folder(config_dir: &Path, name: &str) -> Result<ModuleFolder, InfraError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(InfraError::InvalidConfig(
            "folder name must not be empty".to_string(),
        ));
    }

    let mut document = read_modules_document(config_dir)?;
    ensure_document_folders(&mut document)?;
    let mut folders = collect_document_folders(&document);
    if folders
        .iter()
        .any(|folder| folder.id.eq_ignore_ascii_case(name) || folder.name.eq_ignore_ascii_case(name))
    {
        return Err(InfraError::InvalidConfig(format!(
            "folder already exists: {name}"
        )));
    }

    let folder = ModuleFolder {
        id: name.to_string(),
        name: name.to_string(),
    };
    folders.push(folder.clone());
    set_document_folders(&mut document, &folders)?;
    write_modules_document(config_dir, &document)?;
    Ok(folder)
}

pub fn delete_module_folder(config_dir: &Path, folder_id: &str) -> Result<bool, InfraError> {
    let folder_id = folder_id.trim();
    if folder_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "folder_id must not be empty".to_string(),
        ));
    }

    let mut document = read_modules_document(config_dir)?;
    ensure_document_folders(&mut document)?;
    let mut folders = collect_document_folders(&document);
    let before = folders.len();
    folders.retain(|folder| folder.id != folder_id);
    if folders.len() == before {
        return Ok(false);
    }

    let modules = modules_array_mut(&mut document)?;
    let affected_count = modules
        .iter()
        .filter(|entry| module_category_from_value(entry) == Some(folder_id))
        .count();
    if affected_count > 0 {
        let fallback_id = folders
            .first()
            .map(|folder| folder.id.clone())
            .unwrap_or_else(|| {
                let fallback = default_general_folder();
                folders.push(fallback.clone());
                fallback.id
            });
        for entry in modules.iter_mut() {
            if module_category_from_value(entry) == Some(folder_id) {
                set_module_category(entry, &fallback_id)?;
            }
        }
    }

    set_document_folders(&mut document, &folders)?;
    write_modules_document(config_dir, &document)?;
    Ok(true)
}

pub fn move_module_folder(
    config_dir: &Path,
    folder_id: &str,
    direction: &str,
) -> Result<Vec<ModuleFolder>, InfraError> {
    let folder_id = folder_id.trim();
    if folder_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "folder_id must not be empty".to_string(),
        ));
    }
    let direction = direction.trim().to_ascii_lowercase();
    if direction != "up" && direction != "down" {
        return Err(InfraError::InvalidConfig(format!(
            "unsupported folder move direction: {direction}"
        )));
    }

    let mut document = read_modules_document(config_dir)?;
    ensure_document_folders(&mut document)?;
    let mut folders = collect_document_folders(&document);
    let Some(index) = folders.iter().position(|folder| folder.id == folder_id) else {
        return Err(InfraError::InvalidConfig(format!(
            "folder not found: {folder_id}"
        )));
    };
    let next_index = if direction == "up" {
        index.saturating_sub(1)
    } else {
        std::cmp::min(index + 1, folders.len().saturating_sub(1))
    };
    if next_index != index {
        folders.swap(index, next_index);
        set_document_folders(&mut document, &folders)?;
        write_modules_document(config_dir, &document)?;
    }
    Ok(folders)
}

pub fn move_module(
    config_dir: &Path,
    module_id: &str,
    folder_id: &str,
    before_module_id: Option<&str>,
) -> Result<Vec<Module>, InfraError> {
    let module_id = module_id.trim();
    if module_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "module_id must not be empty".to_string(),
        ));
    }
    let folder_id = folder_id.trim();
    if folder_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "folder_id must not be empty".to_string(),
        ));
    }
    let before_module_id = before_module_id
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let mut document = read_modules_document(config_dir)?;
    ensure_document_folders(&mut document)?;
    ensure_folder_for_category(&mut document, folder_id)?;

    let folders = collect_document_folders(&document);
    let target_folder_index = folders
        .iter()
        .position(|folder| folder.id == folder_id)
        .ok_or_else(|| InfraError::InvalidConfig(format!("folder not found: {folder_id}")))?;

    let modules = modules_array_mut(&mut document)?;
    let source_index = modules
        .iter()
        .position(|entry| module_id_from_value(entry) == Some(module_id))
        .ok_or_else(|| InfraError::InvalidConfig(format!("module not found: {module_id}")))?;

    let mut moved_entry = modules.remove(source_index);
    set_module_category(&mut moved_entry, folder_id)?;

    let insert_index = if let Some(before_id) = before_module_id {
        let index = modules
            .iter()
            .position(|entry| module_id_from_value(entry) == Some(before_id))
            .ok_or_else(|| {
                InfraError::InvalidConfig(format!("before module not found: {before_id}"))
            })?;
        if module_category_from_value(&modules[index]) != Some(folder_id) {
            return Err(InfraError::InvalidConfig(format!(
                "before module {before_id} is not in folder {folder_id}"
            )));
        }
        index
    } else if let Some(index) = modules
        .iter()
        .enumerate()
        .rev()
        .find_map(|(index, entry)| (module_category_from_value(entry) == Some(folder_id)).then_some(index + 1))
    {
        index
    } else {
        modules
            .iter()
            .position(|entry| {
                module_category_from_value(entry)
                    .and_then(|category| folders.iter().position(|folder| folder.id == category))
                    .is_some_and(|index| index > target_folder_index)
            })
            .unwrap_or(modules.len())
    };

    modules.insert(insert_index, moved_entry);
    write_modules_document(config_dir, &document)?;
    Ok(parse_modules_from_document(&document))
}

fn modules_config_path(config_dir: &Path) -> PathBuf {
    config_dir.join(MODULES_FILE_NAME)
}

fn read_modules_document(config_dir: &Path) -> Result<serde_json::Value, InfraError> {
    let path = modules_config_path(config_dir);
    if !path.exists() {
        return Ok(default_modules_document());
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
    if parse_modules_from_document(&parsed).is_empty() {
        return seed_default_modules_document(&parsed);
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

fn default_modules_document() -> serde_json::Value {
    let modules = default_modules_catalog();
    let folders = synthesize_folders_from_modules(&modules);
    serde_json::json!({
        "schema": 1,
        "folders": folders.iter().map(folder_to_json_value).collect::<Vec<_>>(),
        "modules": modules.iter().map(module_to_json_value).collect::<Vec<_>>(),
    })
}

fn seed_default_modules_document(
    document: &serde_json::Value,
) -> Result<serde_json::Value, InfraError> {
    let mut seeded = default_modules_document();
    let mut folders = raw_document_folders(document);
    if !folders.is_empty() {
        append_missing_module_folders(&mut folders, &default_modules_catalog());
        set_document_folders(&mut seeded, &folders)?;
    }
    Ok(seeded)
}

fn parse_modules_from_document(document: &serde_json::Value) -> Vec<Module> {
    document
        .get("modules")
        .and_then(serde_json::Value::as_array)
        .map(|items| items.iter().filter_map(parse_module_from_value).collect::<Vec<_>>())
        .unwrap_or_default()
}

fn collect_document_folders(document: &serde_json::Value) -> Vec<ModuleFolder> {
    let modules = parse_modules_from_document(document);
    let mut folders = raw_document_folders(document);
    if folders.is_empty() {
        folders = synthesize_folders_from_modules(&modules);
    } else {
        append_missing_module_folders(&mut folders, &modules);
    }
    folders
}

fn raw_document_folders(document: &serde_json::Value) -> Vec<ModuleFolder> {
    document
        .get("folders")
        .and_then(serde_json::Value::as_array)
        .map(|items| items.iter().filter_map(parse_folder_from_value).collect::<Vec<_>>())
        .unwrap_or_default()
}

fn ensure_document_folders(document: &mut serde_json::Value) -> Result<(), InfraError> {
    let folders = collect_document_folders(document);
    set_document_folders(document, &folders)
}

fn set_document_folders(
    document: &mut serde_json::Value,
    folders: &[ModuleFolder],
) -> Result<(), InfraError> {
    let object = document
        .as_object_mut()
        .ok_or_else(|| InfraError::InvalidConfig("modules document must be object".to_string()))?;
    object
        .entry("schema".to_string())
        .or_insert_with(|| serde_json::Value::from(1_u8));
    object.insert(
        "folders".to_string(),
        serde_json::Value::Array(folders.iter().map(folder_to_json_value).collect::<Vec<_>>()),
    );
    Ok(())
}

fn ensure_folder_for_category(
    document: &mut serde_json::Value,
    category: &str,
) -> Result<(), InfraError> {
    let category = category.trim();
    if category.is_empty() {
        return Ok(());
    }
    let mut folders = collect_document_folders(document);
    if folders.iter().all(|folder| folder.id != category) {
        folders.push(ModuleFolder {
            id: category.to_string(),
            name: category.to_string(),
        });
        set_document_folders(document, &folders)?;
    }
    Ok(())
}

fn append_missing_module_folders(folders: &mut Vec<ModuleFolder>, modules: &[Module]) {
    for folder in synthesize_folders_from_modules(modules) {
        if folders.iter().all(|existing| existing.id != folder.id) {
            folders.push(folder);
        }
    }
}

fn synthesize_folders_from_modules(modules: &[Module]) -> Vec<ModuleFolder> {
    let mut folders = Vec::new();
    for module in modules {
        let category = module.category.trim();
        if category.is_empty() || folders.iter().any(|folder: &ModuleFolder| folder.id == category) {
            continue;
        }
        folders.push(ModuleFolder {
            id: category.to_string(),
            name: category.to_string(),
        });
    }
    folders
}

fn parse_folder_from_value(raw: &serde_json::Value) -> Option<ModuleFolder> {
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
        .unwrap_or(&id)
        .to_string();
    let folder = ModuleFolder { id, name };
    folder.validate().ok()?;
    Some(folder)
}

fn folder_to_json_value(folder: &ModuleFolder) -> serde_json::Value {
    serde_json::json!({
        "id": folder.id,
        "name": folder.name,
    })
}

fn default_general_folder() -> ModuleFolder {
    ModuleFolder {
        id: GENERAL_FOLDER_ID.to_string(),
        name: GENERAL_FOLDER_NAME.to_string(),
    }
}

fn module_category_from_value(value: &serde_json::Value) -> Option<&str> {
    value
        .as_object()
        .and_then(|object| value_by_keys(object, &["category"]))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn module_id_from_value(value: &serde_json::Value) -> Option<&str> {
    value
        .as_object()
        .and_then(|object| value_by_keys(object, &["id"]))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn set_module_category(value: &mut serde_json::Value, category: &str) -> Result<(), InfraError> {
    let object = value
        .as_object_mut()
        .ok_or_else(|| InfraError::InvalidConfig("module entry must be object".to_string()))?;
    object.insert(
        "category".to_string(),
        serde_json::Value::String(category.to_string()),
    );
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
    use std::fs;

    #[test]
    fn module_crud_roundtrip_preserves_pomodoro_and_hints() {
        let config_dir = TempConfigDir::new("modules", "crud");
        let created = create_module(
            config_dir.path(),
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
            config_dir.path(),
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
        let listed = load_configured_modules(config_dir.path());
        let deleted = delete_module(config_dir.path(), "mod-test").expect("delete module");

        assert_eq!(created.id, "mod-test");
        assert_eq!(updated.name, "Test Module Updated");
        assert!(listed.iter().any(|module| module.id == "mod-test"));
        assert!(
            load_configured_module_folders(config_dir.path())
                .iter()
                .any(|folder| folder.id == "Focus")
        );
        assert!(deleted);
    }

    #[test]
    fn load_configured_modules_falls_back_to_default_catalog() {
        let config_dir = TempConfigDir::new("modules", "defaults");

        let modules = load_configured_modules(config_dir.path());

        assert!(!modules.is_empty());
        assert!(modules.iter().any(|module| module.id == "mod-pomodoro-focus"));
        assert!(
            load_configured_module_folders(config_dir.path())
                .iter()
                .any(|folder| folder.id == "Focus Work")
        );
    }

    #[test]
    fn module_folder_crud_preserves_order_and_reassigns_deleted_modules() {
        let config_dir = TempConfigDir::new("modules", "folders");
        let created = create_module_folder(config_dir.path(), "Admin").expect("create folder");
        assert_eq!(created.id, "Admin");

        let moved = move_module_folder(config_dir.path(), "Admin", "up").expect("move folder");
        assert_eq!(
            moved.iter().position(|folder| folder.id == "Admin"),
            Some(1)
        );

        let updated = update_module(
            config_dir.path(),
            "mod-two-min-triage",
            &serde_json::json!({
                "name": "2m Triage",
                "category": "Admin",
                "description": "Quick inbox sort",
                "icon": "mail",
                "stepType": "micro",
                "durationMinutes": 2,
                "checklist": ["Reply, archive, or defer", "No deep replies"],
                "overrunPolicy": "wait",
                "executionHints": {
                    "allowSkip": true,
                    "mustCompleteChecklist": false,
                    "autoAdvance": true
                }
            }),
        )
        .expect("move module into folder");
        assert_eq!(updated.category, "Admin");

        let deleted = delete_module_folder(config_dir.path(), "Admin").expect("delete folder");
        assert!(deleted);

        let folders = load_configured_module_folders(config_dir.path());
        assert!(folders.iter().all(|folder| folder.id != "Admin"));

        let modules = load_configured_modules(config_dir.path());
        let triage = modules
            .iter()
            .find(|module| module.id == "mod-two-min-triage")
            .expect("triage module");
        assert_ne!(triage.category, "Admin");
    }

    #[test]
    fn load_configured_module_folders_supports_legacy_category_only_documents() {
        let config_dir = TempConfigDir::new("modules", "legacy-folders");
        let path = modules_config_path(config_dir.path());
        fs::write(
            path,
            r#"{
  "schema": 1,
  "modules": [
    {
      "id": "mod-legacy-a",
      "name": "Legacy A",
      "category": "Communication",
      "durationMinutes": 5,
      "stepType": "micro"
    },
    {
      "id": "mod-legacy-b",
      "name": "Legacy B",
      "category": "Focus Work",
      "durationMinutes": 15,
      "stepType": "micro"
    }
  ]
}
"#,
        )
        .expect("write legacy modules json");

        let folders = load_configured_module_folders(config_dir.path());

        assert_eq!(
            folders.iter().map(|folder| folder.id.as_str()).collect::<Vec<_>>(),
            vec!["Communication", "Focus Work"]
        );
    }

    #[test]
    fn empty_modules_document_is_seeded_for_moves() {
        let config_dir = TempConfigDir::new("modules", "empty-doc-move");
        let path = modules_config_path(config_dir.path());
        fs::write(
            &path,
            r#"{
  "schema": 1,
  "folders": [],
  "modules": []
}
"#,
        )
        .expect("write empty modules json");

        let modules = load_configured_modules(config_dir.path());
        assert!(modules.iter().any(|module| module.id == "mod-pomodoro-focus"));

        let folders = load_configured_module_folders(config_dir.path());
        assert!(folders.iter().any(|folder| folder.id == "Focus Work"));

        let moved = move_module(
            config_dir.path(),
            "mod-pomodoro-focus",
            "Communication",
            None,
        )
        .expect("move seeded module from empty doc");

        let moved_module = moved
            .iter()
            .find(|module| module.id == "mod-pomodoro-focus")
            .expect("moved module");
        assert_eq!(moved_module.category, "Communication");

        let persisted = fs::read_to_string(path).expect("read persisted modules json");
        assert!(persisted.contains("\"mod-pomodoro-focus\""));
        assert!(persisted.contains("\"Communication\""));
    }
}
