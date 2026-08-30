use crate::{
    error::{AppError, AppResult},
    state::{atomic_write_json, ensure_data_version, read_json_or_default, DATA_SCHEMA_VERSION},
};
use parking_lot::RwLock;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    time::Duration,
};
use url::Url;
use uuid::Uuid;

const KEYRING_SERVICE: &str = "com.wpsagent.editor.providers";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub reasoning: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum ProviderProtocol {
    OpenaiCompatible,
    Openai,
    Anthropic,
    Google,
    Bedrock,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ProviderDefinition {
    pub id: String,
    pub name: String,
    pub api: String,
    #[serde(default)]
    pub npm: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub doc: Option<String>,
    #[serde(default)]
    pub env: Vec<String>,
    pub protocol: ProviderProtocol,
    #[serde(default)]
    pub models: Vec<ProviderModel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub default_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub default_api: Option<String>,
    #[serde(default)]
    pub is_api_overridden: bool,
    #[serde(default)]
    pub is_custom: bool,
    #[serde(default)]
    pub is_local: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct CustomProviderConfig {
    #[serde(default)]
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub default_model: String,
    #[serde(default)]
    pub models: Vec<ProviderModel>,
    pub protocol: ProviderProtocol,
    #[serde(default)]
    pub created_at: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomProviderFile {
    version: u32,
    #[serde(default)]
    providers: Vec<CustomProviderConfig>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BaseUrlFile {
    version: u32,
    #[serde(default, alias = "providers")]
    overrides: HashMap<String, String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CredentialIndexFile {
    version: u32,
    #[serde(default)]
    providers: HashSet<String>,
}

impl Default for CustomProviderFile {
    fn default() -> Self {
        Self {
            version: DATA_SCHEMA_VERSION,
            providers: Vec::new(),
        }
    }
}

impl Default for BaseUrlFile {
    fn default() -> Self {
        Self {
            version: DATA_SCHEMA_VERSION,
            overrides: HashMap::new(),
        }
    }
}

impl Default for CredentialIndexFile {
    fn default() -> Self {
        Self {
            version: DATA_SCHEMA_VERSION,
            providers: HashSet::new(),
        }
    }
}

pub struct ProviderStore {
    pub client: Client,
    custom_path: PathBuf,
    base_url_path: PathBuf,
    credential_index_path: PathBuf,
    custom: RwLock<Vec<CustomProviderConfig>>,
    base_urls: RwLock<HashMap<String, String>>,
    credential_index: RwLock<HashSet<String>>,
}

impl ProviderStore {
    pub fn new(app_data_dir: PathBuf) -> AppResult<Self> {
        let custom_path = app_data_dir.join("custom-providers.json");
        let base_url_path = app_data_dir.join("provider-base-urls.json");
        let credential_index_path = app_data_dir.join("credential-index.json");
        let custom = load_custom_providers(&custom_path)?;
        let base_urls: BaseUrlFile = read_json_or_default(&base_url_path)?;
        let credentials: CredentialIndexFile = read_json_or_default(&credential_index_path)?;
        ensure_data_version("provider base URL", base_urls.version)?;
        ensure_data_version("credential index", credentials.version)?;
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .user_agent("WPS-Agent-Editor/2.0")
            .build()?;
        Ok(Self {
            client,
            custom_path,
            base_url_path,
            credential_index_path,
            custom: RwLock::new(custom.providers),
            base_urls: RwLock::new(base_urls.overrides),
            credential_index: RwLock::new(credentials.providers),
        })
    }

    pub fn custom_list(&self) -> Vec<CustomProviderConfig> {
        self.custom.read().clone()
    }

    pub fn custom_save(
        &self,
        mut provider: CustomProviderConfig,
    ) -> AppResult<CustomProviderConfig> {
        provider.name = provider.name.trim().to_owned();
        provider.base_url = validate_base_url(&provider.base_url)?;
        provider.default_model = provider.default_model.trim().to_owned();
        if provider.name.is_empty() || provider.default_model.is_empty() {
            return Err(AppError::invalid(
                "Provider name and default model are required",
            ));
        }
        if provider.id.is_empty() {
            provider.id = format!("custom-{}", Uuid::new_v4());
        }
        if !provider.id.starts_with("custom-") {
            return Err(AppError::invalid(
                "Custom provider id must start with custom-",
            ));
        }
        if provider.created_at == 0 {
            provider.created_at = unix_millis();
        }
        let mut providers = self.custom.write();
        let mut candidate = providers.clone();
        if let Some(existing) = candidate.iter_mut().find(|item| item.id == provider.id) {
            *existing = provider.clone();
        } else {
            candidate.push(provider.clone());
        }
        self.persist_custom(&candidate)?;
        *providers = candidate;
        Ok(provider)
    }

    pub fn custom_delete(&self, id: &str) -> AppResult<bool> {
        let mut providers = self.custom.write();
        let mut candidate = providers.clone();
        let original_len = candidate.len();
        candidate.retain(|provider| provider.id != id);
        let removed = candidate.len() != original_len;
        if removed {
            self.persist_custom(&candidate)?;
            self.set_base_url(id, "")?;
            *providers = candidate;
        }
        Ok(removed)
    }

    pub fn custom_get(&self, id: &str) -> Option<CustomProviderConfig> {
        self.custom
            .read()
            .iter()
            .find(|provider| provider.id == id)
            .cloned()
    }

    pub fn set_base_url(&self, provider_id: &str, base_url: &str) -> AppResult<String> {
        let normalized = if base_url.trim().is_empty() {
            String::new()
        } else {
            validate_base_url(base_url)?
        };
        let mut overrides = self.base_urls.write();
        let mut candidate = overrides.clone();
        if normalized.is_empty() {
            candidate.remove(provider_id);
        } else {
            candidate.insert(provider_id.to_owned(), normalized.clone());
        }
        atomic_write_json(
            &self.base_url_path,
            &BaseUrlFile {
                version: DATA_SCHEMA_VERSION,
                overrides: candidate.clone(),
            },
        )?;
        *overrides = candidate;
        Ok(normalized)
    }

    pub fn base_url(&self, provider_id: &str) -> Option<String> {
        self.base_urls.read().get(provider_id).cloned()
    }

    pub fn auth_status(&self) -> AppResult<HashMap<String, AuthStatus>> {
        let indexed = self.credential_index.read().clone();
        let configured = reconcile_credential_index(&indexed, |provider_id| {
            let entry = keyring::Entry::new(KEYRING_SERVICE, provider_id)?;
            match entry.get_password() {
                Ok(secret) => Ok(!secret.is_empty()),
                Err(keyring::Error::NoEntry) => Ok(false),
                Err(error) => Err(error.into()),
            }
        })?;
        if configured != indexed {
            let mut index = self.credential_index.write();
            self.persist_credential_index(&configured)?;
            *index = configured.clone();
        }
        Ok(configured
            .iter()
            .map(|id| {
                (
                    id.clone(),
                    AuthStatus {
                        configured: true,
                        auth_type: "api",
                    },
                )
            })
            .collect())
    }

    pub fn set_api_key(&self, provider_id: &str, api_key: &str) -> AppResult<()> {
        let provider_id = validate_provider_id(provider_id)?;
        let api_key = api_key.trim();
        if api_key.is_empty() {
            return Err(AppError::invalid("API key cannot be empty"));
        }
        let entry = keyring::Entry::new(KEYRING_SERVICE, provider_id)?;
        let previous = match entry.get_password() {
            Ok(value) => Some(value),
            Err(keyring::Error::NoEntry) => None,
            Err(error) => return Err(error.into()),
        };
        entry.set_password(api_key)?;

        let mut index = self.credential_index.write();
        let mut candidate = index.clone();
        candidate.insert(provider_id.to_owned());
        if let Err(error) = self.persist_credential_index(&candidate) {
            let _ = match previous {
                Some(value) => entry.set_password(&value),
                None => entry.delete_credential(),
            };
            return Err(error);
        }
        *index = candidate;
        Ok(())
    }

    pub fn remove_api_key(&self, provider_id: &str) -> AppResult<()> {
        let provider_id = validate_provider_id(provider_id)?;
        let entry = keyring::Entry::new(KEYRING_SERVICE, provider_id)?;
        let previous = match entry.get_password() {
            Ok(value) => Some(value),
            Err(keyring::Error::NoEntry) => None,
            Err(error) => return Err(error.into()),
        };
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(error.into()),
        }
        let mut index = self.credential_index.write();
        let mut candidate = index.clone();
        candidate.remove(provider_id);
        if let Err(error) = self.persist_credential_index(&candidate) {
            if let Some(value) = previous {
                let _ = entry.set_password(&value);
            }
            return Err(error);
        }
        *index = candidate;
        Ok(())
    }

    pub fn api_key(&self, provider_id: &str) -> AppResult<String> {
        let provider_id = validate_provider_id(provider_id)?;
        keyring::Entry::new(KEYRING_SERVICE, provider_id)?
            .get_password()
            .map_err(Into::into)
    }

    fn persist_custom(&self, providers: &[CustomProviderConfig]) -> AppResult<()> {
        atomic_write_json(
            &self.custom_path,
            &CustomProviderFile {
                version: DATA_SCHEMA_VERSION,
                providers: providers.to_vec(),
            },
        )
    }

    fn persist_credential_index(&self, providers: &HashSet<String>) -> AppResult<()> {
        atomic_write_json(
            &self.credential_index_path,
            &CredentialIndexFile {
                version: DATA_SCHEMA_VERSION,
                providers: providers.clone(),
            },
        )
    }
}

fn reconcile_credential_index<F>(
    indexed: &HashSet<String>,
    mut credential_exists: F,
) -> AppResult<HashSet<String>>
where
    F: FnMut(&str) -> AppResult<bool>,
{
    let mut configured = HashSet::with_capacity(indexed.len());
    for provider_id in indexed {
        if credential_exists(provider_id)? {
            configured.insert(provider_id.clone());
        }
    }
    Ok(configured)
}

fn load_custom_providers(path: &std::path::Path) -> AppResult<CustomProviderFile> {
    match std::fs::read(path) {
        Ok(data) => {
            let file: CustomProviderFile = serde_json::from_slice(&data)?;
            ensure_data_version("custom provider", file.version)?;
            Ok(file)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(CustomProviderFile::default())
        }
        Err(error) => Err(error.into()),
    }
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub configured: bool,
    #[serde(rename = "type")]
    pub auth_type: &'static str,
}

pub fn validate_base_url(value: &str) -> AppResult<String> {
    let mut url = Url::parse(value.trim())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::new(
            "invalid-base-url",
            "Provider URLs cannot contain credentials",
        ));
    }
    let is_loopback = url.host_str().is_some_and(|host| {
        host == "localhost"
            || host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    });
    if url.scheme() != "https" && !(url.scheme() == "http" && is_loopback) {
        return Err(AppError::new(
            "invalid-base-url",
            "Provider URLs must use HTTPS; HTTP is allowed only for loopback hosts",
        ));
    }
    url.set_query(None);
    url.set_fragment(None);
    let normalized = url.as_str().trim_end_matches('/').to_owned();
    Ok(normalized)
}

fn validate_provider_id(value: &str) -> AppResult<&str> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 128
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
    {
        return Err(AppError::invalid("Invalid provider id"));
    }
    Ok(value)
}

fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl From<keyring::Error> for AppError {
    fn from(error: keyring::Error) -> Self {
        match error {
            keyring::Error::NoEntry => {
                AppError::new("credential-not-found", "No API key is stored")
            }
            _ => AppError::new("credential-store-failed", error.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_allows_https_or_loopback_http() {
        assert!(validate_base_url("https://api.example.com/v1/").is_ok());
        assert!(validate_base_url("http://127.0.0.1:11434/v1").is_ok());
        assert!(validate_base_url("http://api.example.com").is_err());
        assert!(validate_base_url("https://user:secret@api.example.com/v1").is_err());
    }

    #[test]
    fn credential_status_drops_stale_index_entries() {
        let indexed = HashSet::from(["present".to_owned(), "deleted".to_owned()]);
        let configured =
            reconcile_credential_index(&indexed, |provider_id| Ok(provider_id == "present"))
                .unwrap();
        assert_eq!(configured, HashSet::from(["present".to_owned()]));
    }

    #[test]
    fn credential_status_propagates_secure_store_failures() {
        let indexed = HashSet::from(["provider".to_owned()]);
        let error = reconcile_credential_index(&indexed, |_| {
            Err(AppError::new("credential-store-failed", "unavailable"))
        })
        .unwrap_err();
        assert_eq!(error.code, "credential-store-failed");
    }

    #[test]
    fn custom_provider_store_rejects_unversioned_and_unknown_data() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("custom-providers.json");
        std::fs::write(&path, b"[]").unwrap();
        assert_eq!(
            load_custom_providers(&path).err().unwrap().code,
            "invalid-data"
        );

        std::fs::write(&path, br#"{"version":2,"providers":[]}"#).unwrap();
        assert_eq!(
            load_custom_providers(&path).err().unwrap().code,
            "unsupported-data-version"
        );
    }

    #[test]
    fn custom_provider_wire_uses_base_url_and_json_number_timestamp() {
        let value = serde_json::json!({
            "id": "custom-example",
            "name": "Example",
            "baseUrl": "https://api.example.com/v1",
            "defaultModel": "example-chat",
            "models": [],
            "protocol": "openai-compatible",
            "createdAt": 1_788_000_000_000_u64,
        });

        let provider: CustomProviderConfig = serde_json::from_value(value).unwrap();
        assert_eq!(provider.base_url, "https://api.example.com/v1");
        assert_eq!(provider.created_at, 1_788_000_000_000);

        let response = serde_json::to_value(provider).unwrap();
        assert_eq!(response["baseUrl"], "https://api.example.com/v1");
        assert!(response.get("baseURL").is_none());
        assert!(response["createdAt"].is_number());
    }
}
