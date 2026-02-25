import test from "node:test";
import assert from "node:assert/strict";
import { BlockPlanningService } from "../src/application/blockPlanningService.js";
import { createBlock, createPolicy } from "../src/domain/models.js";

const POLICY = createPolicy({
  workHours: {
    start: "09:00",
    end: "18:00",
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  },
  blockDurationMinutes: 60,
  breakDurationMinutes: 5,
  minBlockGapMinutes: 0,
});

function minuteToIso(date, minute) {
  return new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
      Math.floor(minute / 60),
      minute % 60
    )
  ).toISOString();
}

function overlaps(a, b) {
  return new Date(a.startAt) < new Date(b.endAt) && new Date(b.startAt) < new Date(a.endAt);
}

class MemoryStorageRepository {
  constructor() {
    this.blocks = new Map();
  }

  saveBlock(input) {
    const block = createBlock(input);
    this.blocks.set(block.id, block);
    return block;
  }
}

test("Feature: blocksched, Property 10: generated blocks are registered in calendar as draft", () => {
  const date = "2026-02-16";

  for (let run = 0; run < 100; run += 1) {
    const storage = new MemoryStorageRepository();
    const created = [];
    const calendarGateway = {
      createDraftBlockEvent(block) {
        created.push(block);
        return `evt-${run}-${created.length}`;
      },
    };

    const service = new BlockPlanningService({
      policy: POLICY,
      storageRepository: storage,
      calendarGateway,
    });

    const blocks = service.planDay(date, [], {
      source: "routine",
      sourceId: "rtn_focus",
      maxBlocks: 4 + Math.floor(Math.random() * 8),
    });

    assert.equal(blocks.length > 0, true);
    assert.equal(created.length, blocks.length);
    for (const block of blocks) {
      assert.equal(block.firmness, "draft");
      assert.equal(block.calendarEventId.startsWith(`evt-${run}-`), true);
    }
  }
});

test("Feature: blocksched, Property 23: overlapping blocks are relocated and calendar is updated", () => {
  const date = "2026-02-16";

  for (let run = 0; run < 100; run += 1) {
    const storage = new MemoryStorageRepository();
    const updates = [];
    const calendarGateway = {
      updateEvent(eventId, block) {
        updates.push({ eventId, block });
      },
    };
    const notifications = [];
    const notificationService = {
      notify(type, payload) {
        notifications.push({ type, payload });
      },
    };

    const service = new BlockPlanningService({
      policy: POLICY,
      storageRepository: storage,
      calendarGateway,
      notificationService,
    });

    const freeStart = 660 + Math.floor(Math.random() * 240);
    const freeEnd = freeStart + 60;
    const existingEvents = [
      {
        startAt: minuteToIso(date, 540),
        endAt: minuteToIso(date, freeStart),
      },
      {
        startAt: minuteToIso(date, freeEnd),
        endAt: minuteToIso(date, 1080),
      },
    ];

    const block = createBlock({
      id: `block-${run}`,
      instance: `rtn:rtn_focus:${date}:0`,
      date,
      startAt: minuteToIso(date, 600),
      endAt: minuteToIso(date, 660),
      type: "deep",
      firmness: "draft",
      source: "routine",
      sourceId: "rtn_focus",
      calendarEventId: `evt-${run}`,
    });

    const relocated = service.relocateIfNeeded(block, existingEvents);
    assert.notEqual(relocated, null);
    assert.equal(relocated.startAt, minuteToIso(date, freeStart));
    assert.equal(relocated.endAt, minuteToIso(date, freeEnd));
    assert.equal(updates.length, 1);
    assert.equal(updates[0].eventId, `evt-${run}`);
    assert.equal(notifications.length, 0);

    for (const event of existingEvents) {
      assert.equal(overlaps(relocated, event), false);
    }
  }
});

test("Feature: blocksched, Property 23: manual adjustment is notified when relocation fails", () => {
  const date = "2026-02-16";
  const storage = new MemoryStorageRepository();
  const updates = [];
  const notifications = [];

  const service = new BlockPlanningService({
    policy: POLICY,
    storageRepository: storage,
    calendarGateway: {
      updateEvent(eventId, block) {
        updates.push({ eventId, block });
      },
    },
    notificationService: {
      notify(type, payload) {
        notifications.push({ type, payload });
      },
    },
  });

  const block = createBlock({
    id: "block-no-slot",
    instance: `rtn:rtn_focus:${date}:0`,
    date,
    startAt: minuteToIso(date, 600),
    endAt: minuteToIso(date, 660),
    type: "deep",
    firmness: "draft",
    source: "routine",
    sourceId: "rtn_focus",
    calendarEventId: "evt-no-slot",
  });

  const existingEvents = [
    {
      startAt: minuteToIso(date, 540),
      endAt: minuteToIso(date, 1080),
    },
  ];

  const relocated = service.relocateIfNeeded(block, existingEvents);
  assert.equal(relocated, null);
  assert.equal(updates.length, 0);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "manual_adjustment_required");
  assert.equal(notifications[0].payload.blockId, block.id);
});
