import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_WORKSPACE_ROOT = resolve(__dirname, "..", "..");

export function resolveWorkspacePaths(workspaceRoot = DEFAULT_WORKSPACE_ROOT) {
  const root = resolve(workspaceRoot);
  return Object.freeze({
    workspaceRoot: root,
    configDir: resolve(root, "config"),
    stateDir: resolve(root, "state"),
    logsDir: resolve(root, "logs"),
    databasePath: resolve(root, "state", "pomblock.sqlite"),
  });
}
