import { mkdirSync } from "node:fs";
import { ensureDefaultConfigFiles, loadConfigBundle, resolveWorkspacePaths } from "../config/index.js";
import { LocalStorageRepository } from "../infrastructure/localStorageRepository.js";

export function bootstrapWorkspace(options = {}) {
  const paths = resolveWorkspacePaths(options.workspaceRoot);
  mkdirSync(paths.stateDir, { recursive: true });
  mkdirSync(paths.logsDir, { recursive: true });

  ensureDefaultConfigFiles(paths.configDir);
  const config = loadConfigBundle(paths.configDir);

  const repository = new LocalStorageRepository(paths.databasePath);
  repository.initSchema();
  repository.appendAuditLog("bootstrap", {
    schema: config.app.schema,
    initializedAt: new Date().toISOString(),
  });
  repository.close();

  return {
    paths,
    config,
  };
}
