import test from "node:test";
import assert from "node:assert/strict";
import { createMockInvoke } from "../src-ui/dist/mock/mock-invoke.js";

function buildMockInvoke() {
  const mockState = {
    sequence: 1,
    tasks: [],
    blocks: [],
    recipes: [],
    modules: [],
    moduleFolders: [],
    syncedEventsByAccount: {},
    taskAssignmentsByTask: {},
    taskAssignmentsByBlock: {},
    pomodoro: {
      current_block_id: null,
      current_task_id: null,
      phase: "idle",
      remaining_seconds: 0,
      start_time: null,
      total_cycles: 0,
      completed_cycles: 0,
      current_cycle: 0,
      focus_seconds: 0,
      break_seconds: 0,
      paused_phase: null,
    },
    logs: [],
  };

  const seedModules = [
    { id: "mod-a", name: "A", category: "Alpha", durationMinutes: 5, checklist: [], pomodoro: null, executionHints: null },
    { id: "mod-b", name: "B", category: "Alpha", durationMinutes: 5, checklist: [], pomodoro: null, executionHints: null },
    { id: "mod-c", name: "C", category: "Gamma", durationMinutes: 5, checklist: [], pomodoro: null, executionHints: null },
  ];
  const seedFolders = [
    { id: "Alpha", name: "Alpha" },
    { id: "Beta", name: "Beta" },
    { id: "Gamma", name: "Gamma" },
  ];

  return createMockInvoke({
    mockState,
    nextMockId: (prefix) => `${prefix}-${mockState.sequence++}`,
    ensureMockRecipesSeeded: () => {},
    ensureMockModulesSeeded: () => {
      if (mockState.modules.length === 0) {
        mockState.modules = seedModules.map((module) => ({ ...module }));
      }
      if (mockState.moduleFolders.length === 0) {
        mockState.moduleFolders = seedFolders.map((folder) => ({ ...folder }));
      }
    },
    normalizeAccountId: (value) => String(value || "default"),
    nowIso: () => "2026-03-18T00:00:00.000Z",
    isoDate: (value) => value.toISOString().slice(0, 10),
    emptyMockPomodoroState: () => ({
      current_block_id: null,
      current_task_id: null,
      phase: "idle",
      remaining_seconds: 0,
      start_time: null,
      total_cycles: 0,
      completed_cycles: 0,
      current_cycle: 0,
      focus_seconds: 0,
      break_seconds: 0,
      paused_phase: null,
    }),
    mockSessionPlan: () => ({ totalCycles: 1, focusSeconds: 1500, breakSeconds: 300 }),
    appendMockPomodoroLog: () => {},
    unassignMockTask: () => {},
    assignMockTask: () => {},
    toRecord: (value) => (value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {}),
    readString: (payload, key, fallback = "") => (typeof payload[key] === "string" ? payload[key] : fallback),
    readStringArray: (payload, key) => (Array.isArray(payload[key]) ? payload[key].map(String) : []),
    readNestedPayload: (payload) =>
      payload && typeof payload.payload === "object" && payload.payload !== null && !Array.isArray(payload.payload)
        ? { ...payload.payload }
        : {},
    toJsonObject: (value) => (value && typeof value === "object" && !Array.isArray(value) ? { ...value } : null),
  });
}

test("mock move_module inserts into an empty target folder before the next folder group", async () => {
  const mockInvoke = buildMockInvoke();

  const moved = await mockInvoke("move_module", {
    module_id: "mod-b",
    folder_id: "Beta",
  });

  assert.deepEqual(
    moved.map((module) => [module.id, module.category]),
    [
      ["mod-a", "Alpha"],
      ["mod-b", "Beta"],
      ["mod-c", "Gamma"],
    ],
  );
});

test("mock move_module respects before_module_id within the target folder", async () => {
  const mockInvoke = buildMockInvoke();

  await mockInvoke("move_module", {
    module_id: "mod-b",
    folder_id: "Beta",
  });
  const moved = await mockInvoke("move_module", {
    module_id: "mod-a",
    folder_id: "Beta",
    before_module_id: "mod-b",
  });

  assert.deepEqual(
    moved.map((module) => [module.id, module.category]),
    [
      ["mod-a", "Beta"],
      ["mod-b", "Beta"],
      ["mod-c", "Gamma"],
    ],
  );
});

test("mock update_module applies durationMinutes from camelCase payloads", async () => {
  const mockInvoke = buildMockInvoke();

  const updated = await mockInvoke("update_module", {
    module_id: "mod-a",
    payload: {
      name: "A Updated",
      category: "Alpha",
      durationMinutes: 15,
    },
  });

  assert.equal(updated.durationMinutes, 15);
  assert.equal(updated.name, "A Updated");
});
