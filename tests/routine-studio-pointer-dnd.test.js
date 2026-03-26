import test from "node:test";
import assert from "node:assert/strict";
import { resolveCommittedFolderDropTarget } from "../src-ui/dist/pages/routines/pointer-dnd.js";

test("resolveCommittedFolderDropTarget refreshes module folder drops on pointerup", () => {
  const latestDrop = { folderId: "Planning", beforeModuleId: "mod-b" };
  let called = 0;

  const result = resolveCommittedFolderDropTarget({
    dragKind: "module",
    activeFolderDrop: { folderId: "Focus Work", beforeModuleId: "" },
    resolveLatestFolderDrop: () => {
      called += 1;
      return latestDrop;
    },
  });

  assert.equal(called, 1);
  assert.equal(result, latestDrop);
});

test("resolveCommittedFolderDropTarget keeps cached folder drop when refresh finds nothing", () => {
  const activeDrop = { folderId: "Focus Work", beforeModuleId: "" };

  const result = resolveCommittedFolderDropTarget({
    dragKind: "module",
    activeFolderDrop: activeDrop,
    resolveLatestFolderDrop: () => null,
  });

  assert.equal(result, activeDrop);
});

test("resolveCommittedFolderDropTarget skips refresh for non-module drags", () => {
  let called = 0;

  const result = resolveCommittedFolderDropTarget({
    dragKind: "entry",
    activeFolderDrop: { folderId: "Focus Work", beforeModuleId: "" },
    resolveLatestFolderDrop: () => {
      called += 1;
      return { folderId: "Planning", beforeModuleId: "" };
    },
  });

  assert.deepEqual(result, { folderId: "Focus Work", beforeModuleId: "" });
  assert.equal(called, 0);
});
