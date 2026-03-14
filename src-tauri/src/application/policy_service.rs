use crate::infrastructure::config::read_timezone;
use chrono::{NaiveTime, Weekday};
use chrono_tz::Tz;
use std::collections::HashSet;
use std::fs;
use std::path::Path;

const DEFAULT_MAX_AUTO_BLOCKS_PER_DAY: u32 = 24;
const DEFAULT_MAX_RELOCATIONS_PER_SYNC: u32 = 50;

#[derive(Debug, Clone)]
pub struct RuntimePolicy {
    pub work_start: NaiveTime,
    pub work_end: NaiveTime,
    pub work_days: HashSet<Weekday>,
    pub timezone: Tz,
    pub auto_enabled: bool,
    pub catch_up_on_app_start: bool,
    pub block_duration_minutes: u32,
    pub break_duration_minutes: u32,
    pub min_block_gap_minutes: u32,
    pub max_auto_blocks_per_day: u32,
    pub max_relocations_per_sync: u32,
    pub respect_suppression: bool,
}

impl Default for RuntimePolicy {
    fn default() -> Self {
        Self {
            work_start: NaiveTime::from_hms_opt(9, 0, 0).expect("valid fixed time"),
            work_end: NaiveTime::from_hms_opt(18, 0, 0).expect("valid fixed time"),
            work_days: HashSet::from([
                Weekday::Mon,
                Weekday::Tue,
                Weekday::Wed,
                Weekday::Thu,
                Weekday::Fri,
            ]),
            timezone: Tz::UTC,
            auto_enabled: true,
            catch_up_on_app_start: true,
            block_duration_minutes: 60,
            break_duration_minutes: 5,
            min_block_gap_minutes: 0,
            max_auto_blocks_per_day: DEFAULT_MAX_AUTO_BLOCKS_PER_DAY,
            max_relocations_per_sync: DEFAULT_MAX_RELOCATIONS_PER_SYNC,
            respect_suppression: true,
        }
    }
}

pub fn load_runtime_policy(config_dir: &Path) -> RuntimePolicy {
    let mut policy = RuntimePolicy::default();
    if let Ok(Some(timezone)) = read_timezone(config_dir) {
        if let Ok(parsed_timezone) = timezone.parse::<Tz>() {
            policy.timezone = parsed_timezone;
        }
    }
    let path = config_dir.join("policies.json");
    let Ok(raw) = fs::read_to_string(path) else {
        return policy;
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return policy;
    };

    if let Some(work_hours) = parsed.get("workHours") {
        if let Some(start) = work_hours.get("start").and_then(serde_json::Value::as_str) {
            if let Ok(parsed_start) = NaiveTime::parse_from_str(start.trim(), "%H:%M") {
                policy.work_start = parsed_start;
            }
        }
        if let Some(end) = work_hours.get("end").and_then(serde_json::Value::as_str) {
            if let Ok(parsed_end) = NaiveTime::parse_from_str(end.trim(), "%H:%M") {
                policy.work_end = parsed_end;
            }
        }
        if let Some(days) = work_hours.get("days").and_then(serde_json::Value::as_array) {
            let parsed_days = days
                .iter()
                .filter_map(serde_json::Value::as_str)
                .filter_map(parse_weekday)
                .collect::<HashSet<_>>();
            if !parsed_days.is_empty() {
                policy.work_days = parsed_days;
            }
        }
    }

    if let Some(value) = parsed
        .get("blockDurationMinutes")
        .and_then(serde_json::Value::as_u64)
    {
        policy.block_duration_minutes = value.max(1) as u32;
    }
    if let Some(value) = parsed
        .get("breakDurationMinutes")
        .and_then(serde_json::Value::as_u64)
    {
        policy.break_duration_minutes = value.max(1) as u32;
    }
    if let Some(value) = parsed
        .get("minBlockGapMinutes")
        .and_then(serde_json::Value::as_u64)
    {
        policy.min_block_gap_minutes = value as u32;
    }
    if let Some(value) = parsed
        .get("generation")
        .and_then(|generation| generation.get("respectSuppression"))
        .and_then(serde_json::Value::as_bool)
    {
        policy.respect_suppression = value;
    }
    if let Some(value) = parsed
        .get("generation")
        .and_then(|generation| generation.get("autoEnabled"))
        .and_then(serde_json::Value::as_bool)
    {
        policy.auto_enabled = value;
    }
    if let Some(value) = parsed
        .get("generation")
        .and_then(|generation| generation.get("todayAutoGenerate"))
        .and_then(serde_json::Value::as_bool)
    {
        policy.auto_enabled = value;
    }
    if let Some(value) = parsed
        .get("generation")
        .and_then(|generation| generation.get("catchUpOnAppStart"))
        .and_then(serde_json::Value::as_bool)
    {
        policy.catch_up_on_app_start = value;
    }
    if let Some(value) = parsed
        .get("generation")
        .and_then(|generation| generation.get("generateOnAppStart"))
        .and_then(serde_json::Value::as_bool)
    {
        policy.catch_up_on_app_start = value;
    }
    if let Some(value) = parsed
        .get("generation")
        .and_then(|generation| generation.get("maxAutoBlocksPerDay"))
        .and_then(serde_json::Value::as_u64)
    {
        policy.max_auto_blocks_per_day = value.max(1) as u32;
    }
    if let Some(value) = parsed
        .get("generation")
        .and_then(|generation| generation.get("maxRelocationsPerSync"))
        .and_then(serde_json::Value::as_u64)
    {
        policy.max_relocations_per_sync = value.max(1) as u32;
    }

    policy
}

pub fn parse_weekday(value: &str) -> Option<Weekday> {
    match value.trim().to_ascii_lowercase().as_str() {
        "monday" | "mon" | "mo" => Some(Weekday::Mon),
        "tuesday" | "tue" | "tu" => Some(Weekday::Tue),
        "wednesday" | "wed" | "we" => Some(Weekday::Wed),
        "thursday" | "thu" | "th" => Some(Weekday::Thu),
        "friday" | "fri" | "fr" => Some(Weekday::Fri),
        "saturday" | "sat" | "sa" => Some(Weekday::Sat),
        "sunday" | "sun" | "su" => Some(Weekday::Sun),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::test_support::config_fs::{write_json, TempConfigDir};

    #[test]
    fn load_runtime_policy_returns_defaults_when_config_is_missing() {
        let config_dir = TempConfigDir::new("policy", "defaults");

        let policy = load_runtime_policy(config_dir.path());

        assert_eq!(policy.timezone, Tz::UTC);
        assert_eq!(policy.work_start, NaiveTime::from_hms_opt(9, 0, 0).expect("time"));
        assert_eq!(policy.work_end, NaiveTime::from_hms_opt(18, 0, 0).expect("time"));
        assert_eq!(policy.max_auto_blocks_per_day, DEFAULT_MAX_AUTO_BLOCKS_PER_DAY);
        assert_eq!(
            policy.max_relocations_per_sync,
            DEFAULT_MAX_RELOCATIONS_PER_SYNC
        );

    }

    #[test]
    fn load_runtime_policy_reads_timezone_and_generation_limits() {
        let config_dir = TempConfigDir::new("policy", "configured");
        write_json(
            &config_dir.join("app.json"),
            serde_json::json!({
                "schema": 1,
                "timezone": "Asia/Tokyo",
                "blocksCalendarName": "Blocks"
            }),
        );
        write_json(
            &config_dir.join("policies.json"),
            serde_json::json!({
                "schema": 1,
                "workHours": {
                    "start": "10:00",
                    "end": "19:30",
                    "days": ["mon", "wed", "fri"]
                },
                "generation": {
                    "todayAutoGenerate": false,
                    "generateOnAppStart": false,
                    "respectSuppression": false,
                    "maxAutoBlocksPerDay": 12,
                    "maxRelocationsPerSync": 8
                },
                "blockDurationMinutes": 45,
                "breakDurationMinutes": 7,
                "minBlockGapMinutes": 3
            }),
        );

        let policy = load_runtime_policy(config_dir.path());

        assert_eq!(policy.timezone, chrono_tz::Asia::Tokyo);
        assert_eq!(policy.work_start, NaiveTime::from_hms_opt(10, 0, 0).expect("time"));
        assert_eq!(policy.work_end, NaiveTime::from_hms_opt(19, 30, 0).expect("time"));
        assert_eq!(policy.work_days, HashSet::from([Weekday::Mon, Weekday::Wed, Weekday::Fri]));
        assert!(!policy.auto_enabled);
        assert!(!policy.catch_up_on_app_start);
        assert!(!policy.respect_suppression);
        assert_eq!(policy.block_duration_minutes, 45);
        assert_eq!(policy.break_duration_minutes, 7);
        assert_eq!(policy.min_block_gap_minutes, 3);
        assert_eq!(policy.max_auto_blocks_per_day, 12);
        assert_eq!(policy.max_relocations_per_sync, 8);
    }
}
