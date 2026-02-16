use crate::infrastructure::error::InfraError;
use async_trait::async_trait;
use reqwest::Client;

#[derive(Debug, Clone)]
pub struct OAuthCodeExchangeRequest {
    pub token_endpoint: String,
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub authorization_code: String,
}

#[derive(Debug, Clone)]
pub struct OAuthRefreshRequest {
    pub token_endpoint: String,
    pub client_id: String,
    pub client_secret: String,
    pub refresh_token: String,
}

#[derive(Debug, Clone)]
pub struct OAuthTokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: i64,
    pub token_type: Option<String>,
    pub scope: Option<String>,
}

#[async_trait]
pub trait OAuthHttpClient: Send + Sync {
    async fn exchange_authorization_code(
        &self,
        request: OAuthCodeExchangeRequest,
    ) -> Result<OAuthTokenResponse, InfraError>;

    async fn refresh_access_token(
        &self,
        request: OAuthRefreshRequest,
    ) -> Result<OAuthTokenResponse, InfraError>;
}

#[derive(Debug, Clone, Default)]
pub struct ReqwestOAuthClient {
    client: Client,
}

#[derive(Debug, serde::Deserialize)]
struct GoogleTokenResponsePayload {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    token_type: Option<String>,
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

impl ReqwestOAuthClient {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    async fn post_form(
        &self,
        endpoint: &str,
        params: &[(&str, String)],
    ) -> Result<OAuthTokenResponse, InfraError> {
        let response = self
            .client
            .post(endpoint)
            .form(params)
            .send()
            .await
            .map_err(|error| InfraError::OAuth(format!("request failed: {error}")))?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| InfraError::OAuth(format!("failed reading token response: {error}")))?;

        let parsed = serde_json::from_str::<GoogleTokenResponsePayload>(&body).map_err(|error| {
            InfraError::OAuth(format!("invalid token response payload: {error}; body={body}"))
        })?;

        if !status.is_success() || parsed.error.is_some() {
            let code = parsed.error.unwrap_or_else(|| format!("http_{}", status.as_u16()));
            let detail = parsed.error_description.unwrap_or_else(|| body.clone());
            return Err(InfraError::OAuth(format!("token endpoint error: {code}; {detail}")));
        }

        let expires_in = parsed.expires_in.unwrap_or(0).max(0);
        Ok(OAuthTokenResponse {
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token,
            expires_in,
            token_type: parsed.token_type,
            scope: parsed.scope,
        })
    }
}

#[async_trait]
impl OAuthHttpClient for ReqwestOAuthClient {
    async fn exchange_authorization_code(
        &self,
        request: OAuthCodeExchangeRequest,
    ) -> Result<OAuthTokenResponse, InfraError> {
        self.post_form(
            &request.token_endpoint,
            &[
                ("grant_type", "authorization_code".to_string()),
                ("client_id", request.client_id),
                ("client_secret", request.client_secret),
                ("redirect_uri", request.redirect_uri),
                ("code", request.authorization_code),
            ],
        )
        .await
    }

    async fn refresh_access_token(
        &self,
        request: OAuthRefreshRequest,
    ) -> Result<OAuthTokenResponse, InfraError> {
        self.post_form(
            &request.token_endpoint,
            &[
                ("grant_type", "refresh_token".to_string()),
                ("client_id", request.client_id),
                ("client_secret", request.client_secret),
                ("refresh_token", request.refresh_token),
            ],
        )
        .await
    }
}
