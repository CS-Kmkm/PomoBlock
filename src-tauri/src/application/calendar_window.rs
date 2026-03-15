use crate::infrastructure::error::InfraError;
use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};

pub fn resolve_sync_window(
    time_min: Option<String>,
    time_max: Option<String>,
) -> Result<(DateTime<Utc>, DateTime<Utc>), InfraError> {
    let default_start = {
        let today = Utc::now().date_naive();
        Utc.from_utc_datetime(&today.and_hms_opt(0, 0, 0).expect("valid midnight"))
    };
    let start = match time_min {
        Some(raw) => parse_datetime_input(&raw, "time_min")?,
        None => default_start,
    };
    let end = match time_max {
        Some(raw) => parse_datetime_input(&raw, "time_max")?,
        None => start + Duration::days(1),
    };
    if end <= start {
        return Err(InfraError::InvalidConfig(
            "time_max must be greater than time_min".to_string(),
        ));
    }
    Ok((start, end))
}

pub fn parse_datetime_input(value: &str, field_name: &str) -> Result<DateTime<Utc>, InfraError> {
    if let Ok(parsed) = DateTime::parse_from_rfc3339(value) {
        return Ok(parsed.with_timezone(&Utc));
    }
    if let Ok(date) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        return Ok(Utc.from_utc_datetime(
            &date.and_hms_opt(0, 0, 0).expect("valid midnight"),
        ));
    }
    Err(InfraError::InvalidConfig(format!(
        "{field_name} must be RFC3339 or YYYY-MM-DD"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_datetime_input_accepts_rfc3339_and_date() {
        let rfc3339 = parse_datetime_input("2026-02-16T09:30:00+09:00", "time_min")
            .expect("parse rfc3339");
        let date = parse_datetime_input("2026-02-16", "time_min").expect("parse date");

        assert_eq!(rfc3339.to_rfc3339(), "2026-02-16T00:30:00+00:00");
        assert_eq!(date.to_rfc3339(), "2026-02-16T00:00:00+00:00");
    }

    #[test]
    fn resolve_sync_window_rejects_reversed_range() {
        let error = resolve_sync_window(
            Some("2026-02-16T10:00:00Z".to_string()),
            Some("2026-02-16T09:00:00Z".to_string()),
        )
        .expect_err("reject reversed range");

        assert!(error.to_string().contains("time_max must be greater than time_min"));
    }
}
