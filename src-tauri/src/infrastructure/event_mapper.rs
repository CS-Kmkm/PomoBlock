use crate::domain::models::{AutoDriveMode, Block, Firmness};
use std::collections::HashMap;

const KEY_BLOCK_ID: &str = "bs_block_id";
const KEY_INSTANCE: &str = "bs_instance";
const KEY_DATE: &str = "bs_date";
const KEY_FIRMNESS: &str = "bs_firmness";
const KEY_SOURCE: &str = "bs_source";
const KEY_SOURCE_ID: &str = "bs_source_id";
const KEY_PLANNED_POMODOROS: &str = "bs_planned_pomodoros";
const KEY_RECIPE_ID: &str = "bs_recipe_id";
const KEY_AUTO_DRIVE_MODE: &str = "bs_auto_drive_mode";
const KEY_VERSION: &str = "bs_v";
const KEY_APP: &str = "bs_app";
const KEY_KIND: &str = "bs_kind";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct CalendarEventDateTime {
    #[serde(rename = "dateTime")]
    pub date_time: String,
    #[serde(rename = "timeZone", skip_serializing_if = "Option::is_none")]
    pub time_zone: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub struct CalendarEventExtendedProperties {
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub private: HashMap<String, String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct GoogleCalendarEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    pub start: CalendarEventDateTime,
    pub end: CalendarEventDateTime,
    #[serde(rename = "extendedProperties", skip_serializing_if = "Option::is_none")]
    pub extended_properties: Option<CalendarEventExtendedProperties>,
}

pub fn encode_block_event(block: &Block) -> GoogleCalendarEvent {
    let mut private = HashMap::new();
    private.insert(KEY_BLOCK_ID.to_string(), block.id.clone());
    private.insert(KEY_INSTANCE.to_string(), block.instance.clone());
    private.insert(KEY_DATE.to_string(), block.date.clone());
    private.insert(
        KEY_FIRMNESS.to_string(),
        firmness_to_string(&block.firmness).to_string(),
    );
    private.insert(KEY_SOURCE.to_string(), block.source.clone());
    private.insert(
        KEY_PLANNED_POMODOROS.to_string(),
        block.planned_pomodoros.to_string(),
    );
    private.insert(KEY_RECIPE_ID.to_string(), block.recipe_id.clone());
    private.insert(
        KEY_AUTO_DRIVE_MODE.to_string(),
        auto_drive_mode_to_string(&block.auto_drive_mode).to_string(),
    );
    private.insert(KEY_VERSION.to_string(), "1".to_string());
    private.insert(KEY_APP.to_string(), "blocksched".to_string());
    private.insert(KEY_KIND.to_string(), "block".to_string());
    if let Some(source_id) = block.source_id.as_deref().map(str::trim).filter(|id| !id.is_empty())
    {
        private.insert(KEY_SOURCE_ID.to_string(), source_id.to_string());
    }

    GoogleCalendarEvent {
        id: None,
        summary: Some("[PomoBlock] Work Block".to_string()),
        description: Some(format!(
            "instance: {}, firmness: {}",
            block.instance,
            firmness_to_string(&block.firmness)
        )),
        status: Some("confirmed".to_string()),
        updated: None,
        etag: None,
        start: CalendarEventDateTime {
            date_time: block.start_at.to_rfc3339(),
            time_zone: None,
        },
        end: CalendarEventDateTime {
            date_time: block.end_at.to_rfc3339(),
            time_zone: None,
        },
        extended_properties: Some(CalendarEventExtendedProperties { private }),
    }
}

fn firmness_to_string(value: &Firmness) -> &'static str {
    match value {
        Firmness::Draft => "draft",
        Firmness::Soft => "soft",
        Firmness::Hard => "hard",
    }
}

fn auto_drive_mode_to_string(value: &AutoDriveMode) -> &'static str {
    match value {
        AutoDriveMode::Manual => "manual",
        AutoDriveMode::Auto => "auto",
        AutoDriveMode::AutoSilent => "auto-silent",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::models::BlockContents;
    use chrono::{DateTime, Utc};

    fn sample_block() -> Block {
        Block {
            id: "block-001".to_string(),
            instance: "routine:daily#2026-02-16".to_string(),
            date: "2026-02-16".to_string(),
            start_at: DateTime::parse_from_rfc3339("2026-02-16T00:00:00Z")
                .expect("valid datetime")
                .with_timezone(&Utc),
            end_at: DateTime::parse_from_rfc3339("2026-02-16T01:00:00Z")
                .expect("valid datetime")
                .with_timezone(&Utc),
            firmness: Firmness::Draft,
            planned_pomodoros: 2,
            source: "routine".to_string(),
            source_id: Some("routine-abc".to_string()),
            recipe_id: "rcp-deep-default".to_string(),
            auto_drive_mode: AutoDriveMode::Manual,
            contents: BlockContents::default(),
        }
    }

    #[test]
    fn encode_preserves_managed_block_metadata() {
        let block = sample_block();
        let encoded = encode_block_event(&block);
        let private = encoded
            .extended_properties
            .expect("extended properties")
            .private;

        assert_eq!(private.get(KEY_INSTANCE).map(String::as_str), Some(block.instance.as_str()));
        assert_eq!(private.get(KEY_BLOCK_ID).map(String::as_str), Some(block.id.as_str()));
        assert_eq!(private.get(KEY_DATE).map(String::as_str), Some(block.date.as_str()));
        assert_eq!(private.get(KEY_FIRMNESS).map(String::as_str), Some("draft"));
        assert_eq!(
            private.get(KEY_PLANNED_POMODOROS).map(String::as_str),
            Some("2")
        );
        assert_eq!(private.get(KEY_SOURCE).map(String::as_str), Some(block.source.as_str()));
        assert_eq!(
            private.get(KEY_SOURCE_ID).map(String::as_str),
            block.source_id.as_deref()
        );
        assert_eq!(private.get(KEY_RECIPE_ID).map(String::as_str), Some(block.recipe_id.as_str()));
        assert_eq!(private.get(KEY_AUTO_DRIVE_MODE).map(String::as_str), Some("manual"));
    }

    #[test]
    fn encode_includes_managed_metadata_keys() {
        let encoded = encode_block_event(&sample_block());
        let private = encoded
            .extended_properties
            .expect("extended properties")
            .private;

        assert_eq!(private.get(KEY_VERSION).map(String::as_str), Some("1"));
        assert_eq!(private.get(KEY_APP).map(String::as_str), Some("blocksched"));
        assert_eq!(private.get(KEY_KIND).map(String::as_str), Some("block"));
    }
}
