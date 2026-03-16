import test from "node:test";
import assert from "node:assert/strict";
import { buildStudioRecipePayload } from "../src-ui/dist/pages/routines/studio/actions.js";
import { bootstrapStudioState, syncStudioFromRecipe } from "../src-ui/dist/pages/routines/studio/lifecycle.js";

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
