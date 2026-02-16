use crate::domain::models::OAuthToken;
use crate::infrastructure::credential_store::CredentialStore;
use crate::infrastructure::error::InfraError;
use crate::infrastructure::oauth_client::{
    OAuthCodeExchangeRequest, OAuthHttpClient, OAuthRefreshRequest, OAuthTokenResponse,
};
use chrono::{DateTime, Duration, Utc};
use std::sync::Arc;
use url::Url;

const DEFAULT_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const DEFAULT_AUTHORIZATION_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";

#[derive(Debug, Clone)]
pub struct OAuthConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub scopes: Vec<String>,
    pub token_endpoint: String,
    pub authorization_endpoint: String,
}

impl OAuthConfig {
    pub fn new(
        client_id: impl Into<String>,
        client_secret: impl Into<String>,
        redirect_uri: impl Into<String>,
        scopes: Vec<String>,
    ) -> Self {
        Self {
            client_id: client_id.into(),
            client_secret: client_secret.into(),
            redirect_uri: redirect_uri.into(),
            scopes,
            token_endpoint: DEFAULT_TOKEN_ENDPOINT.to_string(),
            authorization_endpoint: DEFAULT_AUTHORIZATION_ENDPOINT.to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnsureTokenResult {
    Existing(OAuthToken),
    Refreshed(OAuthToken),
    ReauthenticationRequired,
}

type NowProvider = Arc<dyn Fn() -> DateTime<Utc> + Send + Sync>;

pub struct OAuthManager<S, C>
where
    S: CredentialStore,
    C: OAuthHttpClient,
{
    config: OAuthConfig,
    credential_store: Arc<S>,
    oauth_client: Arc<C>,
    now_provider: NowProvider,
}

impl<S, C> OAuthManager<S, C>
where
    S: CredentialStore,
    C: OAuthHttpClient,
{
    pub fn new(config: OAuthConfig, credential_store: Arc<S>, oauth_client: Arc<C>) -> Self {
        Self {
            config,
            credential_store,
            oauth_client,
            now_provider: Arc::new(Utc::now),
        }
    }

    pub fn with_now_provider(mut self, now_provider: NowProvider) -> Self {
        self.now_provider = now_provider;
        self
    }

    pub fn is_token_valid(&self, token: &OAuthToken) -> bool {
        token.is_valid_at((self.now_provider)(), 60)
    }

    pub fn build_authorization_url(&self, state: &str) -> Result<String, InfraError> {
        if state.trim().is_empty() {
            return Err(InfraError::OAuth("state must not be empty".to_string()));
        }
        if self.config.scopes.is_empty() {
            return Err(InfraError::OAuth("at least one scope is required".to_string()));
        }

        let mut url = Url::parse(&self.config.authorization_endpoint)
            .map_err(|error| InfraError::OAuth(format!("invalid authorization endpoint: {error}")))?;
        let scope = self.config.scopes.join(" ");

        url.query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", &self.config.client_id)
            .append_pair("redirect_uri", &self.config.redirect_uri)
            .append_pair("scope", &scope)
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent")
            .append_pair("state", state);

        Ok(url.to_string())
    }

    pub async fn authenticate_with_code(&self, authorization_code: &str) -> Result<OAuthToken, InfraError> {
        if authorization_code.trim().is_empty() {
            return Err(InfraError::OAuth("authorization code must not be empty".to_string()));
        }

        let response = self
            .oauth_client
            .exchange_authorization_code(OAuthCodeExchangeRequest {
                token_endpoint: self.config.token_endpoint.clone(),
                client_id: self.config.client_id.clone(),
                client_secret: self.config.client_secret.clone(),
                redirect_uri: self.config.redirect_uri.clone(),
                authorization_code: authorization_code.to_string(),
            })
            .await?;

        let token = self.token_from_response(response, None);
        self.credential_store.save_token(&token)?;
        Ok(token)
    }

    pub async fn ensure_access_token(&self) -> Result<EnsureTokenResult, InfraError> {
        let Some(stored_token) = self.credential_store.load_token()? else {
            return Ok(EnsureTokenResult::ReauthenticationRequired);
        };

        if self.is_token_valid(&stored_token) {
            return Ok(EnsureTokenResult::Existing(stored_token));
        }

        if let Some(refresh_token) = stored_token.refresh_token.clone() {
            let refreshed = self
                .oauth_client
                .refresh_access_token(OAuthRefreshRequest {
                    token_endpoint: self.config.token_endpoint.clone(),
                    client_id: self.config.client_id.clone(),
                    client_secret: self.config.client_secret.clone(),
                    refresh_token,
                })
                .await;

            match refreshed {
                Ok(response) => {
                    let token =
                        self.token_from_response(response, stored_token.refresh_token.clone());
                    self.credential_store.save_token(&token)?;
                    Ok(EnsureTokenResult::Refreshed(token))
                }
                Err(InfraError::OAuth(_)) => Ok(EnsureTokenResult::ReauthenticationRequired),
                Err(error) => Err(error),
            }
        } else {
            Ok(EnsureTokenResult::ReauthenticationRequired)
        }
    }

    pub fn clear_stored_token(&self) -> Result<(), InfraError> {
        self.credential_store.delete_token()
    }

    fn token_from_response(
        &self,
        response: OAuthTokenResponse,
        fallback_refresh_token: Option<String>,
    ) -> OAuthToken {
        let expires_at = (self.now_provider)() + Duration::seconds(response.expires_in.max(0));
        OAuthToken {
            access_token: response.access_token,
            refresh_token: response.refresh_token.or(fallback_refresh_token),
            expires_at,
            token_type: response.token_type.unwrap_or_else(|| "Bearer".to_string()),
            scope: response.scope,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::credential_store::InMemoryCredentialStore;
    use async_trait::async_trait;
    use proptest::prelude::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    #[derive(Debug, Clone)]
    enum FakeResponse {
        Success(OAuthTokenResponse),
        OAuthError(String),
    }

    impl Default for FakeResponse {
        fn default() -> Self {
            Self::Success(OAuthTokenResponse {
                access_token: "fake_access".to_string(),
                refresh_token: Some("fake_refresh".to_string()),
                expires_in: 3600,
                token_type: Some("Bearer".to_string()),
                scope: Some("scope-a scope-b".to_string()),
            })
        }
    }

    #[derive(Debug, Default)]
    struct FakeOAuthHttpClient {
        exchange_response: Mutex<FakeResponse>,
        refresh_response: Mutex<FakeResponse>,
        exchange_calls: AtomicUsize,
        refresh_calls: AtomicUsize,
    }

    impl FakeOAuthHttpClient {
        fn set_exchange_response(&self, response: FakeResponse) {
            let mut guard = self.exchange_response.lock().expect("exchange mutex poisoned");
            *guard = response;
        }

        fn set_refresh_response(&self, response: FakeResponse) {
            let mut guard = self.refresh_response.lock().expect("refresh mutex poisoned");
            *guard = response;
        }
    }

    #[async_trait]
    impl OAuthHttpClient for FakeOAuthHttpClient {
        async fn exchange_authorization_code(
            &self,
            _request: OAuthCodeExchangeRequest,
        ) -> Result<OAuthTokenResponse, InfraError> {
            self.exchange_calls.fetch_add(1, Ordering::SeqCst);
            match self
                .exchange_response
                .lock()
                .expect("exchange mutex poisoned")
                .clone()
            {
                FakeResponse::Success(value) => Ok(value),
                FakeResponse::OAuthError(message) => Err(InfraError::OAuth(message)),
            }
        }

        async fn refresh_access_token(
            &self,
            _request: OAuthRefreshRequest,
        ) -> Result<OAuthTokenResponse, InfraError> {
            self.refresh_calls.fetch_add(1, Ordering::SeqCst);
            match self
                .refresh_response
                .lock()
                .expect("refresh mutex poisoned")
                .clone()
            {
                FakeResponse::Success(value) => Ok(value),
                FakeResponse::OAuthError(message) => Err(InfraError::OAuth(message)),
            }
        }
    }

    fn test_config() -> OAuthConfig {
        OAuthConfig::new(
            "client-id",
            "client-secret",
            "http://localhost/oauth2/callback",
            vec![
                "https://www.googleapis.com/auth/calendar".to_string(),
                "openid".to_string(),
            ],
        )
    }

    fn token_pattern() -> impl Strategy<Value = String> {
        "[A-Za-z0-9._\\-]{1,64}".prop_map(|value| value.to_string())
    }

    fn arb_oauth_token() -> impl Strategy<Value = OAuthToken> {
        (
            token_pattern(),
            prop::option::of(token_pattern()),
            120i64..604800i64,
            prop::option::of(token_pattern()),
            token_pattern(),
        )
            .prop_map(
                |(access_token, refresh_token, expires_in_seconds, scope, token_type)| OAuthToken {
                    access_token,
                    refresh_token,
                    expires_at: Utc::now() + Duration::seconds(expires_in_seconds),
                    token_type,
                    scope,
                },
            )
    }

    // Feature: blocksched, Property 1: OAuth token round-trip
    proptest! {
        #[test]
        fn property1_oauth_token_roundtrip(token in arb_oauth_token()) {
            let store = InMemoryCredentialStore::default();
            store.save_token(&token).expect("save token");
            let loaded = store.load_token().expect("load token").expect("token exists");
            prop_assert_eq!(loaded, token);
        }
    }

    // Feature: blocksched, Property 2: valid token should not trigger re-authentication
    proptest! {
        #[test]
        fn property2_valid_token_no_reauthentication(
            token in arb_oauth_token()
        ) {
            let runtime = tokio::runtime::Runtime::new().expect("runtime");
            runtime.block_on(async move {
                let store = Arc::new(InMemoryCredentialStore::default());
                store.save_token(&token).expect("save token");

                let client = Arc::new(FakeOAuthHttpClient::default());
                let manager = OAuthManager::new(test_config(), Arc::clone(&store), Arc::clone(&client));
                let result = manager.ensure_access_token().await.expect("ensure token");

                assert!(matches!(result, EnsureTokenResult::Existing(_)));
                assert_eq!(client.exchange_calls.load(Ordering::SeqCst), 0);
                assert_eq!(client.refresh_calls.load(Ordering::SeqCst), 0);
            });
        }
    }

    // Feature: blocksched, Property 3: invalid token should trigger re-authentication flow
    proptest! {
        #[test]
        fn property3_invalid_token_requires_reauthentication(
            access_token in token_pattern(),
            refresh_token in prop::option::of(token_pattern()),
            token_type in token_pattern(),
            scope in prop::option::of(token_pattern()),
            expired_seconds_ago in 1i64..86400i64
        ) {
            let runtime = tokio::runtime::Runtime::new().expect("runtime");
            runtime.block_on(async move {
                let expired = OAuthToken {
                    access_token,
                    refresh_token: refresh_token.clone(),
                    expires_at: Utc::now() - Duration::seconds(expired_seconds_ago),
                    token_type,
                    scope,
                };

                let store = Arc::new(InMemoryCredentialStore::default());
                store.save_token(&expired).expect("save token");

                let client = Arc::new(FakeOAuthHttpClient::default());
                client.set_refresh_response(FakeResponse::OAuthError("invalid_grant".to_string()));

                let manager = OAuthManager::new(test_config(), Arc::clone(&store), Arc::clone(&client));
                let result = manager.ensure_access_token().await.expect("ensure token");

                assert_eq!(result, EnsureTokenResult::ReauthenticationRequired);
                if refresh_token.is_some() {
                    assert_eq!(client.refresh_calls.load(Ordering::SeqCst), 1);
                } else {
                    assert_eq!(client.refresh_calls.load(Ordering::SeqCst), 0);
                }
            });
        }
    }

    #[tokio::test]
    async fn expired_token_with_refresh_token_is_refreshed() {
        let store = Arc::new(InMemoryCredentialStore::default());
        let expired = OAuthToken {
            access_token: "expired-token".to_string(),
            refresh_token: Some("refresh-token".to_string()),
            expires_at: Utc::now() - Duration::seconds(120),
            token_type: "Bearer".to_string(),
            scope: Some("scope-a".to_string()),
        };
        store.save_token(&expired).expect("save token");

        let client = Arc::new(FakeOAuthHttpClient::default());
        client.set_refresh_response(FakeResponse::Success(OAuthTokenResponse {
            access_token: "new-access-token".to_string(),
            refresh_token: None,
            expires_in: 3600,
            token_type: Some("Bearer".to_string()),
            scope: Some("scope-a".to_string()),
        }));

        let manager = OAuthManager::new(test_config(), Arc::clone(&store), Arc::clone(&client));
        let result = manager.ensure_access_token().await.expect("ensure access token");

        match result {
            EnsureTokenResult::Refreshed(token) => {
                assert_eq!(token.access_token, "new-access-token");
                assert_eq!(token.refresh_token, Some("refresh-token".to_string()));
            }
            _ => panic!("expected refreshed result"),
        }
    }

    #[tokio::test]
    async fn authenticate_with_code_saves_token_to_store() {
        let store = Arc::new(InMemoryCredentialStore::default());
        let client = Arc::new(FakeOAuthHttpClient::default());
        client.set_exchange_response(FakeResponse::Success(OAuthTokenResponse {
            access_token: "code-access-token".to_string(),
            refresh_token: Some("code-refresh-token".to_string()),
            expires_in: 1800,
            token_type: Some("Bearer".to_string()),
            scope: Some("scope-a scope-b".to_string()),
        }));

        let manager = OAuthManager::new(test_config(), Arc::clone(&store), Arc::clone(&client));
        let token = manager
            .authenticate_with_code("sample-code")
            .await
            .expect("authenticate with code");
        assert_eq!(token.access_token, "code-access-token");
        assert_eq!(token.refresh_token, Some("code-refresh-token".to_string()));

        let loaded = store
            .load_token()
            .expect("load token")
            .expect("token is stored");
        assert_eq!(loaded.access_token, "code-access-token");
    }
}
