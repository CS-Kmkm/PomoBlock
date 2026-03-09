import { bootstrapWorkspace } from "./application/bootstrap.js";
import { resolveWorkspacePaths, type WorkspacePaths } from "./config/paths.js";

function printStatus(paths: WorkspacePaths): void {
  process.stdout.write(`workspace: ${paths.workspaceRoot}\n`);
  process.stdout.write(`configDir: ${paths.configDir}\n`);
  process.stdout.write(`stateDir: ${paths.stateDir}\n`);
  process.stdout.write(`logsDir: ${paths.logsDir}\n`);
  process.stdout.write(`database: ${paths.databasePath}\n`);
}

function run(): void {
  const command = process.argv[2] ?? "init";
  const workspaceRoot = process.argv[3];

  if (command === "init") {
    const result = bootstrapWorkspace(workspaceRoot ? { workspaceRoot } : {});
    process.stdout.write("PomBlock bootstrap completed.\n");
    printStatus(result.paths);
    return;
  }

  if (command === "status") {
    printStatus(resolveWorkspacePaths(workspaceRoot));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

run();
// Legacy reference implementation during the Rust backend migration.
// `npm run init` and `npm run status` are served by the Rust CLI.
