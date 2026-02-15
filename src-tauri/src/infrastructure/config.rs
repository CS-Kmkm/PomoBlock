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
