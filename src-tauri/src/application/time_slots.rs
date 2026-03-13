use crate::infrastructure::error::InfraError;
use crate::infrastructure::event_mapper::GoogleCalendarEvent;
use chrono::{DateTime, LocalResult, NaiveDate, NaiveTime, TimeZone, Utc};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Interval {
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
}

pub fn local_datetime_to_utc(
    date: NaiveDate,
    time: NaiveTime,
    timezone: chrono_tz::Tz,
) -> Result<DateTime<Utc>, InfraError> {
    let local = date.and_time(time);
    let resolved = match timezone.from_local_datetime(&local) {
        LocalResult::Single(value) => value,
        LocalResult::Ambiguous(first, second) => first.min(second),
        LocalResult::None => {
            return Err(InfraError::InvalidConfig(
                "local datetime does not exist in configured timezone".to_string(),
            ))
        }
    };
    Ok(resolved.with_timezone(&Utc))
}

pub fn intervals_overlap(left: &Interval, right: &Interval) -> bool {
    left.start < right.end && right.start < left.end
}

pub fn parse_rfc3339_input(value: &str, field_name: &str) -> Result<DateTime<Utc>, InfraError> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| {
            InfraError::InvalidConfig(format!(
                "{field_name} must be RFC3339 date-time: {error}"
            ))
        })
}

pub fn event_to_interval(event: &GoogleCalendarEvent) -> Option<Interval> {
    let start = DateTime::parse_from_rfc3339(&event.start.date_time)
        .ok()?
        .with_timezone(&Utc);
    let end = DateTime::parse_from_rfc3339(&event.end.date_time)
        .ok()?
        .with_timezone(&Utc);
    if end <= start {
        return None;
    }
    Some(Interval { start, end })
}

pub fn clip_interval(
    interval: Interval,
    window_start: DateTime<Utc>,
    window_end: DateTime<Utc>,
) -> Option<Interval> {
    if interval.end <= window_start || interval.start >= window_end {
        return None;
    }
    let start = if interval.start < window_start {
        window_start
    } else {
        interval.start
    };
    let end = if interval.end > window_end {
        window_end
    } else {
        interval.end
    };
    (end > start).then_some(Interval { start, end })
}

pub fn free_slots(
    window_start: DateTime<Utc>,
    window_end: DateTime<Utc>,
    busy_intervals: &[Interval],
) -> Vec<Interval> {
    if window_end <= window_start {
        return Vec::new();
    }

    let mut slots = Vec::new();
    let mut cursor = window_start;
    for interval in busy_intervals {
        if interval.start > cursor {
            slots.push(Interval {
                start: cursor,
                end: interval.start,
            });
        }
        if interval.end > cursor {
            cursor = interval.end;
        }
    }
    if cursor < window_end {
        slots.push(Interval {
            start: cursor,
            end: window_end,
        });
    }
    slots
}

pub fn merge_intervals(mut intervals: Vec<Interval>) -> Vec<Interval> {
    if intervals.is_empty() {
        return intervals;
    }

    intervals.sort_unstable_by(|left, right| left.start.cmp(&right.start));
    let mut iter = intervals.into_iter();
    let mut merged = vec![iter.next().expect("intervals is non-empty")];
    for interval in iter {
        let last = merged
            .last_mut()
            .expect("merged always contains at least one interval");
        if interval.start <= last.end {
            if interval.end > last.end {
                last.end = interval.end;
            }
            continue;
        }
        merged.push(interval);
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::event_mapper::CalendarEventDateTime;

    #[test]
    fn merge_intervals_coalesces_overlaps() {
        let intervals = vec![
            Interval {
                start: DateTime::parse_from_rfc3339("2026-02-16T09:00:00Z")
                    .expect("start")
                    .with_timezone(&Utc),
                end: DateTime::parse_from_rfc3339("2026-02-16T10:00:00Z")
                    .expect("end")
                    .with_timezone(&Utc),
            },
            Interval {
                start: DateTime::parse_from_rfc3339("2026-02-16T09:30:00Z")
                    .expect("start")
                    .with_timezone(&Utc),
                end: DateTime::parse_from_rfc3339("2026-02-16T11:00:00Z")
                    .expect("end")
                    .with_timezone(&Utc),
            },
        ];

        let merged = merge_intervals(intervals);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].start.to_rfc3339(), "2026-02-16T09:00:00+00:00");
        assert_eq!(merged[0].end.to_rfc3339(), "2026-02-16T11:00:00+00:00");
    }

    #[test]
    fn event_to_interval_rejects_reverse_range() {
        let event = GoogleCalendarEvent {
            id: Some("evt-1".to_string()),
            summary: None,
            description: None,
            status: Some("confirmed".to_string()),
            updated: None,
            etag: None,
            start: CalendarEventDateTime {
                date_time: "2026-02-16T10:00:00Z".to_string(),
                time_zone: None,
            },
            end: CalendarEventDateTime {
                date_time: "2026-02-16T09:00:00Z".to_string(),
                time_zone: None,
            },
            extended_properties: None,
        };

        assert!(event_to_interval(&event).is_none());
    }
}
