use crate::infrastructure::error::InfraError;
use std::borrow::ToOwned;
use std::fs;
use std::path::Path;

const ROUTINES_FILE_NAME: &str = "routines.json";
const ROUTINES_SCHEMA_VERSION: u8 = 1;

fn default_routines_document() -> serde_json::Value {
    serde_json::json!({
        "schema": ROUTINES_SCHEMA_VERSION,
        "routines": [],
    })
}

fn read_routines_document(config_dir: &Path) -> Result<serde_json::Value, InfraError> {
    let path = config_dir.join(ROUTINES_FILE_NAME);
    if !path.exists() {
        return Ok(default_routines_document());
    }
    let raw = fs::read_to_string(&path)?;
    let parsed: serde_json::Value = serde_json::from_str(&raw)?;
    let schema = parsed
        .get("schema")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| InfraError::InvalidConfig(format!("missing schema in {}", path.display())))?;
    if schema != u64::from(ROUTINES_SCHEMA_VERSION) {
        return Err(InfraError::InvalidConfig(format!(
            "unsupported schema {} in {}",
            schema,
            path.display()
        )));
    }
    Ok(parsed)
}

fn routines_array_mut(document: &mut serde_json::Value) -> Result<&mut Vec<serde_json::Value>, InfraError> {
    let object = document.as_object_mut().ok_or_else(|| {
        InfraError::InvalidConfig("routines document must be an object".to_string())
    })?;
    let routines = object
        .entry("routines")
        .or_insert_with(|| serde_json::json!([]));
    routines.as_array_mut().ok_or_else(|| {
        InfraError::InvalidConfig("routines document must contain an array".to_string())
    })
}

fn routines_array(document: &serde_json::Value) -> Vec<serde_json::Value> {
    document
        .get("routines")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn routines_array_from_payload(payload: &serde_json::Value) -> Vec<serde_json::Value> {
    payload
        .get("routines")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .or_else(|| {
            payload
                .get("payload")
                .and_then(serde_json::Value::as_object)
                .and_then(|nested| nested.get("routines"))
                .and_then(serde_json::Value::as_array)
                .cloned()
        })
        .unwrap_or_default()
}

fn write_routines_document(config_dir: &Path, document: &serde_json::Value) -> Result<(), InfraError> {
    let path = config_dir.join(ROUTINES_FILE_NAME);
    let formatted = serde_json::to_string_pretty(document)?;
    fs::write(path, format!("{formatted}\n"))?;
    Ok(())
}

fn routine_id_from_value(value: &serde_json::Value) -> Option<String> {
    let object = value.as_object()?;
    object
        .get("id")
        .or_else(|| object.get("routineId"))
        .or_else(|| object.get("routine_id"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn normalize_routine_payload(payload: &serde_json::Value) -> Result<serde_json::Map<String, serde_json::Value>, InfraError> {
    let object = payload
        .as_object()
        .cloned()
        .ok_or_else(|| InfraError::InvalidConfig("routine payload must be object".to_string()))?;
    let id = object
        .get("id")
        .or_else(|| object.get("routineId"))
        .or_else(|| object.get("routine_id"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| InfraError::InvalidConfig("routine id is required".to_string()))?;
    let mut normalized = object;
    normalized.insert("id".to_string(), serde_json::Value::String(id));
    Ok(normalized)
}

pub fn load_configured_routines(config_dir: &Path) -> Vec<serde_json::Value> {
    read_routines_document(config_dir)
        .ok()
        .map(|document| routines_array(&document))
        .unwrap_or_default()
}

pub fn save_routine_schedule_group(
    config_dir: &Path,
    payload: &serde_json::Value,
) -> Result<Vec<serde_json::Value>, InfraError> {
    let routines = routines_array_from_payload(payload);
    let group_id = payload
        .get("group_id")
        .or_else(|| payload.get("groupId"))
        .or_else(|| {
            payload
                .get("payload")
                .and_then(serde_json::Value::as_object)
                .and_then(|nested| nested.get("group_id").or_else(|| nested.get("groupId")))
        })
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let mut document = read_routines_document(config_dir)?;
    let routines_array = routines_array_mut(&mut document)?;
    if let Some(group_id) = group_id.as_deref() {
        routines_array.retain(|entry| {
            entry
                .as_object()
                .and_then(|object| {
                    object
                        .get("scheduleGroupId")
                        .or_else(|| object.get("schedule_group_id"))
                        .and_then(serde_json::Value::as_str)
                })
                .map(|value| value.trim() != group_id)
                .unwrap_or(true)
        });
    }

    let mut saved = Vec::with_capacity(routines.len());
    for routine in routines {
        let mut normalized = normalize_routine_payload(&routine)?;
        if let Some(group_id) = group_id.as_deref() {
            normalized
                .entry("scheduleGroupId".to_string())
                .or_insert_with(|| serde_json::Value::String(group_id.to_string()));
        }
        let routine_value = serde_json::Value::Object(normalized);
        if let Some(existing) = routines_array
            .iter_mut()
            .find(|entry| routine_id_from_value(entry) == routine_id_from_value(&routine_value))
        {
            *existing = routine_value.clone();
        } else {
            routines_array.push(routine_value.clone());
        }
        saved.push(routine_value);
    }
    write_routines_document(config_dir, &document)?;
    Ok(saved)
}

pub fn save_routine_schedule(
    config_dir: &Path,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, InfraError> {
    let normalized = normalize_routine_payload(payload)?;
    let routine_id = normalized
        .get("id")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();
    let routine_value = serde_json::Value::Object(normalized);

    let mut document = read_routines_document(config_dir)?;
    let routines = routines_array_mut(&mut document)?;
    let mut updated = false;
    for entry in routines.iter_mut() {
        if routine_id_from_value(entry) == Some(routine_id.clone()) {
            *entry = routine_value.clone();
            updated = true;
            break;
        }
    }
    if !updated {
        routines.push(routine_value.clone());
    }
    write_routines_document(config_dir, &document)?;
    Ok(routine_value)
}

pub fn delete_routine_schedule(config_dir: &Path, routine_id: &str) -> Result<bool, InfraError> {
    let routine_id = routine_id.trim();
    if routine_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "routine_id must not be empty".to_string(),
        ));
    }

    let mut document = read_routines_document(config_dir)?;
    let routines = routines_array_mut(&mut document)?;
    let before = routines.len();
    routines.retain(|entry| routine_id_from_value(entry).as_deref() != Some(routine_id));
    let deleted = routines.len() != before;
    if deleted {
        write_routines_document(config_dir, &document)?;
    }
    Ok(deleted)
}
