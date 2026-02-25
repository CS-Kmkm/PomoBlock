use crate::infrastructure::config::{
    ensure_default_configs, read_blocks_calendar_id, read_blocks_calendar_name, read_timezone,
    save_blocks_calendar_id,
};
use crate::infrastructure::error::InfraError;
use crate::infrastructure::google_calendar_client::GoogleCalendarClient;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnsureBlocksCalendarResult {
    Reused(String),
    LinkedExisting(String),
    Created(String),
}

pub struct BlocksCalendarInitializer<C>
where
    C: GoogleCalendarClient,
{
    config_dir: PathBuf,
    account_id: String,
    calendar_client: Arc<C>,
}

impl<C> BlocksCalendarInitializer<C>
where
    C: GoogleCalendarClient,
{
    pub fn new(
        config_dir: impl AsRef<Path>,
        account_id: impl Into<String>,
        calendar_client: Arc<C>,
    ) -> Self {
        Self {
            config_dir: config_dir.as_ref().to_path_buf(),
            account_id: account_id.into(),
            calendar_client,
        }
    }

    pub async fn ensure_blocks_calendar(
        &self,
        access_token: &str,
    ) -> Result<EnsureBlocksCalendarResult, InfraError> {
        ensure_default_configs(&self.config_dir)?;

        if let Some(calendar_id) = read_blocks_calendar_id(&self.config_dir, &self.account_id)? {
            return Ok(EnsureBlocksCalendarResult::Reused(calendar_id));
        }

        let calendar_name = read_blocks_calendar_name(&self.config_dir)?;
        let timezone = read_timezone(&self.config_dir)?;

        let calendars = self.calendar_client.list_calendars(access_token).await?;
        if let Some(existing) = calendars
            .into_iter()
            .find(|calendar| calendar.summary == calendar_name)
        {
            save_blocks_calendar_id(&self.config_dir, &self.account_id, &existing.id)?;
            return Ok(EnsureBlocksCalendarResult::LinkedExisting(existing.id));
        }

        let created = self
            .calendar_client
            .create_calendar(access_token, &calendar_name, timezone.as_deref())
            .await?;
        save_blocks_calendar_id(&self.config_dir, &self.account_id, &created.id)?;
        Ok(EnsureBlocksCalendarResult::Created(created.id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::config::read_blocks_calendar_id;
    use crate::infrastructure::event_mapper::GoogleCalendarEvent;
    use crate::infrastructure::google_calendar_client::{
        GoogleCalendarSummary, ListEventsRequest, ListEventsResponse,
    };
    use async_trait::async_trait;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    static NEXT_TEMP_ID: AtomicUsize = AtomicUsize::new(0);

    #[derive(Debug, Default)]
    struct FakeGoogleCalendarClient {
        list_response: Mutex<Vec<GoogleCalendarSummary>>,
        create_response: Mutex<Option<GoogleCalendarSummary>>,
        list_calls: AtomicUsize,
        create_calls: AtomicUsize,
        last_create_summary: Mutex<Option<String>>,
        last_create_timezone: Mutex<Option<Option<String>>>,
    }

    impl FakeGoogleCalendarClient {
        fn with_list_response(calendars: Vec<GoogleCalendarSummary>) -> Self {
            Self {
                list_response: Mutex::new(calendars),
                ..Self::default()
            }
        }

        fn set_create_response(&self, calendar: GoogleCalendarSummary) {
            let mut guard = self
                .create_response
                .lock()
                .expect("create response mutex poisoned");
            *guard = Some(calendar);
        }
    }

    #[async_trait]
    impl GoogleCalendarClient for FakeGoogleCalendarClient {
        async fn list_calendars(
            &self,
            _access_token: &str,
        ) -> Result<Vec<GoogleCalendarSummary>, InfraError> {
            self.list_calls.fetch_add(1, Ordering::SeqCst);
            Ok(self
                .list_response
                .lock()
                .expect("list response mutex poisoned")
                .clone())
        }

        async fn create_calendar(
            &self,
            _access_token: &str,
            summary: &str,
            time_zone: Option<&str>,
        ) -> Result<GoogleCalendarSummary, InfraError> {
            self.create_calls.fetch_add(1, Ordering::SeqCst);
            *self
                .last_create_summary
                .lock()
                .expect("summary mutex poisoned") = Some(summary.to_string());
            *self
                .last_create_timezone
                .lock()
                .expect("timezone mutex poisoned") =
                Some(time_zone.map(ToOwned::to_owned));

            let created = self
                .create_response
                .lock()
                .expect("create response mutex poisoned")
                .clone()
                .unwrap_or_else(|| GoogleCalendarSummary {
                    id: "created-id".to_string(),
                    summary: summary.to_string(),
                });
            Ok(created)
        }

        async fn list_events(
            &self,
            _access_token: &str,
            _calendar_id: &str,
            _request: ListEventsRequest,
        ) -> Result<ListEventsResponse, InfraError> {
            Err(InfraError::OAuth("not used in calendar_setup tests".to_string()))
        }

        async fn create_event(
            &self,
            _access_token: &str,
            _calendar_id: &str,
            _event: &GoogleCalendarEvent,
        ) -> Result<String, InfraError> {
            Err(InfraError::OAuth("not used in calendar_setup tests".to_string()))
        }

        async fn update_event(
            &self,
            _access_token: &str,
            _calendar_id: &str,
            _event_id: &str,
            _event: &GoogleCalendarEvent,
        ) -> Result<(), InfraError> {
            Err(InfraError::OAuth("not used in calendar_setup tests".to_string()))
        }

        async fn delete_event(
            &self,
            _access_token: &str,
            _calendar_id: &str,
            _event_id: &str,
        ) -> Result<(), InfraError> {
            Err(InfraError::OAuth("not used in calendar_setup tests".to_string()))
        }
    }

    struct TempConfigDir {
        path: PathBuf,
    }

    impl TempConfigDir {
        fn new() -> Self {
            let sequence = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "pomblock-calendar-{}-{}-{}",
                std::process::id(),
                chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0),
                sequence
            ));
            fs::create_dir_all(&path).expect("create temp directory");
            ensure_default_configs(&path).expect("initialize default configs");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempConfigDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[tokio::test]
    async fn ensure_blocks_calendar_reuses_stored_id() {
        let temp = TempConfigDir::new();
        save_blocks_calendar_id(temp.path(), "default", "stored-id").expect("save id");

        let client = Arc::new(FakeGoogleCalendarClient::default());
        let initializer = BlocksCalendarInitializer::new(temp.path(), "default", Arc::clone(&client));
        let result = initializer
            .ensure_blocks_calendar("access-token")
            .await
            .expect("ensure calendar");

        assert_eq!(result, EnsureBlocksCalendarResult::Reused("stored-id".to_string()));
        assert_eq!(client.list_calls.load(Ordering::SeqCst), 0);
        assert_eq!(client.create_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn ensure_blocks_calendar_links_existing_calendar_by_name() {
        let temp = TempConfigDir::new();
        let client = Arc::new(FakeGoogleCalendarClient::with_list_response(vec![
            GoogleCalendarSummary {
                id: "other".to_string(),
                summary: "Personal".to_string(),
            },
            GoogleCalendarSummary {
                id: "blocks-existing".to_string(),
                summary: "Blocks".to_string(),
            },
        ]));
        let initializer = BlocksCalendarInitializer::new(temp.path(), "default", Arc::clone(&client));
        let result = initializer
            .ensure_blocks_calendar("access-token")
            .await
            .expect("ensure calendar");

        assert_eq!(
            result,
            EnsureBlocksCalendarResult::LinkedExisting("blocks-existing".to_string())
        );
        assert_eq!(
            read_blocks_calendar_id(temp.path(), "default").expect("read id"),
            Some("blocks-existing".to_string())
        );
        assert_eq!(client.list_calls.load(Ordering::SeqCst), 1);
        assert_eq!(client.create_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn ensure_blocks_calendar_creates_when_missing() {
        let temp = TempConfigDir::new();
        let client = Arc::new(FakeGoogleCalendarClient::default());
        client.set_create_response(GoogleCalendarSummary {
            id: "new-blocks-id".to_string(),
            summary: "Blocks".to_string(),
        });

        let initializer = BlocksCalendarInitializer::new(temp.path(), "default", Arc::clone(&client));
        let result = initializer
            .ensure_blocks_calendar("access-token")
            .await
            .expect("ensure calendar");

        assert_eq!(
            result,
            EnsureBlocksCalendarResult::Created("new-blocks-id".to_string())
        );
        assert_eq!(
            read_blocks_calendar_id(temp.path(), "default").expect("read id"),
            Some("new-blocks-id".to_string())
        );
        assert_eq!(client.list_calls.load(Ordering::SeqCst), 1);
        assert_eq!(client.create_calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            *client
                .last_create_summary
                .lock()
                .expect("summary mutex poisoned"),
            Some("Blocks".to_string())
        );
    }
}
