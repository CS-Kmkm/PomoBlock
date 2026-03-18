import test from "node:test";
import assert from "node:assert/strict";
import { buildStudioRecipePayload } from "../src-ui/dist/pages/routines/studio/actions.js";
import { buildStudioModulePayload } from "../src-ui/dist/pages/routines/studio/actions.js";
import { bootstrapStudioState, syncStudioFromRecipe } from "../src-ui/dist/pages/routines/studio/lifecycle.js";
import { buildStudioAssets } from "../src-ui/dist/pages/routines/studio/assets.js";

test("buildStudioRecipePayload preserves routine-studio step metadata and context", () => {
  const payload = buildStudioRecipePayload({
    studio: {
      draftName: "Morning Focus",
      templateId: "rcp-morning-focus",
      context: "Work - Deep Focus",
      autoStart: true,
      canvasEntries: [
        {
          entryId: "entry-1",
          sourceKind: "template",
          sourceId: "rcp-existing",
          moduleId: "mod-pomodoro-focus",
          title: "Focus Sprint",
          subtitle: "Morning Focus",
          durationMinutes: 25,
          note: "No notifications",
          stepType: "pomodoro",
          checklist: ["Mute chat", "Full screen"],
          pomodoro: {
            focusSeconds: 1500,
            breakSeconds: 300,
            cycles: 1,
          },
          executionHints: {
            allowSkip: false,
            mustCompleteChecklist: true,
            autoAdvance: true,
          },
          overrunPolicy: "wait",
          rawStep: {
            id: "legacy-step",
            type: "pomodoro",
            title: "Legacy title",
            durationSeconds: 1200,
            checklist: ["old"],
            overrunPolicy: "wait",
          },
        },
      ],
    },
  });

  assert.equal(payload.id, "rcp-morning-focus");
  assert.equal(payload.autoDriveMode, "auto");
  assert.deepEqual(payload.studioMeta, {
    version: 1,
    kind: "routine_studio",
    context: "Work - Deep Focus",
  });
  assert.deepEqual(payload.steps, [
    {
      id: "step-1",
      type: "pomodoro",
      title: "Focus Sprint",
      durationSeconds: 1500,
      moduleId: "mod-pomodoro-focus",
      note: "No notifications",
      checklist: ["Mute chat", "Full screen"],
      pomodoro: {
        focusSeconds: 1500,
        breakSeconds: 300,
        cycles: 1,
      },
      executionHints: {
        allowSkip: false,
        mustCompleteChecklist: true,
        autoAdvance: true,
      },
      overrunPolicy: "wait",
    },
  ]);
});

test("bootstrapStudioState keeps a fresh draft instead of auto-loading the first saved routine", () => {
  const studio = {
    bootstrapped: false,
    applyTemplateId: "",
    modules: [{ id: "mod-1", name: "Setup" }, { id: "mod-2", name: "Focus" }, { id: "mod-3", name: "Review" }],
    canvasEntries: [],
    history: [],
    historyIndex: -1,
    selectedEntryId: "",
  };

  bootstrapStudioState({
    studio,
    recipes: [
      {
        id: "rcp-saved",
        name: "Saved Routine",
        studioMeta: { version: 1, kind: "routine_studio", context: "Planning" },
        steps: [{ id: "step-1", title: "Saved Step", durationSeconds: 300 }],
      },
    ],
    isRoutineStudioRecipe: () => true,
    syncFromRecipe: () => {
      throw new Error("should not auto-load a saved recipe");
    },
    recipeToEntries: () => {
      throw new Error("should not convert a saved recipe during bootstrap");
    },
    moduleToEntry: (module) => ({
      entryId: `entry-${module.id}`,
      sourceKind: "module",
      sourceId: module.id,
      moduleId: module.id,
      title: module.name,
      subtitle: "",
      durationMinutes: 5,
      note: "",
      stepType: "micro",
      checklist: [],
      pomodoro: null,
      executionHints: null,
      overrunPolicy: "wait",
      rawStep: { type: "micro", title: module.name, durationSeconds: 300, moduleId: module.id },
    }),
    cloneValue: (value) => JSON.parse(JSON.stringify(value)),
  });

  assert.equal(studio.applyTemplateId, "rcp-saved");
  assert.deepEqual(
    studio.canvasEntries.map((entry) => entry.title),
    ["Setup", "Focus", "Review"],
  );
});

test("syncStudioFromRecipe restores the saved apply target and context", () => {
  const studio = {
    templateId: "",
    applyTemplateId: "",
    draftName: "Draft",
    autoStart: false,
    context: "Work - Deep Focus",
  };

  syncStudioFromRecipe(studio, {
    id: "rcp-planning",
    name: "Planning Routine",
    autoDriveMode: "manual",
    studioMeta: {
      version: 1,
      kind: "routine_studio",
      context: "Planning",
    },
  });

  assert.equal(studio.templateId, "rcp-planning");
  assert.equal(studio.applyTemplateId, "rcp-planning");
  assert.equal(studio.draftName, "Planning Routine");
  assert.equal(studio.context, "Planning");
});

test("buildStudioModulePayload preserves existing module behavior fields during edit", () => {
  const payload = buildStudioModulePayload({
    editingModuleId: "mod-focus",
    existingModule: {
      id: "mod-focus",
      name: "Focus Sprint",
      category: "Focus Work",
      description: "Old desc",
      icon: "timer",
      durationMinutes: 25,
      stepType: "pomodoro",
      checklist: ["Mute chat"],
      pomodoro: { focusSeconds: 1500, breakSeconds: 300, cycles: 1 },
      overrunPolicy: "wait",
      executionHints: { allowSkip: false, mustCompleteChecklist: true, autoAdvance: true },
    },
    moduleId: "mod-focus",
    moduleName: "Focus Sprint Updated",
    category: "Focus Work",
    description: "New desc",
    icon: "bolt",
    durationMinutes: 30,
  });

  assert.deepEqual(payload, {
    id: "mod-focus",
    name: "Focus Sprint Updated",
    category: "Focus Work",
    description: "New desc",
    icon: "bolt",
    durationMinutes: 30,
    stepType: "pomodoro",
    checklist: ["Mute chat"],
    pomodoro: { focusSeconds: 1500, breakSeconds: 300, cycles: 1 },
    overrunPolicy: "wait",
    executionHints: { allowSkip: false, mustCompleteChecklist: true, autoAdvance: true },
  });
});

test("buildStudioAssets keeps schedule template options independent from library search", () => {
  const assets = buildStudioAssets({
    studio: {
      search: "focus-only",
      modules: [],
      moduleFolders: [],
      canvasEntries: [],
    },
    recipes: [
      {
        id: "rcp-1",
        name: "Morning Focus",
        studioMeta: { version: 1, kind: "routine_studio" },
        steps: [{ id: "step-1", title: "Focus", durationSeconds: 300 }],
      },
      {
        id: "rcp-2",
        name: "Admin Reset",
        studioMeta: { version: 1, kind: "routine_studio" },
        steps: [{ id: "step-1", title: "Admin", durationSeconds: 600 }],
      },
    ],
    normalizeModule: (module) => module,
    isRoutineStudioRecipe: () => true,
    routineStudioStepDurationMinutes: (step) => Math.round((step.durationSeconds || 0) / 60),
  });

  assert.deepEqual(
    assets.complexModuleAssets.map((asset) => asset.id),
    [],
  );
  assert.deepEqual(
    assets.allComplexModuleAssets.map((asset) => asset.id),
    ["rcp-1", "rcp-2"],
  );
});

test("buildStudioAssets keeps configured folder order and empty folders", () => {
  const assets = buildStudioAssets({
    studio: {
      search: "",
      modules: [
        {
          id: "mod-focus",
          name: "Focus Sprint",
          category: "Focus Work",
          description: "Deep work",
          durationMinutes: 25,
        },
      ],
      moduleFolders: [
        { id: "Communication", name: "Communication" },
        { id: "Planning", name: "Planning" },
        { id: "Focus Work", name: "Focus Work" },
      ],
      canvasEntries: [],
    },
    recipes: [],
    normalizeModule: (module) => module,
    isRoutineStudioRecipe: () => false,
    routineStudioStepDurationMinutes: () => 0,
  });

  assert.deepEqual(
    assets.folderAssets.map((folder) => [folder.id, folder.modules.length]),
    [
      ["Communication", 0],
      ["Planning", 0],
      ["Focus Work", 1],
    ],
  );
});

test("buildStudioAssets preserves module order inside each folder", () => {
  const assets = buildStudioAssets({
    studio: {
      search: "",
      modules: [
        {
          id: "mod-b",
          name: "B",
          category: "Focus Work",
          description: "",
          durationMinutes: 10,
        },
        {
          id: "mod-a",
          name: "A",
          category: "Focus Work",
          description: "",
          durationMinutes: 5,
        },
        {
          id: "mod-c",
          name: "C",
          category: "Planning",
          description: "",
          durationMinutes: 15,
        },
      ],
      moduleFolders: [
        { id: "Focus Work", name: "Focus Work" },
        { id: "Planning", name: "Planning" },
      ],
      canvasEntries: [],
    },
    recipes: [],
    normalizeModule: (module) => module,
    isRoutineStudioRecipe: () => false,
    routineStudioStepDurationMinutes: () => 0,
  });

  assert.deepEqual(
    assets.folderAssets.map((folder) => [folder.id, folder.modules.map((module) => module.id)]),
    [
      ["Focus Work", ["mod-b", "mod-a"]],
      ["Planning", ["mod-c"]],
    ],
  );
});
