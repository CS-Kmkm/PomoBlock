use crate::infrastructure::error::InfraError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

const APP_JSON: &str = "app.json";
const CALENDARS_JSON: &str = "calendars.json";
const POLICIES_JSON: &str = "policies.json";
const TEMPLATES_JSON: &str = "templates.json";
const ROUTINES_JSON: &str = "routines.json";
const OVERRIDES_JSON: &str = "overrides.json";
const DEFAULT_ACCOUNT_ID: &str = "default";

#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigFile {
    pub schema: u8,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigBundle {
    pub app: serde_json::Value,
    pub calendars: serde_json::Value,
    pub policies: serde_json::Value,
    pub templates: serde_json::Value,
    pub routines: serde_json::Value,
    pub overrides: serde_json::Value,
}

fn default_files() -> HashMap<&'static str, serde_json::Value> {
    HashMap::from([
        (
            APP_JSON,
            serde_json::json!({
                "schema": 1,
                "appName": "PomBlock",
                "timezone": "UTC",
                "blocksCalendarName": "Blocks"
            }),
        ),
        (
            CALENDARS_JSON,
            serde_json::json!({
                "schema": 1,
                "blocksCalendarId": null,
                "busyCalendarIds": ["primary"]
            }),
        ),
        (
            POLICIES_JSON,
            serde_json::json!({
                "schema": 1,
                "workHours": {
                    "start": "09:00",
                    "end": "18:00",
                    "days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
                },
                "generation": {
                    "autoEnabled": true,
                    "autoTime": "05:30",
                    "catchUpOnAppStart": true,
                    "placementStrategy": "keep",
                    "maxShiftMinutes": 120,
                    "createIfNoSlot": false,
                    "respectSuppression": true
                },
                "blockDurationMinutes": 50,
                "breakDurationMinutes": 10,
                "minBlockGapMinutes": 5
            }),
        ),
        (
            TEMPLATES_JSON,
            serde_json::json!({
                "schema": 1,
                "templates": []
            }),
        ),
        (
            ROUTINES_JSON,
            serde_json::json!({
                "schema": 1,
                "routines": []
            }),
        ),
        (
            OVERRIDES_JSON,
            serde_json::json!({
                "schema": 1,
                "mode": "none",
                "value": {}
            }),
        ),
    ])
}

pub fn ensure_default_configs(config_dir: &Path) -> Result<(), InfraError> {
    for (name, value) in default_files() {
        let path = config_dir.join(name);
        if !path.exists() {
            let formatted = serde_json::to_string_pretty(&value)?;
            fs::write(path, format!("{formatted}\n"))?;
        }
    }
    Ok(())
}

fn read_config(path: &Path) -> Result<serde_json::Value, InfraError> {
    let raw = fs::read_to_string(path)?;
    let parsed: serde_json::Value = serde_json::from_str(&raw)?;
    let schema = parsed
        .get("schema")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| InfraError::InvalidConfig(format!("missing schema in {}", path.display())))?;
    if schema != 1 {
        return Err(InfraError::InvalidConfig(format!(
            "unsupported schema {} in {}",
            schema,
            path.display()
        )));
    }
    Ok(parsed)
}

pub fn load_configs(config_dir: &Path) -> Result<ConfigBundle, InfraError> {
    Ok(ConfigBundle {
        app: read_config(&config_dir.join(APP_JSON))?,
        calendars: read_config(&config_dir.join(CALENDARS_JSON))?,
        policies: read_config(&config_dir.join(POLICIES_JSON))?,
        templates: read_config(&config_dir.join(TEMPLATES_JSON))?,
        routines: read_config(&config_dir.join(ROUTINES_JSON))?,
        overrides: read_config(&config_dir.join(OVERRIDES_JSON))?,
    })
}

fn normalize_account_id(account_id: &str) -> String {
    let normalized = account_id.trim();
    if normalized.is_empty() {
        DEFAULT_ACCOUNT_ID.to_string()
    } else {
        normalized.to_string()
    }
}

pub fn read_blocks_calendar_id(config_dir: &Path, account_id: &str) -> Result<Option<String>, InfraError> {
    let account_id = normalize_account_id(account_id);
    let calendars = read_config(&config_dir.join(CALENDARS_JSON))?;
    if let Some(calendar_id) = calendars
        .get("blocksCalendarIds")
        .and_then(serde_json::Value::as_object)
        .and_then(|ids| ids.get(&account_id))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(Some(calendar_id.to_string()));
    }
    if account_id != DEFAULT_ACCOUNT_ID {
        return Ok(None);
    }
    Ok(calendars
        .get("blocksCalendarId")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned))
}

pub fn read_blocks_calendar_name(config_dir: &Path) -> Result<String, InfraError> {
    let app = read_config(&config_dir.join(APP_JSON))?;
    let name = app
        .get("blocksCalendarName")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Blocks");
    Ok(name.to_string())
}

pub fn read_timezone(config_dir: &Path) -> Result<Option<String>, InfraError> {
    let app = read_config(&config_dir.join(APP_JSON))?;
    Ok(app
        .get("timezone")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned))
}

pub fn save_blocks_calendar_id(
    config_dir: &Path,
    account_id: &str,
    calendar_id: &str,
) -> Result<(), InfraError> {
    let account_id = normalize_account_id(account_id);
    let calendar_id = calendar_id.trim();
    if calendar_id.is_empty() {
        return Err(InfraError::InvalidConfig(
            "blocksCalendarId must not be empty".to_string(),
        ));
    }

    let path = config_dir.join(CALENDARS_JSON);
    let mut calendars = read_config(&path)?;
    let object = calendars.as_object_mut().ok_or_else(|| {
        InfraError::InvalidConfig(format!("invalid object structure in {}", path.display()))
    })?;
    let blocks_calendar_ids = object
        .entry("blocksCalendarIds")
        .or_insert_with(|| serde_json::json!({}));
    let ids_object = blocks_calendar_ids.as_object_mut().ok_or_else(|| {
        InfraError::InvalidConfig(format!(
            "invalid blocksCalendarIds object structure in {}",
            path.display()
        ))
    })?;
    ids_object.insert(
        account_id.clone(),
        serde_json::Value::String(calendar_id.to_string()),
    );
    if account_id == DEFAULT_ACCOUNT_ID {
        object.insert(
            "blocksCalendarId".to_string(),
            serde_json::Value::String(calendar_id.to_string()),
        );
    }

    let formatted = serde_json::to_string_pretty(&calendars)?;
    fs::write(path, format!("{formatted}\n"))?;
    Ok(())
}
