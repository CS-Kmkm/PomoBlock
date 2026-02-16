import test from "node:test";
import assert from "node:assert/strict";
import { BlockOperationsService } from "../src/application/blockOperationsService.js";
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

  loadBlockById(blockId) {
    return this.blocks.get(blockId) ?? null;
  }

  deleteBlock(blockId) {
    this.blocks.delete(blockId);
  }
}

test("Feature: blocksched, Property 12: approving block updates firmness and calendar event", () => {
  const storage = new MemoryStorageRepository();
  const updates = [];
  const service = new BlockOperationsService({
    storageRepository: storage,
    calendarGateway: {
      updateEvent(eventId, block) {
        updates.push({ eventId, block });
      },
    },
  });

  for (let run = 0; run < 100; run += 1) {
    storage.saveBlock({
      id: `block-${run}`,
      instance: `rtn:rtn_focus:2026-02-16:${run}`,
      date: "2026-02-16",
      startAt: "2026-02-16T09:00:00.000Z",
      endAt: "2026-02-16T09:50:00.000Z",
      type: "deep",
      firmness: "draft",
      source: "routine",
      sourceId: "rtn_focus",
      calendarEventId: `event-${run}`,
    });
  }

  const approved = service.approveBlocks([...Array(100).keys()].map((n) => `block-${n}`));
  assert.equal(approved.length, 100);
  assert.equal(updates.length, 100);
  for (const block of approved) {
    assert.equal(block.firmness, "soft");
    assert.equal(storage.loadBlockById(block.id).firmness, "soft");
  }
});

test("Feature: blocksched, Property 13: deleting block is reflected in calendar", () => {
  const storage = new MemoryStorageRepository();
  const deletedEventIds = [];
  const service = new BlockOperationsService({
    storageRepository: storage,
    calendarGateway: {
      deleteEvent(eventId) {
        deletedEventIds.push(eventId);
      },
    },
  });

  storage.saveBlock({
    id: "block-delete",
    instance: "rtn:rtn_focus:2026-02-16:0",
    date: "2026-02-16",
    startAt: "2026-02-16T10:00:00.000Z",
    endAt: "2026-02-16T10:50:00.000Z",
    type: "deep",
    firmness: "soft",
    source: "routine",
    sourceId: "rtn_focus",
    calendarEventId: "event-delete",
  });

  const deleted = service.deleteBlock("block-delete");
  assert.equal(deleted, true);
  assert.equal(storage.loadBlockById("block-delete"), null);
  assert.deepEqual(deletedEventIds, ["event-delete"]);
});

test("Feature: blocksched, Property 14: adjusting block time updates calendar event time", () => {
  const storage = new MemoryStorageRepository();
  const updates = [];
  const service = new BlockOperationsService({
    storageRepository: storage,
    calendarGateway: {
      updateEvent(eventId, block) {
        updates.push({ eventId, block });
      },
    },
  });

  storage.saveBlock({
    id: "block-adjust",
    instance: "rtn:rtn_focus:2026-02-16:0",
    date: "2026-02-16",
    startAt: "2026-02-16T13:00:00.000Z",
    endAt: "2026-02-16T13:50:00.000Z",
    type: "deep",
    firmness: "soft",
    source: "routine",
    sourceId: "rtn_focus",
    calendarEventId: "event-adjust",
  });

  const updated = service.adjustBlockTime(
    "block-adjust",
    "2026-02-16T14:00:00.000Z",
    "2026-02-16T14:50:00.000Z"
  );

  assert.equal(updated.startAt, "2026-02-16T14:00:00.000Z");
  assert.equal(updated.endAt, "2026-02-16T14:50:00.000Z");
  assert.equal(storage.loadBlockById("block-adjust").startAt, "2026-02-16T14:00:00.000Z");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].eventId, "event-adjust");
});
