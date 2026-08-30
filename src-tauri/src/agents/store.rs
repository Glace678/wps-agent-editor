use crate::{
    error::{AppError, AppResult},
    state::{atomic_write_json, ensure_data_version, DATA_SCHEMA_VERSION},
};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default, alias = "provider")]
    pub provider_id: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub reasoning: Option<serde_json::Value>,
    #[serde(default = "default_agent_color")]
    pub color: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub description: Option<String>,
}

fn default_agent_color() -> String {
    "#6366f1".to_owned()
}

fn default_enabled() -> bool {
    true
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentFile {
    version: u32,
    #[serde(default)]
    agents: Vec<AgentConfig>,
}

impl Default for AgentFile {
    fn default() -> Self {
        Self {
            version: DATA_SCHEMA_VERSION,
            agents: Vec::new(),
        }
    }
}

pub struct AgentStore {
    path: PathBuf,
    agents: RwLock<Vec<AgentConfig>>,
}

impl AgentStore {
    pub fn new(path: PathBuf) -> AppResult<Self> {
        let file = match std::fs::read(&path) {
            Ok(data) => serde_json::from_slice::<AgentFile>(&data)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => AgentFile::default(),
            Err(error) => return Err(error.into()),
        };
        ensure_data_version("agent configuration", file.version)?;
        Ok(Self {
            path,
            agents: RwLock::new(file.agents),
        })
    }

    pub fn list(&self) -> Vec<AgentConfig> {
        self.agents.read().clone()
    }

    pub fn save(&self, mut config: AgentConfig) -> AppResult<AgentConfig> {
        config.id = config.id.trim().to_owned();
        config.name = config.name.trim().to_owned();
        if config.id.is_empty() || config.name.is_empty() {
            return Err(AppError::invalid("Agent id and name are required"));
        }
        let mut agents = self.agents.write();
        let mut candidate = agents.clone();
        if let Some(existing) = candidate.iter_mut().find(|agent| agent.id == config.id) {
            *existing = config.clone();
        } else {
            candidate.push(config.clone());
        }
        atomic_write_json(
            &self.path,
            &AgentFile {
                version: DATA_SCHEMA_VERSION,
                agents: candidate.clone(),
            },
        )?;
        *agents = candidate;
        Ok(config)
    }

    pub fn delete(&self, id: &str) -> AppResult<bool> {
        let mut agents = self.agents.write();
        let mut candidate = agents.clone();
        let original_len = candidate.len();
        candidate.retain(|agent| agent.id != id);
        let removed = original_len != candidate.len();
        if removed {
            atomic_write_json(
                &self.path,
                &AgentFile {
                    version: DATA_SCHEMA_VERSION,
                    agents: candidate.clone(),
                },
            )?;
            *agents = candidate;
        }
        Ok(removed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_store_round_trips() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("agents.json");
        let store = AgentStore::new(path.clone()).unwrap();
        store
            .save(AgentConfig {
                id: "writer".into(),
                name: "Writer".into(),
                role: "writer".into(),
                provider_id: "openai".into(),
                model: "gpt".into(),
                system_prompt: String::new(),
                reasoning: None,
                color: "#6366f1".into(),
                enabled: true,
                description: None,
            })
            .unwrap();
        assert_eq!(AgentStore::new(path).unwrap().list().len(), 1);
    }

    #[test]
    fn agent_store_rejects_unversioned_and_unknown_data() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("agents.json");
        std::fs::write(&path, b"[]").unwrap();
        assert_eq!(
            AgentStore::new(path.clone()).err().unwrap().code,
            "invalid-data"
        );

        std::fs::write(&path, br#"{"version":2,"agents":[]}"#).unwrap();
        assert_eq!(
            AgentStore::new(path).err().unwrap().code,
            "unsupported-data-version"
        );
    }
}
