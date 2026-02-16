import test from "node:test";
import assert from "node:assert/strict";
import { ExternalEditService } from "../src/application/externalEditService.js";
import { createBlock } from "../src/domain/models.js";

class MemoryStorageRepository {
  constructor() {
    this.blocks = new Map();
  }

  saveBlock(input) {
    const block = createBlock(input);
    this.blocks.set(block.id, block);
    return block;
  }

  loadAllBlocks() {
    return [...this.blocks.values()];
  }

  loadBlockById(blockId) {
    return this.blocks.get(blockId) ?? null;
  }

  deleteBlock(blockId) {
    this.blocks.delete(blockId);
  }
}

test("Feature: blocksched, Property 22: newly added calendar events are detected on sync", () => {
  for (let run = 0; run < 100; run += 1) {
    const notifications = [];
    const storage = new MemoryStorageRepository();
    const service = new ExternalEditService({
      storageRepository: storage,
      notificationService: {
        notify(type, payload) {
          notifications.push({ type, payload });
        },
      },
    });

    const startHour = 9 + Math.floor(Math.random() * 8);
    const remoteEventId = `event-${run}`;
    const result = service.syncExternalChanges([
      {
        id: remoteEventId,
        startAt: `2026-02-16T${String(startHour).padStart(2, "0")}:00:00.000Z`,
        endAt: `2026-02-16T${String(startHour).padStart(2, "0")}:30:00.000Z`,
      },
    ]);

    assert.equal(result.added.length, 1);
    assert.equal(result.updated.length, 0);
    assert.equal(result.deleted.length, 0);
    assert.equal(result.added[0].calendarEventId, remoteEventId);
    assert.equal(notifications.some((note) => note.type === "external_event_added"), true);
  }
});

test("Feature: blocksched, Property 31: external edits are detected and user is notified", () => {
  const notifications = [];
  const storage = new MemoryStorageRepository();
  const service = new ExternalEditService({
    storageRepository: storage,
    notificationService: {
      notify(type, payload) {
        notifications.push({ type, payload });
      },
    },
  });

  const localUpdated = storage.saveBlock({
    id: "block-update",
    instance: "external:event-update:2026-02-16",
    date: "2026-02-16",
    startAt: "2026-02-16T09:00:00.000Z",
    endAt: "2026-02-16T09:30:00.000Z",
    type: "admin",
    firmness: "soft",
    source: "calendar",
    sourceId: "event-update",
    calendarEventId: "event-update",
  });
  const localDeleted = storage.saveBlock({
    id: "block-delete",
    instance: "external:event-delete:2026-02-16",
    date: "2026-02-16",
    startAt: "2026-02-16T11:00:00.000Z",
    endAt: "2026-02-16T11:30:00.000Z",
    type: "admin",
    firmness: "soft",
    source: "calendar",
    sourceId: "event-delete",
    calendarEventId: "event-delete",
  });

  const result = service.syncExternalChanges([
    {
      id: "event-update",
      startAt: "2026-02-16T10:00:00.000Z",
      endAt: "2026-02-16T10:30:00.000Z",
    },
    {
      id: "event-added",
      startAt: "2026-02-16T12:00:00.000Z",
      endAt: "2026-02-16T12:30:00.000Z",
    },
  ]);

  assert.equal(result.added.length, 1);
  assert.equal(result.updated.length, 1);
  assert.equal(result.deleted.includes(localDeleted.id), true);

  const refreshed = storage.loadBlockById(localUpdated.id);
  assert.equal(refreshed.startAt, "2026-02-16T10:00:00.000Z");
  assert.equal(storage.loadAllBlocks().some((block) => block.calendarEventId === "event-added"), true);
  assert.equal(storage.loadBlockById(localDeleted.id), null);

  assert.equal(notifications.some((note) => note.type === "external_event_added"), true);
  assert.equal(notifications.some((note) => note.type === "external_block_updated"), true);
  assert.equal(notifications.some((note) => note.type === "external_block_deleted"), true);
});
