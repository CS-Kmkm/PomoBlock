use chrono::{DateTime, Datelike, NaiveDate, NaiveTime, Utc, Weekday};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Firmness {
    Draft,
    Soft,
    Hard,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BlockType {
    Deep,
    Shallow,
    Admin,
    Learning,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BlockStatus {
    Planned,
    Running,
    Done,
    Partial,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Block {
    pub id: String,
    pub instance: String,
    pub date: String,
    pub start_at: DateTime<Utc>,
    pub end_at: DateTime<Utc>,
    pub block_type: BlockType,
    pub firmness: Firmness,
    pub planned_pomodoros: i32,
    pub source: String,
    pub source_id: Option<String>,
}

impl Block {
    pub fn validate(&self) -> Result<(), String> {
        validate_non_empty(&self.id, "block.id")?;
        validate_non_empty(&self.instance, "block.instance")?;
        validate_non_empty(&self.source, "block.source")?;
        validate_date(&self.date, "block.date")?;
        if self.end_at <= self.start_at {
            return Err("block.end_at must be after block.start_at".to_string());
        }
        if self.planned_pomodoros < 0 {
            return Err("block.planned_pomodoros must be >= 0".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    InProgress,
    Completed,
    Deferred,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub estimated_pomodoros: Option<u32>,
    pub completed_pomodoros: u32,
    pub status: TaskStatus,
    pub created_at: DateTime<Utc>,
}

impl Task {
    pub fn validate(&self) -> Result<(), String> {
        validate_non_empty(&self.id, "task.id")?;
        validate_non_empty(&self.title, "task.title")?;
        if let Some(estimated) = self.estimated_pomodoros {
            if estimated < self.completed_pomodoros {
                return Err(
                    "task.completed_pomodoros must be <= task.estimated_pomodoros".to_string(),
                );
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PomodoroPhase {
    Focus,
    Break,
    LongBreak,
    Paused,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PomodoroLog {
    pub id: String,
    pub block_id: String,
    pub task_id: Option<String>,
    pub phase: PomodoroPhase,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub interruption_reason: Option<String>,
}

impl PomodoroLog {
    pub fn validate(&self) -> Result<(), String> {
        validate_non_empty(&self.id, "pomodoro.id")?;
        validate_non_empty(&self.block_id, "pomodoro.block_id")?;
        if let Some(end_time) = self.end_time {
            if end_time < self.start_time {
                return Err("pomodoro.end_time must be >= pomodoro.start_time".to_string());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlacementStrategy {
    Keep,
    Shift,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkHours {
    pub start: String,
    pub end: String,
    pub days: Vec<String>,
}

impl WorkHours {
    pub fn validate(&self) -> Result<(), String> {
        validate_hhmm(&self.start, "policy.work_hours.start")?;
        validate_hhmm(&self.end, "policy.work_hours.end")?;
        if self.days.is_empty() {
            return Err("policy.work_hours.days must not be empty".to_string());
        }
        for day in &self.days {
            validate_non_empty(day, "policy.work_hours.days[]")?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GenerationPolicy {
    pub auto_enabled: bool,
    pub auto_time: String,
    pub catch_up_on_app_start: bool,
    pub placement_strategy: PlacementStrategy,
    pub max_shift_minutes: u32,
    pub create_if_no_slot: bool,
    pub respect_suppression: bool,
}

impl GenerationPolicy {
    pub fn validate(&self) -> Result<(), String> {
        validate_hhmm(&self.auto_time, "policy.generation.auto_time")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Policy {
    pub work_hours: WorkHours,
    pub generation: GenerationPolicy,
    pub block_duration_minutes: u32,
    pub break_duration_minutes: u32,
    pub min_block_gap_minutes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicyOverride {
    pub work_hours: Option<WorkHours>,
    pub block_duration_minutes: Option<u32>,
    pub break_duration_minutes: Option<u32>,
    pub min_block_gap_minutes: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TimeSlot {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
}

impl Policy {
    pub fn validate(&self) -> Result<(), String> {
        self.work_hours.validate()?;
        self.generation.validate()?;
        if self.block_duration_minutes == 0 {
            return Err("policy.block_duration_minutes must be > 0".to_string());
        }
        if self.break_duration_minutes == 0 {
            return Err("policy.break_duration_minutes must be > 0".to_string());
        }
        Ok(())
    }

    pub fn is_within_work_hours(&self, time: DateTime<Utc>) -> bool {
        let Some(start) = parse_hhmm(&self.work_hours.start) else {
            return false;
        };
        let Some(end) = parse_hhmm(&self.work_hours.end) else {
            return false;
        };

        let day = weekday_name(time.weekday());
        let is_active_day = self
            .work_hours
            .days
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(day));
        if !is_active_day {
            return false;
        }

        let current = time.time();
        if start <= end {
            current >= start && current < end
        } else {
            current >= start || current < end
        }
    }

    pub fn filter_slots(&self, slots: Vec<TimeSlot>) -> Vec<TimeSlot> {
        slots
            .into_iter()
            .filter(|slot| {
                if slot.end <= slot.start {
                    return false;
                }

                self.is_within_work_hours(slot.start)
                    && self.is_within_work_hours(slot.end - chrono::Duration::seconds(1))
            })
            .collect()
    }

    pub fn apply_override(&self, override_policy: &PolicyOverride) -> Policy {
        Policy {
            work_hours: override_policy
                .work_hours
                .clone()
                .unwrap_or_else(|| self.work_hours.clone()),
            generation: self.generation.clone(),
            block_duration_minutes: override_policy
                .block_duration_minutes
                .unwrap_or(self.block_duration_minutes),
            break_duration_minutes: override_policy
                .break_duration_minutes
                .unwrap_or(self.break_duration_minutes),
            min_block_gap_minutes: override_policy
                .min_block_gap_minutes
                .unwrap_or(self.min_block_gap_minutes),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RoutineDefault {
    pub start: String,
    pub duration_minutes: u32,
    pub block_type: BlockType,
    pub pomodoros: u32,
    pub firmness: Firmness,
}

impl RoutineDefault {
    pub fn validate(&self) -> Result<(), String> {
        validate_hhmm(&self.start, "routine.default.start")?;
        if self.duration_minutes == 0 {
            return Err("routine.default.duration_minutes must be > 0".to_string());
        }
        if self.pomodoros == 0 {
            return Err("routine.default.pomodoros must be > 0".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RoutineException {
    pub skip_dates: Vec<String>,
}

impl RoutineException {
    pub fn validate(&self) -> Result<(), String> {
        for date in &self.skip_dates {
            validate_date(date, "routine.exceptions.skip_dates[]")?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Routine {
    pub id: String,
    pub name: String,
    pub rrule: String,
    #[serde(rename = "default")]
    pub default_rule: RoutineDefault,
    pub exceptions: Vec<RoutineException>,
    pub carryover: bool,
}

impl Routine {
    pub fn validate(&self) -> Result<(), String> {
        validate_non_empty(&self.id, "routine.id")?;
        validate_non_empty(&self.name, "routine.name")?;
        validate_non_empty(&self.rrule, "routine.rrule")?;
        self.default_rule.validate()?;
        for exception in &self.exceptions {
            exception.validate()?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub duration_minutes: u32,
    pub default_tasks: Vec<String>,
}

impl Template {
    pub fn validate(&self) -> Result<(), String> {
        validate_non_empty(&self.id, "template.id")?;
        validate_non_empty(&self.name, "template.name")?;
        if self.duration_minutes == 0 {
            return Err("template.duration_minutes must be > 0".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OAuthToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: DateTime<Utc>,
    pub token_type: String,
    pub scope: Option<String>,
}

impl OAuthToken {
    pub fn is_valid_at(&self, now: DateTime<Utc>, leeway_seconds: i64) -> bool {
        self.expires_at > now + chrono::Duration::seconds(leeway_seconds)
            && !self.access_token.trim().is_empty()
    }
}

fn validate_non_empty(value: &str, field_name: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{field_name} must not be empty"));
    }
    Ok(())
}

fn validate_hhmm(value: &str, field_name: &str) -> Result<(), String> {
    let mut split = value.split(':');
    let Some(hour_str) = split.next() else {
        return Err(format!("{field_name} must be HH:MM"));
    };
    let Some(minute_str) = split.next() else {
        return Err(format!("{field_name} must be HH:MM"));
    };
    if split.next().is_some() {
        return Err(format!("{field_name} must be HH:MM"));
    }

    let hour = hour_str
        .parse::<u8>()
        .map_err(|_| format!("{field_name} must be HH:MM"))?;
    let minute = minute_str
        .parse::<u8>()
        .map_err(|_| format!("{field_name} must be HH:MM"))?;
    if hour > 23 || minute > 59 {
        return Err(format!("{field_name} must be HH:MM"));
    }
    Ok(())
}

fn validate_date(value: &str, field_name: &str) -> Result<(), String> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| format!("{field_name} must be YYYY-MM-DD"))?;
    Ok(())
}

fn parse_hhmm(value: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(value, "%H:%M").ok()
}

fn weekday_name(weekday: Weekday) -> &'static str {
    match weekday {
        Weekday::Mon => "Monday",
        Weekday::Tue => "Tuesday",
        Weekday::Wed => "Wednesday",
        Weekday::Thu => "Thursday",
        Weekday::Fri => "Friday",
        Weekday::Sat => "Saturday",
        Weekday::Sun => "Sunday",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn fixed_time(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .expect("valid datetime")
            .with_timezone(&Utc)
    }

    fn sample_block() -> Block {
        Block {
            id: "blk-1".to_string(),
            instance: "tpl:deep-1:2026-02-16".to_string(),
            date: "2026-02-16".to_string(),
            start_at: fixed_time("2026-02-16T09:00:00Z"),
            end_at: fixed_time("2026-02-16T10:00:00Z"),
            block_type: BlockType::Deep,
            firmness: Firmness::Draft,
            planned_pomodoros: 2,
            source: "template".to_string(),
            source_id: Some("tpl-deep-1".to_string()),
        }
    }

    fn sample_task() -> Task {
        Task {
            id: "tsk-1".to_string(),
            title: "Write tests".to_string(),
            description: Some("for domain models".to_string()),
            estimated_pomodoros: Some(3),
            completed_pomodoros: 1,
            status: TaskStatus::InProgress,
            created_at: fixed_time("2026-02-16T08:00:00Z"),
        }
    }

    fn sample_pomodoro() -> PomodoroLog {
        PomodoroLog {
            id: "pom-1".to_string(),
            block_id: "blk-1".to_string(),
            task_id: Some("tsk-1".to_string()),
            phase: PomodoroPhase::Focus,
            start_time: fixed_time("2026-02-16T09:00:00Z"),
            end_time: Some(fixed_time("2026-02-16T09:25:00Z")),
            interruption_reason: None,
        }
    }

    fn sample_policy() -> Policy {
        Policy {
            work_hours: WorkHours {
                start: "09:00".to_string(),
                end: "18:00".to_string(),
                days: vec![
                    "Monday".to_string(),
                    "Tuesday".to_string(),
                    "Wednesday".to_string(),
                    "Thursday".to_string(),
                    "Friday".to_string(),
                ],
            },
            generation: GenerationPolicy {
                auto_enabled: true,
                auto_time: "05:30".to_string(),
                catch_up_on_app_start: true,
                placement_strategy: PlacementStrategy::Keep,
                max_shift_minutes: 120,
                create_if_no_slot: false,
                respect_suppression: true,
            },
            block_duration_minutes: 50,
            break_duration_minutes: 10,
            min_block_gap_minutes: 5,
        }
    }

    fn sample_routine() -> Routine {
        Routine {
            id: "rtn-1".to_string(),
            name: "Daily deep work".to_string(),
            rrule: "FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR".to_string(),
            default_rule: RoutineDefault {
                start: "09:00".to_string(),
                duration_minutes: 90,
                block_type: BlockType::Deep,
                pomodoros: 2,
                firmness: Firmness::Draft,
            },
            exceptions: vec![RoutineException {
                skip_dates: vec!["2026-02-21".to_string()],
            }],
            carryover: true,
        }
    }

    fn sample_template() -> Template {
        Template {
            id: "tpl-1".to_string(),
            name: "Deep Work".to_string(),
            duration_minutes: 90,
            default_tasks: vec!["tsk-1".to_string(), "tsk-2".to_string()],
        }
    }

    #[test]
    fn block_validate_accepts_valid_block() {
        let block = sample_block();
        assert!(block.validate().is_ok());
    }

    #[test]
    fn block_validate_rejects_invalid_range() {
        let mut block = sample_block();
        block.end_at = block.start_at;
        assert!(block.validate().is_err());
    }

    #[test]
    fn task_validate_rejects_empty_title() {
        let mut task = sample_task();
        task.title = "   ".to_string();
        assert!(task.validate().is_err());
    }

    #[test]
    fn pomodoro_validate_rejects_reverse_time() {
        let mut pomodoro = sample_pomodoro();
        pomodoro.end_time = Some(fixed_time("2026-02-16T08:59:00Z"));
        assert!(pomodoro.validate().is_err());
    }

    #[test]
    fn policy_routine_template_validate_success() {
        assert!(sample_policy().validate().is_ok());
        assert!(sample_routine().validate().is_ok());
        assert!(sample_template().validate().is_ok());
    }

    #[test]
    fn policy_work_hours_and_filter_slots() {
        let policy = sample_policy();
        let inside = fixed_time("2026-02-16T10:00:00Z");
        let outside = fixed_time("2026-02-16T19:00:00Z");
        assert!(policy.is_within_work_hours(inside));
        assert!(!policy.is_within_work_hours(outside));

        let slots = vec![
            TimeSlot {
                start: fixed_time("2026-02-16T09:30:00Z"),
                end: fixed_time("2026-02-16T10:00:00Z"),
            },
            TimeSlot {
                start: fixed_time("2026-02-16T18:30:00Z"),
                end: fixed_time("2026-02-16T19:00:00Z"),
            },
        ];
        let filtered = policy.filter_slots(slots);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].start, fixed_time("2026-02-16T09:30:00Z"));
    }

    // Feature: blocksched, Property 29: user override values must take precedence
    proptest! {
        #[test]
        fn property29_user_override_values_take_precedence(
            base_block_duration in 1u32..240u32,
            override_block_duration in 1u32..240u32,
            base_break_duration in 1u32..120u32,
            override_break_duration in 1u32..120u32,
            base_gap in 0u32..60u32,
            override_gap in 0u32..60u32
        ) {
            let mut base = sample_policy();
            base.block_duration_minutes = base_block_duration;
            base.break_duration_minutes = base_break_duration;
            base.min_block_gap_minutes = base_gap;

            let override_policy = PolicyOverride {
                work_hours: None,
                block_duration_minutes: Some(override_block_duration),
                break_duration_minutes: Some(override_break_duration),
                min_block_gap_minutes: Some(override_gap),
            };

            let effective = base.apply_override(&override_policy);

            prop_assert_eq!(effective.block_duration_minutes, override_block_duration);
            prop_assert_eq!(effective.break_duration_minutes, override_break_duration);
            prop_assert_eq!(effective.min_block_gap_minutes, override_gap);
        }
    }

    #[test]
    fn domain_models_support_serde_roundtrip() {
        let block = sample_block();
        let task = sample_task();
        let pomodoro = sample_pomodoro();
        let policy = sample_policy();
        let routine = sample_routine();
        let template = sample_template();

        let block_roundtrip: Block =
            serde_json::from_str(&serde_json::to_string(&block).expect("serialize block"))
                .expect("deserialize block");
        let task_roundtrip: Task =
            serde_json::from_str(&serde_json::to_string(&task).expect("serialize task"))
                .expect("deserialize task");
        let pomodoro_roundtrip: PomodoroLog = serde_json::from_str(
            &serde_json::to_string(&pomodoro).expect("serialize pomodoro"),
        )
        .expect("deserialize pomodoro");
        let policy_roundtrip: Policy =
            serde_json::from_str(&serde_json::to_string(&policy).expect("serialize policy"))
                .expect("deserialize policy");
        let routine_roundtrip: Routine =
            serde_json::from_str(&serde_json::to_string(&routine).expect("serialize routine"))
                .expect("deserialize routine");
        let template_roundtrip: Template = serde_json::from_str(
            &serde_json::to_string(&template).expect("serialize template"),
        )
        .expect("deserialize template");

        assert_eq!(block_roundtrip, block);
        assert_eq!(task_roundtrip, task);
        assert_eq!(pomodoro_roundtrip, pomodoro);
        assert_eq!(policy_roundtrip, policy);
        assert_eq!(routine_roundtrip, routine);
        assert_eq!(template_roundtrip, template);
    }
}
