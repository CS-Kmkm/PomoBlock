use crate::domain::models::OAuthToken;
use crate::infrastructure::error::InfraError;
use std::sync::Mutex;

pub trait CredentialStore: Send + Sync {
    fn save_token(&self, token: &OAuthToken) -> Result<(), InfraError>;
    fn load_token(&self) -> Result<Option<OAuthToken>, InfraError>;
    fn delete_token(&self) -> Result<(), InfraError>;
}

#[derive(Debug, Clone)]
pub struct WindowsCredentialManagerStore {
    service_name: String,
    account_name: String,
}

impl WindowsCredentialManagerStore {
    pub fn new(service_name: impl Into<String>, account_name: impl Into<String>) -> Self {
        Self {
            service_name: service_name.into(),
            account_name: account_name.into(),
        }
    }

    fn entry(&self) -> Result<keyring::Entry, InfraError> {
        keyring::Entry::new(&self.service_name, &self.account_name)
            .map_err(|error| InfraError::Credential(error.to_string()))
    }
}

impl Default for WindowsCredentialManagerStore {
    fn default() -> Self {
        Self::new("pomblock.oauth.google", "default")
    }
}

impl CredentialStore for WindowsCredentialManagerStore {
    fn save_token(&self, token: &OAuthToken) -> Result<(), InfraError> {
        let payload =
            serde_json::to_string(token).map_err(|error| InfraError::Credential(error.to_string()))?;
        self.entry()?
            .set_password(&payload)
            .map_err(|error| InfraError::Credential(error.to_string()))
    }

    fn load_token(&self) -> Result<Option<OAuthToken>, InfraError> {
        let payload = match self.entry()?.get_password() {
            Ok(value) => value,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(error) => return Err(InfraError::Credential(error.to_string())),
        };

        let token = serde_json::from_str::<OAuthToken>(&payload)
            .map_err(|error| InfraError::Credential(error.to_string()))?;
        Ok(Some(token))
    }

    fn delete_token(&self) -> Result<(), InfraError> {
        match self.entry()?.delete_credential() {
            Ok(_) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(InfraError::Credential(error.to_string())),
        }
    }
}

#[derive(Debug, Default)]
pub struct InMemoryCredentialStore {
    token: Mutex<Option<OAuthToken>>,
}

impl CredentialStore for InMemoryCredentialStore {
    fn save_token(&self, token: &OAuthToken) -> Result<(), InfraError> {
        let mut guard = self
            .token
            .lock()
            .map_err(|error| InfraError::Credential(format!("in-memory lock poisoned: {error}")))?;
        *guard = Some(token.clone());
        Ok(())
    }

    fn load_token(&self) -> Result<Option<OAuthToken>, InfraError> {
        let guard = self
            .token
            .lock()
            .map_err(|error| InfraError::Credential(format!("in-memory lock poisoned: {error}")))?;
        Ok(guard.clone())
    }

    fn delete_token(&self) -> Result<(), InfraError> {
        let mut guard = self
            .token
            .lock()
            .map_err(|error| InfraError::Credential(format!("in-memory lock poisoned: {error}")))?;
        *guard = None;
        Ok(())
    }
}
