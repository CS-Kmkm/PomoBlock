import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrapWorkspace } from "../src/application/bootstrap.js";

test("bootstrapWorkspace initializes config, state, logs, and sqlite schema", () => {
  const root = mkdtempSync(join(tmpdir(), "pomblock-bootstrap-"));
  const result = bootstrapWorkspace({ workspaceRoot: root });

  assert.equal(existsSync(join(root, "config", "app.json")), true);
  assert.equal(existsSync(join(root, "config", "calendars.json")), true);
  assert.equal(existsSync(join(root, "state")), true);
  assert.equal(existsSync(join(root, "logs")), true);
  assert.equal(existsSync(join(root, "state", "pomblock.sqlite")), true);
  assert.equal(result.config.app.schema, 1);
  assert.equal(result.config.policies.schema, 1);

  rmSync(root, { recursive: true, force: true });
});
