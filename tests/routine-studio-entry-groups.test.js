import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStudioEntry } from "../src-ui/dist/pages/routines/state.js";
import { recipeToStudioEntries } from "../src-ui/dist/pages/routines/studio/canvas.js";
import { resolveStudioDropInsertIndex } from "../src-ui/dist/pages/routines/studio/drop-indicator.js";
import {
  collectStudioEntryGroups,
  canMoveStudioEntryGroup,
  moveStudioEntryGroupByDirection,
  moveStudioEntryGroupToIndex,
  removeStudioEntryGroup,
} from "../src-ui/dist/pages/routines/studio/entry-groups.js";

function makeEntry(entryId, groupId = "") {
  return {
    entryId,
    sourceKind: groupId ? "template" : "module",
    sourceId: groupId ? "rcp-focus" : entryId,
    ...(groupId ? { groupId } : {}),
    moduleId: "",
    title: entryId,
    subtitle: "",
    durationMinutes: 5,
    note: "",
    stepType: "micro",
    checklist: [],
    pomodoro: null,
    executionHints: null,
    overrunPolicy: "wait",
    rawStep: {
      type: "micro",
      title: entryId,
      durationSeconds: 300,
    },
  };
}

function makeDropzone(cards) {
  return {
    querySelectorAll(selector) {
      if (selector === "[data-studio-canvas-entry]" || selector === ".rs-canvas-card") {
        return cards;
      }
      return [];
    },
  };
}

function makeCard(top, height) {
  return {
    getBoundingClientRect() {
      return { top, height };
    },
  };
}

test("recipeToStudioEntries assigns one shared group id per composite insertion", () => {
  const recipe = {
    id: "rcp-morning-focus",
    name: "Morning Focus",
    steps: [
      { id: "step-1", title: "Setup", durationSeconds: 300 },
      { id: "step-2", title: "Focus", durationSeconds: 1500 },
    ],
  };

  const firstInsert = recipeToStudioEntries(recipe, normalizeStudioEntry, (step) => Math.round((step.durationSeconds || 0) / 60));
  const secondInsert = recipeToStudioEntries(recipe, normalizeStudioEntry, (step) => Math.round((step.durationSeconds || 0) / 60));

  assert.equal(firstInsert.length, 2);
  assert.ok(firstInsert.every((entry) => entry.groupId === firstInsert[0].groupId));
  assert.ok(firstInsert[0].groupId);
  assert.notEqual(firstInsert[0].groupId, secondInsert[0].groupId);
  assert.equal(firstInsert[0].rawStep.groupId, undefined);
});

test("removeStudioEntryGroup removes every step in the selected composite block", () => {
  const entries = [
    makeEntry("entry-a"),
    makeEntry("entry-b", "studio-group-1"),
    makeEntry("entry-c", "studio-group-1"),
    makeEntry("entry-d"),
  ];

  assert.deepEqual(
    removeStudioEntryGroup(entries, "entry-c").map((entry) => entry.entryId),
    ["entry-a", "entry-d"],
  );
});

test("moveStudioEntryGroupByDirection moves a composite block without splitting it", () => {
  const entries = [
    makeEntry("entry-a"),
    makeEntry("entry-b", "studio-group-1"),
    makeEntry("entry-c", "studio-group-1"),
    makeEntry("entry-d"),
  ];

  assert.equal(canMoveStudioEntryGroup(entries, "entry-b", "up"), true);
  assert.equal(canMoveStudioEntryGroup(entries, "entry-b", "down"), true);
  assert.deepEqual(
    moveStudioEntryGroupByDirection(entries, "entry-c", "up").map((entry) => entry.entryId),
    ["entry-b", "entry-c", "entry-a", "entry-d"],
  );
  assert.deepEqual(
    moveStudioEntryGroupByDirection(entries, "entry-b", "down").map((entry) => entry.entryId),
    ["entry-a", "entry-d", "entry-b", "entry-c"],
  );
});

test("moveStudioEntryGroupToIndex keeps grouped steps contiguous during drag reorder", () => {
  const entries = [
    makeEntry("entry-a"),
    makeEntry("entry-b", "studio-group-1"),
    makeEntry("entry-c", "studio-group-1"),
    makeEntry("entry-d"),
    makeEntry("entry-e"),
  ];

  assert.deepEqual(
    moveStudioEntryGroupToIndex(entries, "entry-c", entries.length).map((entry) => entry.entryId),
    ["entry-a", "entry-d", "entry-e", "entry-b", "entry-c"],
  );
});

test("collectStudioEntryGroups collapses composite steps into one display unit", () => {
  const entries = [
    makeEntry("entry-a"),
    makeEntry("entry-b", "studio-group-1"),
    makeEntry("entry-c", "studio-group-1"),
    makeEntry("entry-d"),
  ];

  const groups = collectStudioEntryGroups(entries);

  assert.deepEqual(
    groups.map((group) => ({
      entryId: group.entryId,
      start: group.start,
      end: group.end,
      isGrouped: group.isGrouped,
      totalMinutes: group.totalMinutes,
    })),
    [
      { entryId: "entry-a", start: 0, end: 0, isGrouped: false, totalMinutes: 5 },
      { entryId: "entry-b", start: 1, end: 2, isGrouped: true, totalMinutes: 10 },
      { entryId: "entry-d", start: 3, end: 3, isGrouped: false, totalMinutes: 5 },
    ],
  );
});

test("resolveStudioDropInsertIndex maps grouped cards back to entry indexes", () => {
  const studio = {
    canvasEntries: [
      makeEntry("entry-a"),
      makeEntry("entry-b", "studio-group-1"),
      makeEntry("entry-c", "studio-group-1"),
      makeEntry("entry-d"),
    ],
  };
  const dropzone = makeDropzone([
    makeCard(0, 40),
    makeCard(50, 60),
    makeCard(120, 40),
  ]);

  assert.equal(resolveStudioDropInsertIndex(studio, dropzone, 19), 0);
  assert.equal(resolveStudioDropInsertIndex(studio, dropzone, 70), 1);
  assert.equal(resolveStudioDropInsertIndex(studio, dropzone, 160), 4);
});
