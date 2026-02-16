import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RoutineManager } from "../src/application/routineManager.js";
import { GitRepository } from "../src/infrastructure/gitRepository.js";

function createContext() {
  const tempDir = mkdtempSync(join(tmpdir(), "pomblock-git-sync-"));
  const repository = GitRepository.init(tempDir);
  const routineManager = new RoutineManager({ gitRepository: repository });
  return { tempDir, repository, routineManager };
}

function cleanupContext({ tempDir }) {
  rmSync(tempDir, { recursive: true, force: true });
}

test("Feature: blocksched, Property 4: sensitive files are excluded from git commit flow", () => {
  const context = createContext();
  try {
    context.repository.writeFile("config/policy.json", "{ \"schema\": 1 }\n");
    context.repository.commitAndPush("safe commit", ["config/policy.json"]);
    assert.equal(context.repository.readHistory().length, 1);

    assert.throws(
      () => context.repository.commitAndPush("bad commit", ["state/oauth_token.json"]),
      /sensitive path cannot be committed/
    );
    assert.throws(
      () => context.repository.commitAndPush("bad commit", ["logs/error.log"]),
      /sensitive path cannot be committed/
    );
  } finally {
    cleanupContext(context);
  }
});

test("Feature: blocksched, Property 27: routine/template/policy can round-trip through git repository", () => {
  const context = createContext();
  try {
    for (let run = 0; run < 30; run += 1) {
      const routine = {
        id: `routine-${run}`,
        name: `Routine ${run}`,
        schedule: { type: "Daily", time: "09:30" },
        templateId: `template-${run}`,
      };
      const template = {
        id: `template-${run}`,
        name: `Template ${run}`,
        durationMinutes: 60 + run,
        defaultTasks: [`task-${run}`],
      };
      const policy = {
        workHours: {
          start: "09:00",
          end: "18:00",
          days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        },
        blockDurationMinutes: 50 + (run % 4) * 10,
        breakDurationMinutes: 10,
        minBlockGapMinutes: 5,
      };

      context.routineManager.saveRoutine(routine);
      context.routineManager.saveTemplate(template);
      context.routineManager.savePolicy(policy);

      context.repository.writeFile(`.pomblock/routines/${routine.id}.json`, "{}\n");
      context.repository.writeFile(`.pomblock/templates/${template.id}.json`, "{}\n");
      context.repository.writeFile(".pomblock/policy.json", "{}\n");

      const synced = context.routineManager.syncWithGit();
      const loadedRoutine = synced.routines.find((row) => row.id === routine.id);
      const loadedTemplate = synced.templates.find((row) => row.id === template.id);

      assert.deepEqual(loadedRoutine, routine);
      assert.deepEqual(loadedTemplate, template);
      assert.deepEqual(synced.policy, policy);
    }
  } finally {
    cleanupContext(context);
  }
});

test("Feature: blocksched, Property 28: remote git updates are reflected after sync", () => {
  const context = createContext();
  try {
    const routine = {
      id: "routine-remote",
      name: "Local Routine",
      schedule: { type: "Weekly", day: "Monday", time: "10:00" },
      templateId: "template-remote",
    };
    context.routineManager.saveRoutine(routine);

    const updatedRoutine = {
      ...routine,
      name: "Remote Updated Routine",
      schedule: { type: "Weekly", day: "Tuesday", time: "11:00" },
    };
    context.repository.writeRemoteFile(
      `.pomblock/routines/${routine.id}.json`,
      `${JSON.stringify(updatedRoutine, null, 2)}\n`
    );

    const synced = context.routineManager.syncWithGit();
    const loadedRoutine = synced.routines.find((row) => row.id === routine.id);
    assert.deepEqual(loadedRoutine, updatedRoutine);
  } finally {
    cleanupContext(context);
  }
});
