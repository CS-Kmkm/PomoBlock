import { mkdirSync } from "node:fs";
import {
  ensureDefaultConfigFiles,
  loadConfigBundle,
  resolveWorkspacePaths,
  type WorkspacePaths,
} from "../config/index.js";
import { LocalStorageRepository } from "../infrastructure/localStorageRepository.js";

type BootstrapOptions = {
  workspaceRoot?: string;
};

type BootstrapResult = {
  paths: WorkspacePaths;
  config: unknown;
};

export function bootstrapWorkspace(options: BootstrapOptions = {}): BootstrapResult {
  const paths = resolveWorkspacePaths(options.workspaceRoot);
  mkdirSync(paths.stateDir, { recursive: true });
  mkdirSync(paths.logsDir, { recursive: true });

  ensureDefaultConfigFiles(paths.configDir);
  const config = loadConfigBundle(paths.configDir);
  const schema = (config as { app?: { schema?: unknown } }).app?.schema ?? null;

  const repository = new LocalStorageRepository(paths.databasePath);
  repository.initSchema();
  repository.appendAuditLog("bootstrap", {
    schema,
    initializedAt: new Date().toISOString(),
  });
  repository.close();

  return {
    paths,
    config,
  };
}
// Legacy reference implementation during the Rust backend migration.
// Workspace bootstrap for product usage is sourced from `src-tauri/`.
