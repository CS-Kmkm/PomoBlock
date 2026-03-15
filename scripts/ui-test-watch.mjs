import { spawn } from "node:child_process";
import process from "node:process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];
let shuttingDown = false;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(" ")} terminated with signal ${signal}`));
        return;
      }
      resolve(code ?? 0);
    });
  });
}

function spawnChild(command, args, name) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (signal) {
      console.error(`[${name}] exited from signal ${signal}`);
      shutdown(1);
      return;
    }

    if (code !== 0 && code !== null) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code);
      return;
    }

    if (name === "build") {
      console.error("[build] watch exited unexpectedly");
      shutdown(code ?? 1);
      return;
    }

    if (name === "test") {
      shutdown(0);
    }
  });

  children.push(child);
  return child;
}

function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
    process.exit(exitCode);
  }, 200);
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

const buildExitCode = await run(npmCommand, ["run", "build:ui"]);
if (buildExitCode !== 0) {
  process.exit(buildExitCode);
}

spawnChild(npmCommand, ["run", "build:ui:watch"], "build");
spawnChild(process.execPath, ["--test", "--watch", "tests/now.test.js"], "test");
