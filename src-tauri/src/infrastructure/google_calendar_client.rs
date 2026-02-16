use crate::infrastructure::error::InfraError;
use crate::infrastructure::event_mapper::GoogleCalendarEvent;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use reqwest::Client;
use url::Url;

const CALENDAR_LIST_ENDPOINT: &str = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const CALENDAR_CREATE_ENDPOINT: &str = "https://www.googleapis.com/calendar/v3/calendars";
const CALENDAR_API_BASE: &str = "https://www.googleapis.com/calendar/v3/";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoogleCalendarSummary {
    pub id: String,
    pub summary: String,
}

#[derive(Debug, Clone)]
pub struct ListEventsRequest {
    pub time_min: Option<DateTime<Utc>>,
    pub time_max: Option<DateTime<Utc>>,
    pub sync_token: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ListEventsResponse {
    pub events: Vec<GoogleCalendarEvent>,
    pub next_sync_token: Option<String>,
}

#[async_trait]
pub trait GoogleCalendarClient: Send + Sync {
    async fn list_calendars(
        &self,
        access_token: &str,
    ) -> Result<Vec<GoogleCalendarSummary>, InfraError>;

    async fn create_calendar(
        &self,
        access_token: &str,
        summary: &str,
        time_zone: Option<&str>,
    ) -> Result<GoogleCalendarSummary, InfraError>;

    async fn list_events(
        &self,
        access_token: &str,
        calendar_id: &str,
        request: ListEventsRequest,
    ) -> Result<ListEventsResponse, InfraError>;

    async fn create_event(
        &self,
        access_token: &str,
        calendar_id: &str,
        event: &GoogleCalendarEvent,
    ) -> Result<String, InfraError>;

    async fn update_event(
        &self,
        access_token: &str,
        calendar_id: &str,
        event_id: &str,
        event: &GoogleCalendarEvent,
    ) -> Result<(), InfraError>;

    async fn delete_event(
        &self,
        access_token: &str,
        calendar_id: &str,
        event_id: &str,
    ) -> Result<(), InfraError>;
}

#[derive(Debug, Clone, Default)]
pub struct ReqwestGoogleCalendarClient {
    client: Client,
}

impl ReqwestGoogleCalendarClient {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    fn ensure_non_empty(value: &str, field: &str) -> Result<(), InfraError> {
        if value.trim().is_empty() {
            return Err(InfraError::OAuth(format!("{field} must not be empty")));
        }
        Ok(())
    }

    fn oauth_http_error(status: reqwest::StatusCode, body: &str) -> InfraError {
        let message = if body.trim().is_empty() {
            format!("google calendar api error: http {}", status.as_u16())
        } else {
            format!("google calendar api error: http {}; body={body}", status.as_u16())
        };
        InfraError::OAuth(message)
    }

    fn events_endpoint(calendar_id: &str) -> Result<Url, InfraError> {
        let mut url = Url::parse(CALENDAR_API_BASE)
            .map_err(|error| InfraError::OAuth(format!("invalid calendar api base url: {error}")))?;
        {
            let mut segments = url.path_segments_mut().map_err(|_| {
                InfraError::OAuth("calendar api base URL cannot be a base".to_string())
            })?;
            segments.push("calendars");
            segments.push(calendar_id);
            segments.push("events");
        }
        Ok(url)
    }

    fn event_endpoint(calendar_id: &str, event_id: &str) -> Result<Url, InfraError> {
        let mut url = Self::events_endpoint(calendar_id)?;
        {
            let mut segments = url.path_segments_mut().map_err(|_| {
                InfraError::OAuth("calendar events URL cannot be a base".to_string())
            })?;
            segments.push(event_id);
        }
        Ok(url)
    }
}

#[derive(Debug, serde::Deserialize)]
struct CalendarListResponse {
    items: Option<Vec<CalendarListItem>>,
}

#[derive(Debug, serde::Deserialize)]
struct CalendarListItem {
    id: String,
    summary: Option<String>,
}

#[derive(Debug, serde::Serialize)]
struct CreateCalendarRequest<'a> {
    summary: &'a str,
    #[serde(rename = "timeZone", skip_serializing_if = "Option::is_none")]
    time_zone: Option<&'a str>,
}

#[derive(Debug, serde::Deserialize)]
struct CalendarResourceResponse {
    id: Option<String>,
    summary: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct EventsPageResponse {
    items: Option<Vec<GoogleCalendarEvent>>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
    #[serde(rename = "nextSyncToken")]
    next_sync_token: Option<String>,
}

#[async_trait]
impl GoogleCalendarClient for ReqwestGoogleCalendarClient {
    async fn list_calendars(
        &self,
        access_token: &str,
    ) -> Result<Vec<GoogleCalendarSummary>, InfraError> {
        Self::ensure_non_empty(access_token, "access token")?;

        let response = self
            .client
            .get(CALENDAR_LIST_ENDPOINT)
            .query(&[("maxResults", 250)])
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|error| InfraError::OAuth(format!("network error while listing calendars: {error}")))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| InfraError::OAuth(format!("failed reading calendar list response: {error}")))?;

        if !status.is_success() {
            return Err(Self::oauth_http_error(status, &body));
        }

        let parsed: CalendarListResponse = serde_json::from_str(&body).map_err(|error| {
            InfraError::OAuth(format!("invalid calendar list payload: {error}; body={body}"))
        })?;

        Ok(parsed
            .items
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| {
                let id = item.id.trim();
                if id.is_empty() {
                    return None;
                }
                let summary = item
                    .summary
                    .unwrap_or_else(|| id.to_string())
                    .trim()
                    .to_string();
                Some(GoogleCalendarSummary {
                    id: id.to_string(),
                    summary,
                })
            })
            .collect())
    }

    async fn create_calendar(
        &self,
        access_token: &str,
        summary: &str,
        time_zone: Option<&str>,
    ) -> Result<GoogleCalendarSummary, InfraError> {
        Self::ensure_non_empty(access_token, "access token")?;
        Self::ensure_non_empty(summary, "calendar summary")?;

        let summary = summary.trim();
        let request = CreateCalendarRequest {
            summary,
            time_zone: time_zone.map(str::trim).filter(|value| !value.is_empty()),
        };

        let response = self
            .client
            .post(CALENDAR_CREATE_ENDPOINT)
            .bearer_auth(access_token)
            .json(&request)
            .send()
            .await
            .map_err(|error| InfraError::OAuth(format!("network error while creating calendar: {error}")))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| InfraError::OAuth(format!("failed reading calendar create response: {error}")))?;

        if !status.is_success() {
            return Err(Self::oauth_http_error(status, &body));
        }

        let parsed: CalendarResourceResponse = serde_json::from_str(&body).map_err(|error| {
            InfraError::OAuth(format!("invalid calendar create payload: {error}; body={body}"))
        })?;

        let id = parsed
            .id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| InfraError::OAuth("calendar create response did not include id".to_string()))?;
        let created_summary = parsed
            .summary
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| summary.to_string());

        Ok(GoogleCalendarSummary {
            id,
            summary: created_summary,
        })
    }

    async fn list_events(
        &self,
        access_token: &str,
        calendar_id: &str,
        request: ListEventsRequest,
    ) -> Result<ListEventsResponse, InfraError> {
        Self::ensure_non_empty(access_token, "access token")?;
        Self::ensure_non_empty(calendar_id, "calendar id")?;

        let endpoint = Self::events_endpoint(calendar_id)?;
        let mut page_token: Option<String> = None;
        let mut next_sync_token: Option<String> = None;
        let mut events = Vec::new();
        let sync_token = request.sync_token.clone();

        loop {
            let mut req = self.client.get(endpoint.clone()).bearer_auth(access_token);
            req = req.query(&[("showDeleted", "true"), ("maxResults", "2500")]);

            if let Some(sync_token) = sync_token.as_deref() {
                req = req.query(&[("syncToken", sync_token)]);
            } else {
                if let Some(time_min) = request.time_min {
                    req = req.query(&[("timeMin", time_min.to_rfc3339())]);
                }
                if let Some(time_max) = request.time_max {
                    req = req.query(&[("timeMax", time_max.to_rfc3339())]);
                }
            }

            if let Some(page_token) = page_token.as_deref() {
                req = req.query(&[("pageToken", page_token)]);
            }

            let response = req.send().await.map_err(|error| {
                InfraError::OAuth(format!("network error while listing calendar events: {error}"))
            })?;

            let status = response.status();
            let body = response.text().await.map_err(|error| {
                InfraError::OAuth(format!("failed reading events list response: {error}"))
            })?;

            if status == reqwest::StatusCode::GONE {
                return Err(InfraError::SyncTokenExpired);
            }
            if !status.is_success() {
                return Err(Self::oauth_http_error(status, &body));
            }

            let mut parsed: EventsPageResponse = serde_json::from_str(&body).map_err(|error| {
                InfraError::OAuth(format!("invalid events list payload: {error}; body={body}"))
            })?;

            events.extend(parsed.items.take().unwrap_or_default());
            if parsed.next_sync_token.is_some() {
                next_sync_token = parsed.next_sync_token.take();
            }

            if let Some(next_page_token) = parsed.next_page_token.take() {
                page_token = Some(next_page_token);
                continue;
            }
            break;
        }

        Ok(ListEventsResponse {
            events,
            next_sync_token,
        })
    }

    async fn create_event(
        &self,
        access_token: &str,
        calendar_id: &str,
        event: &GoogleCalendarEvent,
    ) -> Result<String, InfraError> {
        Self::ensure_non_empty(access_token, "access token")?;
        Self::ensure_non_empty(calendar_id, "calendar id")?;

        let endpoint = Self::events_endpoint(calendar_id)?;
        let response = self
            .client
            .post(endpoint)
            .bearer_auth(access_token)
            .json(event)
            .send()
            .await
            .map_err(|error| InfraError::OAuth(format!("network error while creating event: {error}")))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| InfraError::OAuth(format!("failed reading event create response: {error}")))?;

        if !status.is_success() {
            return Err(Self::oauth_http_error(status, &body));
        }

        let parsed: GoogleCalendarEvent = serde_json::from_str(&body).map_err(|error| {
            InfraError::OAuth(format!("invalid event create payload: {error}; body={body}"))
        })?;
        parsed
            .id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| InfraError::OAuth("event create response did not include id".to_string()))
    }

    async fn update_event(
        &self,
        access_token: &str,
        calendar_id: &str,
        event_id: &str,
        event: &GoogleCalendarEvent,
    ) -> Result<(), InfraError> {
        Self::ensure_non_empty(access_token, "access token")?;
        Self::ensure_non_empty(calendar_id, "calendar id")?;
        Self::ensure_non_empty(event_id, "event id")?;

        let endpoint = Self::event_endpoint(calendar_id, event_id)?;
        let response = self
            .client
            .put(endpoint)
            .bearer_auth(access_token)
            .json(event)
            .send()
            .await
            .map_err(|error| InfraError::OAuth(format!("network error while updating event: {error}")))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| InfraError::OAuth(format!("failed reading event update response: {error}")))?;

        if !status.is_success() {
            return Err(Self::oauth_http_error(status, &body));
        }
        Ok(())
    }

    async fn delete_event(
        &self,
        access_token: &str,
        calendar_id: &str,
        event_id: &str,
    ) -> Result<(), InfraError> {
        Self::ensure_non_empty(access_token, "access token")?;
        Self::ensure_non_empty(calendar_id, "calendar id")?;
        Self::ensure_non_empty(event_id, "event id")?;

        let endpoint = Self::event_endpoint(calendar_id, event_id)?;
        let response = self
            .client
            .delete(endpoint)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|error| InfraError::OAuth(format!("network error while deleting event: {error}")))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| InfraError::OAuth(format!("failed reading event delete response: {error}")))?;

        if !status.is_success() {
            return Err(Self::oauth_http_error(status, &body));
        }
        Ok(())
    }
}
