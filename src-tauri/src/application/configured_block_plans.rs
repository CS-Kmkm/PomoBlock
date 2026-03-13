use crate::application::policy_service::{parse_weekday, RuntimePolicy};
use crate::domain::models::{AutoDriveMode, Firmness, Recipe};
use chrono::{Datelike, NaiveDate, NaiveTime, Weekday};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct ConfiguredBlockPlan {
    pub instance: String,
    pub start_at: chrono::DateTime<chrono::Utc>,
    pub end_at: chrono::DateTime<chrono::Utc>,
    pub firmness: Firmness,
    pub planned_pomodoros: i32,
    pub source: String,
    pub source_id: Option<String>,
    pub recipe_id: String,
    pub auto_drive_mode: AutoDriveMode,
}

#[derive(Debug, Clone)]
struct TemplateDefinition {
    id: String,
    start: Option<NaiveTime>,
    duration_minutes: u32,
    firmness: Firmness,
    planned_pomodoros: Option<i32>,
    days: Option<HashSet<Weekday>>,
    recipe_id: Option<String>,
    auto_drive_mode: Option<AutoDriveMode>,
}

pub fn load_configured_block_plans(
    config_dir: &Path,
    date: NaiveDate,
    policy: &RuntimePolicy,
    recipes: &[Recipe],
) -> Vec<ConfiguredBlockPlan> {
    let templates_raw = read_config_array(config_dir, "templates.json", "templates");
    let routines_raw = read_config_array(config_dir, "routines.json", "routines");
    let templates = parse_template_definitions(&templates_raw);
    let mut plans = Vec::new();

    for template in templates.values() {
        if !template_applies_on_date(template, date) {
            continue;
        }
        let Some(start) = template.start else {
            continue;
        };
        let Ok(start_at) = local_datetime_to_utc(date, start, policy.timezone) else {
            continue;
        };
        let end_at = start_at + chrono::Duration::minutes(template.duration_minutes as i64);
        let (recipe_id, auto_drive_mode) = resolve_recipe_for_plan(
            template.recipe_id.clone(),
            template.auto_drive_mode.clone(),
            recipes,
        );
        plans.push(ConfiguredBlockPlan {
            instance: format!("tpl:{}:{}", template.id, date),
            start_at,
            end_at,
            firmness: template.firmness.clone(),
            planned_pomodoros: template.planned_pomodoros.unwrap_or_else(|| {
                planned_pomodoros(template.duration_minutes, policy.break_duration_minutes)
            }),
            source: "template".to_string(),
            source_id: Some(template.id.clone()),
            recipe_id,
            auto_drive_mode,
        });
    }

    for routine_raw in routines_raw {
        let Some(routine) = routine_raw.as_object() else {
            continue;
        };
        let Some(routine_id) = value_by_keys(routine, &["id"])
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if !routine_matches_date(routine, date) {
            continue;
        }
        let template_id = value_by_keys(routine, &["template_id", "templateId"])
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let linked_template = template_id.and_then(|template_id| templates.get(template_id));
        let default = value_by_keys(routine, &["default"]).and_then(serde_json::Value::as_object);
        let schedule = value_by_keys(routine, &["schedule"]).and_then(serde_json::Value::as_object);

        let start = default
            .and_then(|value| value_by_keys(value, &["start", "time"]))
            .and_then(parse_time_value)
            .or_else(|| {
                schedule
                    .and_then(|value| value_by_keys(value, &["time", "start"]))
                    .and_then(parse_time_value)
            })
            .or_else(|| linked_template.and_then(|template| template.start));
        let Some(start) = start else {
            continue;
        };

        let duration_minutes = default
            .and_then(|value| value_by_keys(value, &["durationMinutes", "duration_minutes"]))
            .and_then(parse_positive_u32_value)
            .or_else(|| {
                value_by_keys(routine, &["durationMinutes", "duration_minutes"])
                    .and_then(parse_positive_u32_value)
            })
            .or_else(|| linked_template.map(|template| template.duration_minutes));
        let Some(duration_minutes) = duration_minutes else {
            continue;
        };

        let Ok(start_at) = local_datetime_to_utc(date, start, policy.timezone) else {
            continue;
        };
        let end_at = start_at + chrono::Duration::minutes(duration_minutes as i64);

        let firmness = parse_firmness_value(
            default
                .and_then(|value| value_by_keys(value, &["firmness"]))
                .or_else(|| value_by_keys(routine, &["firmness"])),
        )
        .or_else(|| linked_template.map(|template| template.firmness.clone()))
        .unwrap_or(Firmness::Draft);
        let planned_pomodoros = default
            .and_then(|value| value_by_keys(value, &["pomodoros", "plannedPomodoros", "planned_pomodoros"]))
            .and_then(parse_positive_i32_value)
            .or_else(|| {
                value_by_keys(
                    routine,
                    &["pomodoros", "plannedPomodoros", "planned_pomodoros"],
                )
                .and_then(parse_positive_i32_value)
            })
            .or_else(|| linked_template.and_then(|template| template.planned_pomodoros))
            .unwrap_or_else(|| planned_pomodoros(duration_minutes, policy.break_duration_minutes));
        let explicit_recipe_id = default
            .and_then(|value| value_by_keys(value, &["recipeId", "recipe_id"]))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .or_else(|| {
                value_by_keys(routine, &["recipeId", "recipe_id"])
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned)
            })
            .or_else(|| linked_template.and_then(|template| template.recipe_id.clone()));
        let auto_drive_override = parse_auto_drive_mode_value(
            default
                .and_then(|value| value_by_keys(value, &["autoDriveMode", "auto_drive_mode"]))
                .or_else(|| value_by_keys(routine, &["autoDriveMode", "auto_drive_mode"])),
        )
        .or_else(|| linked_template.and_then(|template| template.auto_drive_mode.clone()));
        let (recipe_id, auto_drive_mode) =
            resolve_recipe_for_plan(explicit_recipe_id, auto_drive_override, recipes);

        plans.push(ConfiguredBlockPlan {
            instance: format!("rtn:{}:{}", routine_id, date),
            start_at,
            end_at,
            firmness,
            planned_pomodoros,
            source: "routine".to_string(),
            source_id: Some(routine_id.to_string()),
            recipe_id,
            auto_drive_mode,
        });
    }

    plans.sort_by(|left, right| left.start_at.cmp(&right.start_at));
    plans
}

pub fn resolve_recipe_for_plan(
    explicit_recipe_id: Option<String>,
    auto_drive_override: Option<AutoDriveMode>,
    recipes: &[Recipe],
) -> (String, AutoDriveMode) {
    let normalized_explicit = explicit_recipe_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    if let Some(recipe_id) = normalized_explicit.clone() {
        if let Some(recipe) = recipes.iter().find(|candidate| candidate.id == recipe_id) {
            return (
                recipe_id,
                auto_drive_override.unwrap_or_else(|| recipe.auto_drive_mode.clone()),
            );
        }
        return (recipe_id, auto_drive_override.unwrap_or(AutoDriveMode::Manual));
    }

    let fallback = recipes
        .iter()
        .find(|candidate| candidate.id == default_recipe_id())
        .or_else(|| recipes.first());
    match fallback {
        Some(recipe) => (
            recipe.id.clone(),
            auto_drive_override.unwrap_or_else(|| recipe.auto_drive_mode.clone()),
        ),
        None => (
            default_recipe_id().to_string(),
            auto_drive_override.unwrap_or(AutoDriveMode::Manual),
        ),
    }
}

fn default_recipe_id() -> &'static str {
    "rcp-default"
}

fn planned_pomodoros(block_duration_minutes: u32, break_duration_minutes: u32) -> i32 {
    let cycle_minutes = 25u32.saturating_add(break_duration_minutes.max(1));
    (block_duration_minutes / cycle_minutes).max(1) as i32
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

fn parse_template_definitions(templates_raw: &[serde_json::Value]) -> HashMap<String, TemplateDefinition> {
    let mut templates = HashMap::new();
    for template_raw in templates_raw {
        let Some(template) = template_raw.as_object() else {
            continue;
        };
        let Some(template_id) = value_by_keys(template, &["id"])
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let Some(duration_minutes) = value_by_keys(template, &["durationMinutes", "duration_minutes"])
            .and_then(parse_positive_u32_value)
        else {
            continue;
        };
        let start = value_by_keys(template, &["start", "time"]).and_then(parse_time_value);
        let firmness =
            parse_firmness_value(value_by_keys(template, &["firmness"])).unwrap_or(Firmness::Draft);
        let planned_pomodoros = value_by_keys(
            template,
            &["plannedPomodoros", "planned_pomodoros", "pomodoros"],
        )
        .and_then(parse_positive_i32_value);
        let days = value_by_keys(template, &["days"])
            .and_then(serde_json::Value::as_array)
            .map(|days| {
                days.iter()
                    .filter_map(serde_json::Value::as_str)
                    .filter_map(parse_weekday)
                    .collect::<HashSet<_>>()
            })
            .filter(|days| !days.is_empty());
        let recipe_id = value_by_keys(template, &["recipeId", "recipe_id"])
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        let auto_drive_mode =
            parse_auto_drive_mode_value(value_by_keys(template, &["autoDriveMode", "auto_drive_mode"]));

        templates.insert(
            template_id.to_string(),
            TemplateDefinition {
                id: template_id.to_string(),
                start,
                duration_minutes,
                firmness,
                planned_pomodoros,
                days,
                recipe_id,
                auto_drive_mode,
            },
        );
    }
    templates
}

fn template_applies_on_date(template: &TemplateDefinition, date: NaiveDate) -> bool {
    match &template.days {
        Some(days) => days.contains(&date.weekday()),
        None => true,
    }
}

fn parse_rrule(rrule: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for part in rrule.split(';') {
        let mut split = part.splitn(2, '=');
        let Some(key) = split.next() else {
            continue;
        };
        let Some(value) = split.next() else {
            continue;
        };
        let normalized_key = key.trim().to_ascii_uppercase();
        let normalized_value = value.trim().to_ascii_uppercase();
        if normalized_key.is_empty() || normalized_value.is_empty() {
            continue;
        }
        map.insert(normalized_key, normalized_value);
    }
    map
}

fn weekday_to_rrule_code(weekday: Weekday) -> &'static str {
    match weekday {
        Weekday::Mon => "MO",
        Weekday::Tue => "TU",
        Weekday::Wed => "WE",
        Weekday::Thu => "TH",
        Weekday::Fri => "FR",
        Weekday::Sat => "SA",
        Weekday::Sun => "SU",
    }
}

fn rrule_matches_date(rrule: &str, date: NaiveDate) -> bool {
    let parts = parse_rrule(rrule);
    let Some(freq) = parts.get("FREQ").map(String::as_str) else {
        return false;
    };
    if !matches!(freq, "DAILY" | "WEEKLY" | "MONTHLY") {
        return false;
    }

    if let Some(by_day) = parts.get("BYDAY") {
        let target = weekday_to_rrule_code(date.weekday());
        let day_matches = by_day
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .any(|value| value == target);
        if !day_matches {
            return false;
        }
    }

    if let Some(by_month_day) = parts.get("BYMONTHDAY") {
        let current_day = date.day() as i32;
        let month_day_matches = by_month_day
            .split(',')
            .map(str::trim)
            .filter_map(|value| value.parse::<i32>().ok())
            .any(|value| value == current_day);
        if !month_day_matches {
            return false;
        }
    }

    true
}

fn routine_is_skipped_on_date(
    routine: &serde_json::Map<String, serde_json::Value>,
    date: NaiveDate,
) -> bool {
    let date_key = date.to_string();
    let direct_skip = value_by_keys(routine, &["skip_dates", "skipDates"])
        .and_then(serde_json::Value::as_array)
        .map(|skip_dates| {
            skip_dates
                .iter()
                .filter_map(serde_json::Value::as_str)
                .any(|value| value.trim() == date_key)
        })
        .unwrap_or(false);
    if direct_skip {
        return true;
    }

    value_by_keys(routine, &["exceptions"])
        .and_then(serde_json::Value::as_array)
        .map(|exceptions| {
            exceptions.iter().any(|entry| {
                let Some(exception) = entry.as_object() else {
                    return false;
                };
                value_by_keys(exception, &["skip_dates", "skipDates"])
                    .and_then(serde_json::Value::as_array)
                    .map(|skip_dates| {
                        skip_dates
                            .iter()
                            .filter_map(serde_json::Value::as_str)
                            .any(|value| value.trim() == date_key)
                    })
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

fn schedule_matches_date(schedule: &serde_json::Map<String, serde_json::Value>, date: NaiveDate) -> bool {
    let schedule_type = value_by_keys(schedule, &["type"])
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .map(|value| value.to_ascii_lowercase());
    match schedule_type.as_deref() {
        Some("daily") => true,
        Some("weekly") => value_by_keys(schedule, &["day", "weekday"])
            .and_then(serde_json::Value::as_str)
            .and_then(parse_weekday)
            .map(|weekday| weekday == date.weekday())
            .unwrap_or(false),
        Some("monthly") => value_by_keys(schedule, &["day", "dayOfMonth", "day_of_month"])
            .and_then(parse_positive_u32_value)
            .map(|day| day == date.day())
            .unwrap_or(false),
        Some(_) | None => false,
    }
}

fn routine_matches_date(routine: &serde_json::Map<String, serde_json::Value>, date: NaiveDate) -> bool {
    if routine_is_skipped_on_date(routine, date) {
        return false;
    }
    if let Some(schedule) = value_by_keys(routine, &["schedule"]).and_then(serde_json::Value::as_object)
    {
        return schedule_matches_date(schedule, date);
    }
    if let Some(rrule) = value_by_keys(routine, &["rrule"])
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return rrule_matches_date(rrule, date);
    }
    true
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

fn parse_time_value(value: &serde_json::Value) -> Option<NaiveTime> {
    let value = value.as_str()?.trim();
    if value.is_empty() {
        return None;
    }
    NaiveTime::parse_from_str(value, "%H:%M").ok()
}

fn parse_positive_u32_value(value: &serde_json::Value) -> Option<u32> {
    if let Some(parsed) = value.as_u64() {
        let parsed = u32::try_from(parsed).ok()?;
        return (parsed > 0).then_some(parsed);
    }
    let parsed = value.as_str()?.trim().parse::<u32>().ok()?;
    (parsed > 0).then_some(parsed)
}

fn parse_positive_i32_value(value: &serde_json::Value) -> Option<i32> {
    if let Some(parsed) = value.as_i64() {
        let parsed = i32::try_from(parsed).ok()?;
        return (parsed > 0).then_some(parsed);
    }
    if let Some(parsed) = value.as_u64() {
        let parsed = i32::try_from(parsed).ok()?;
        return (parsed > 0).then_some(parsed);
    }
    let parsed = value.as_str()?.trim().parse::<i32>().ok()?;
    (parsed > 0).then_some(parsed)
}

fn parse_firmness_value(value: Option<&serde_json::Value>) -> Option<Firmness> {
    match value?.as_str()?.trim().to_ascii_lowercase().as_str() {
        "draft" => Some(Firmness::Draft),
        "soft" => Some(Firmness::Soft),
        "hard" => Some(Firmness::Hard),
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

fn local_datetime_to_utc(
    date: NaiveDate,
    time: NaiveTime,
    timezone: chrono_tz::Tz,
) -> Result<chrono::DateTime<chrono::Utc>, ()> {
    use chrono::{LocalResult, TimeZone, Utc};

    let local = date.and_time(time);
    let resolved = match timezone.from_local_datetime(&local) {
        LocalResult::Single(value) => value,
        LocalResult::Ambiguous(first, second) => first.min(second),
        LocalResult::None => return Err(()),
    };
    Ok(resolved.with_timezone(&Utc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::models::AutoDriveMode;
    use chrono::NaiveTime;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_config_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir().join(format!("pomoblock-plans-{label}-{nanos}"))
    }

    fn sample_policy() -> RuntimePolicy {
        RuntimePolicy {
            work_start: NaiveTime::from_hms_opt(9, 0, 0).expect("time"),
            work_end: NaiveTime::from_hms_opt(18, 0, 0).expect("time"),
            work_days: HashSet::from([Weekday::Mon, Weekday::Tue, Weekday::Wed, Weekday::Thu, Weekday::Fri]),
            timezone: chrono_tz::Tz::UTC,
            auto_enabled: true,
            catch_up_on_app_start: true,
            block_duration_minutes: 60,
            break_duration_minutes: 5,
            min_block_gap_minutes: 0,
            max_auto_blocks_per_day: 24,
            max_relocations_per_sync: 50,
            respect_suppression: true,
        }
    }

    fn sample_recipes() -> Vec<Recipe> {
        vec![Recipe {
            id: "rcp-default".to_string(),
            name: "Default".to_string(),
            auto_drive_mode: AutoDriveMode::Manual,
            steps: Vec::new(),
            studio_meta: None,
        }]
    }

    #[test]
    fn resolve_recipe_for_plan_prefers_explicit_or_defaults() {
        let recipes = vec![
            Recipe {
                id: "rcp-default".to_string(),
                name: "Default".to_string(),
                auto_drive_mode: AutoDriveMode::Manual,
                steps: Vec::new(),
                studio_meta: None,
            },
            Recipe {
                id: "rcp-deep".to_string(),
                name: "Deep".to_string(),
                auto_drive_mode: AutoDriveMode::Auto,
                steps: Vec::new(),
                studio_meta: None,
            },
        ];

        let explicit = resolve_recipe_for_plan(
            Some("rcp-deep".to_string()),
            None,
            &recipes,
        );
        let fallback = resolve_recipe_for_plan(None, Some(AutoDriveMode::AutoSilent), &[]);

        assert_eq!(explicit.0, "rcp-deep");
        assert_eq!(explicit.1, AutoDriveMode::Auto);
        assert_eq!(fallback.0, "rcp-default");
        assert_eq!(fallback.1, AutoDriveMode::AutoSilent);
    }

    #[test]
    fn load_configured_block_plans_reads_templates_and_routines() {
        let config_dir = temp_config_dir("roundtrip");
        fs::create_dir_all(&config_dir).expect("config dir");
        fs::write(
            config_dir.join("templates.json"),
            r#"{
  "schema": 1,
  "templates": [
    {
      "id": "tpl-deep",
      "start": "09:30",
      "durationMinutes": 90,
      "firmness": "soft",
      "recipeId": "rcp-default"
    }
  ]
}
"#,
        )
        .expect("write templates");
        fs::write(
            config_dir.join("routines.json"),
            r#"{
  "schema": 1,
  "routines": [
    {
      "id": "rtn-daily",
      "rrule": "FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR",
      "default": {
        "start": "11:00",
        "durationMinutes": 60,
        "firmness": "draft"
      }
    }
  ]
}
"#,
        )
        .expect("write routines");

        let plans = load_configured_block_plans(
            &config_dir,
            NaiveDate::from_ymd_opt(2026, 2, 16).expect("date"),
            &sample_policy(),
            &sample_recipes(),
        );

        assert_eq!(plans.len(), 2);
        assert_eq!(plans[0].source, "template");
        assert_eq!(plans[0].source_id.as_deref(), Some("tpl-deep"));
        assert_eq!(plans[1].source, "routine");
        assert_eq!(plans[1].source_id.as_deref(), Some("rtn-daily"));

        let _ = fs::remove_dir_all(config_dir);
    }
}
