use crate::domain::models::{Block, BlockType, Firmness};
use crate::infrastructure::error::InfraError;
use chrono::{DateTime, Utc};
use std::collections::HashMap;

const KEY_BLOCK_ID: &str = "bs_block_id";
const KEY_INSTANCE: &str = "bs_instance";
const KEY_DATE: &str = "bs_date";
const KEY_BLOCK_TYPE: &str = "bs_block_type";
const KEY_FIRMNESS: &str = "bs_firmness";
const KEY_SOURCE: &str = "bs_source";
const KEY_SOURCE_ID: &str = "bs_source_id";
const KEY_PLANNED_POMODOROS: &str = "bs_planned_pomodoros";

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
        KEY_BLOCK_TYPE.to_string(),
        block_type_to_string(&block.block_type).to_string(),
    );
    private.insert(
        KEY_FIRMNESS.to_string(),
        firmness_to_string(&block.firmness).to_string(),
    );
    private.insert(KEY_SOURCE.to_string(), block.source.clone());
    private.insert(
        KEY_PLANNED_POMODOROS.to_string(),
        block.planned_pomodoros.to_string(),
    );
    if let Some(source_id) = block.source_id.as_deref().map(str::trim).filter(|id| !id.is_empty())
    {
        private.insert(KEY_SOURCE_ID.to_string(), source_id.to_string());
    }

    GoogleCalendarEvent {
        id: None,
        summary: Some("[PomBlock] Work Block".to_string()),
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

pub fn decode_block_event(event: &GoogleCalendarEvent) -> Result<Option<Block>, InfraError> {
    let Some(private) = event
        .extended_properties
        .as_ref()
        .map(|properties| &properties.private)
    else {
        return Ok(None);
    };

    let Some(instance) = private.get(KEY_INSTANCE).map(|value| value.trim().to_string()) else {
        return Ok(None);
    };
    if instance.is_empty() {
        return Ok(None);
    }

    let start_at = parse_rfc3339_utc(&event.start.date_time, "start.dateTime")?;
    let end_at = parse_rfc3339_utc(&event.end.date_time, "end.dateTime")?;
    if end_at <= start_at {
        return Err(InfraError::OAuth(
            "invalid block event: end is not after start".to_string(),
        ));
    }

    let block_id = private
        .get(KEY_BLOCK_ID)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| event.id.as_deref().map(str::trim).map(ToOwned::to_owned))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| instance.clone());

    let date = private
        .get(KEY_DATE)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| start_at.date_naive().to_string());

    let block_type = private
        .get(KEY_BLOCK_TYPE)
        .map(String::as_str)
        .map(parse_block_type)
        .transpose()?
        .unwrap_or(BlockType::Deep);

    let firmness = private
        .get(KEY_FIRMNESS)
        .map(String::as_str)
        .map(parse_firmness)
        .transpose()?
        .unwrap_or(Firmness::Draft);

    let planned_pomodoros = private
        .get(KEY_PLANNED_POMODOROS)
        .map(String::as_str)
        .map(parse_positive_i32)
        .transpose()?
        .unwrap_or(1);

    let source = private
        .get(KEY_SOURCE)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "calendar".to_string());

    let source_id = private
        .get(KEY_SOURCE_ID)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    Ok(Some(Block {
        id: block_id,
        instance,
        date,
        start_at,
        end_at,
        block_type,
        firmness,
        planned_pomodoros,
        source,
        source_id,
    }))
}

fn parse_rfc3339_utc(value: &str, field_name: &str) -> Result<DateTime<Utc>, InfraError> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| {
            InfraError::OAuth(format!(
                "invalid calendar event {field_name} '{value}': {error}"
            ))
        })
}

fn parse_block_type(value: &str) -> Result<BlockType, InfraError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "deep" => Ok(BlockType::Deep),
        "shallow" => Ok(BlockType::Shallow),
        "admin" => Ok(BlockType::Admin),
        "learning" => Ok(BlockType::Learning),
        other => Err(InfraError::OAuth(format!(
            "invalid bs_block_type value: {other}"
        ))),
    }
}

fn parse_firmness(value: &str) -> Result<Firmness, InfraError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "draft" => Ok(Firmness::Draft),
        "soft" => Ok(Firmness::Soft),
        "hard" => Ok(Firmness::Hard),
        other => Err(InfraError::OAuth(format!("invalid bs_firmness value: {other}"))),
    }
}

fn parse_positive_i32(value: &str) -> Result<i32, InfraError> {
    let parsed = value
        .trim()
        .parse::<i32>()
        .map_err(|error| InfraError::OAuth(format!("invalid integer value '{value}': {error}")))?;
    if parsed <= 0 {
        return Err(InfraError::OAuth(format!(
            "invalid integer value '{value}': expected positive number"
        )));
    }
    Ok(parsed)
}

fn block_type_to_string(value: &BlockType) -> &'static str {
    match value {
        BlockType::Deep => "deep",
        BlockType::Shallow => "shallow",
        BlockType::Admin => "admin",
        BlockType::Learning => "learning",
    }
}

fn firmness_to_string(value: &Firmness) -> &'static str {
    match value {
        Firmness::Draft => "draft",
        Firmness::Soft => "soft",
        Firmness::Hard => "hard",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
            block_type: BlockType::Deep,
            firmness: Firmness::Draft,
            planned_pomodoros: 2,
            source: "routine".to_string(),
            source_id: Some("routine-abc".to_string()),
        }
    }

    #[test]
    fn encode_and_decode_roundtrip_preserves_bs_instance() {
        let block = sample_block();
        let encoded = encode_block_event(&block);
        let decoded = decode_block_event(&encoded)
            .expect("decode should succeed")
            .expect("managed event");

        assert_eq!(decoded.instance, block.instance);
        assert_eq!(decoded.id, block.id);
        assert_eq!(decoded.date, block.date);
        assert_eq!(decoded.start_at, block.start_at);
        assert_eq!(decoded.end_at, block.end_at);
        assert_eq!(decoded.block_type, block.block_type);
        assert_eq!(decoded.firmness, block.firmness);
        assert_eq!(decoded.planned_pomodoros, block.planned_pomodoros);
        assert_eq!(decoded.source, block.source);
        assert_eq!(decoded.source_id, block.source_id);
    }

    #[test]
    fn decode_ignores_non_managed_events_without_bs_instance() {
        let event = GoogleCalendarEvent {
            id: Some("external-event".to_string()),
            summary: Some("Meeting".to_string()),
            description: None,
            status: Some("confirmed".to_string()),
            updated: None,
            etag: None,
            start: CalendarEventDateTime {
                date_time: "2026-02-16T00:00:00Z".to_string(),
                time_zone: None,
            },
            end: CalendarEventDateTime {
                date_time: "2026-02-16T01:00:00Z".to_string(),
                time_zone: None,
            },
            extended_properties: Some(CalendarEventExtendedProperties::default()),
        };

        let decoded = decode_block_event(&event).expect("decode should not fail");
        assert!(decoded.is_none());
    }

    #[test]
    fn decode_returns_error_when_datetime_is_invalid() {
        let mut event = encode_block_event(&sample_block());
        event.start.date_time = "invalid-timestamp".to_string();

        let result = decode_block_event(&event);
        assert!(result.is_err());
    }
}
