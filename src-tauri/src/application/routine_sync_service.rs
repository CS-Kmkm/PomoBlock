use crate::domain::models::{Policy, Routine, Template};
use crate::infrastructure::error::InfraError;
use crate::infrastructure::git_backed_config::GitBackedConfigRepository;

const ROUTINES_DIR: &str = ".pomblock/routines";
const TEMPLATES_DIR: &str = ".pomblock/templates";
const POLICY_PATH: &str = ".pomblock/policy.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoutineSyncSnapshot {
    pub routines: Vec<Routine>,
    pub templates: Vec<Template>,
    pub policy: Option<Policy>,
}

pub struct RoutineSyncService {
    repository: GitBackedConfigRepository,
}

impl RoutineSyncService {
    pub fn new(repository: GitBackedConfigRepository) -> Self {
        Self { repository }
    }

    pub fn load_routines(&self) -> Result<Vec<Routine>, InfraError> {
        self.load_entities::<Routine>(ROUTINES_DIR)
    }

    pub fn save_routine(&self, routine: &Routine) -> Result<(), InfraError> {
        routine
            .validate()
            .map_err(InfraError::InvalidConfig)?;
        let file_path = format!("{ROUTINES_DIR}/{}.json", routine.id);
        self.repository.write_file(
            &file_path,
            &format!("{}\n", serde_json::to_string_pretty(routine)?),
        )?;
        self.repository
            .commit_and_push(&format!("save routine: {}", routine.id), &[file_path])?;
        Ok(())
    }

    pub fn load_templates(&self) -> Result<Vec<Template>, InfraError> {
        self.load_entities::<Template>(TEMPLATES_DIR)
    }

    pub fn save_template(&self, template: &Template) -> Result<(), InfraError> {
        template
            .validate()
            .map_err(InfraError::InvalidConfig)?;
        let file_path = format!("{TEMPLATES_DIR}/{}.json", template.id);
        self.repository.write_file(
            &file_path,
            &format!("{}\n", serde_json::to_string_pretty(template)?),
        )?;
        self.repository
            .commit_and_push(&format!("save template: {}", template.id), &[file_path])?;
        Ok(())
    }

    pub fn save_policy(&self, policy: &Policy) -> Result<(), InfraError> {
        policy
            .validate()
            .map_err(InfraError::InvalidConfig)?;
        self.repository.write_file(
            POLICY_PATH,
            &format!("{}\n", serde_json::to_string_pretty(policy)?),
        )?;
        self.repository
            .commit_and_push("save policy", &[POLICY_PATH.to_string()])?;
        Ok(())
    }

    pub fn load_policy(&self) -> Result<Option<Policy>, InfraError> {
        match self.repository.read_file(POLICY_PATH) {
            Ok(raw) => Ok(Some(serde_json::from_str(&raw)?)),
            Err(InfraError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub fn sync_with_git(&self) -> Result<RoutineSyncSnapshot, InfraError> {
        self.repository.pull()?;
        Ok(RoutineSyncSnapshot {
            routines: self.load_routines()?,
            templates: self.load_templates()?,
            policy: self.load_policy()?,
        })
    }

    #[cfg(test)]
    fn repository(&self) -> &GitBackedConfigRepository {
        &self.repository
    }

    fn load_entities<T>(&self, relative_dir: &str) -> Result<Vec<T>, InfraError>
    where
        T: serde::de::DeserializeOwned,
    {
        let file_names = self
            .repository
            .list_files(relative_dir)?
            .into_iter()
            .filter(|file_name| file_name.ends_with(".json"))
            .collect::<Vec<_>>();

        let mut entities = Vec::new();
        for file_name in file_names {
            let full_path = format!("{relative_dir}/{file_name}");
            let raw = self.repository.read_file(&full_path)?;
            entities.push(serde_json::from_str(&raw)?);
        }
        Ok(entities)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::models::{
        AutoDriveMode, Firmness, GenerationPolicy, PlacementStrategy, PolicyOverride,
        RoutineDefault, RoutineException, WorkHours,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_repo_path(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir().join(format!("pomoblock-{label}-{nanos}"))
    }

    fn sample_policy() -> Policy {
        let mut policy = Policy {
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
            block_duration_minutes: 60,
            break_duration_minutes: 5,
            min_block_gap_minutes: 0,
        };
        policy = policy.apply_override(&PolicyOverride {
            work_hours: None,
            block_duration_minutes: Some(75),
            break_duration_minutes: Some(10),
            min_block_gap_minutes: Some(5),
        });
        policy
    }

    fn sample_routine(id: &str) -> Routine {
        Routine {
            id: id.to_string(),
            name: format!("Routine {id}"),
            rrule: "FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR".to_string(),
            recipe_id: "rcp-deep-default".to_string(),
            auto_drive_mode: Some(AutoDriveMode::Auto),
            default_rule: RoutineDefault {
                start: "09:30".to_string(),
                duration_minutes: 90,
                pomodoros: 2,
                firmness: Firmness::Draft,
            },
            exceptions: vec![RoutineException {
                skip_dates: vec!["2026-02-21".to_string()],
            }],
            carryover: true,
        }
    }

    fn sample_template(id: &str) -> Template {
        Template {
            id: id.to_string(),
            name: format!("Template {id}"),
            duration_minutes: 75,
            default_tasks: vec!["tsk-1".to_string()],
        }
    }

    fn create_context(label: &str) -> (PathBuf, RoutineSyncService) {
        let repo_path = temp_repo_path(label);
        let repository = GitBackedConfigRepository::new(&repo_path).expect("create repository");
        let service = RoutineSyncService::new(repository);
        (repo_path, service)
    }

    fn cleanup(path: &PathBuf) {
        let _ = fs::remove_dir_all(path);
    }

    // Feature: blocksched, Property 4: sensitive files are excluded from git commit flow
    #[test]
    fn property4_sensitive_files_are_excluded_from_git_commit_flow() {
        let (path, service) = create_context("git-sensitive");
        let repository = service.repository();
        repository
            .write_file("config/policy.json", "{ \"schema\": 1 }\n")
            .expect("write safe file");
        repository
            .commit_and_push("safe commit", &["config/policy.json".to_string()])
            .expect("commit safe file");

        let history = repository.read_history().expect("read history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].message, "safe commit");
        assert_eq!(history[0].files, vec!["config/policy.json".to_string()]);

        let token_error = repository
            .commit_and_push("bad commit", &["state/oauth_token.json".to_string()])
            .expect_err("reject oauth token");
        assert!(token_error.to_string().contains("sensitive path cannot be committed"));

        let log_error = repository
            .commit_and_push("bad commit", &["logs/error.log".to_string()])
            .expect_err("reject log file");
        assert!(log_error.to_string().contains("sensitive path cannot be committed"));

        cleanup(&path);
    }

    // Feature: blocksched, Property 27: routine/template/policy can round-trip through git repository
    #[test]
    fn property27_routine_template_policy_roundtrip_through_git_repository() {
        let (path, service) = create_context("git-roundtrip");
        for index in 0..12 {
            let routine = sample_routine(&format!("routine-{index}"));
            let template = sample_template(&format!("template-{index}"));
            let policy = sample_policy();

            service.save_routine(&routine).expect("save routine");
            service.save_template(&template).expect("save template");
            service.save_policy(&policy).expect("save policy");

            service
                .repository()
                .write_file(&format!("{ROUTINES_DIR}/{}.json", routine.id), "{}\n")
                .expect("mutate local routine");
            service
                .repository()
                .write_file(&format!("{TEMPLATES_DIR}/{}.json", template.id), "{}\n")
                .expect("mutate local template");
            service
                .repository()
                .write_file(POLICY_PATH, "{}\n")
                .expect("mutate local policy");

            let synced = service.sync_with_git().expect("sync with git");
            assert!(synced.routines.iter().any(|candidate| candidate == &routine));
            assert!(synced.templates.iter().any(|candidate| candidate == &template));
            assert_eq!(synced.policy, Some(policy));
        }

        cleanup(&path);
    }

    // Feature: blocksched, Property 28: remote git updates are reflected after sync
    #[test]
    fn property28_remote_git_updates_are_reflected_after_sync() {
        let (path, service) = create_context("git-remote");
        let routine = sample_routine("routine-remote");
        service.save_routine(&routine).expect("save routine");

        let updated_routine = Routine {
            name: "Remote Updated Routine".to_string(),
            default_rule: RoutineDefault {
                start: "11:00".to_string(),
                ..routine.default_rule.clone()
            },
            ..routine.clone()
        };
        service
            .repository()
            .write_remote_file(
                &format!("{ROUTINES_DIR}/{}.json", routine.id),
                &format!("{}\n", serde_json::to_string_pretty(&updated_routine).expect("serialize")),
            )
            .expect("write remote routine");

        let synced = service.sync_with_git().expect("sync with remote");
        assert!(synced.routines.iter().any(|candidate| candidate == &updated_routine));

        cleanup(&path);
    }
}
