import test from "node:test";
import assert from "node:assert/strict";
import { BlockPlanningService } from "../src/application/blockPlanningService.js";
import { createBlock, createPolicy } from "../src/domain/models.js";
import type { Block } from "../src/domain/models.js";

type TimeRange = {
  startAt: string;
  endAt: string;
};

type Notification = {
  type: string;
  payload: Record<string, unknown>;
};

type CalendarUpdate = {
  eventId: string;
  block: Block;
};

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

function minuteToIso(date: string, minute: number): string {
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

function overlaps(a: TimeRange, b: TimeRange): boolean {
  return new Date(a.startAt) < new Date(b.endAt) && new Date(b.startAt) < new Date(a.endAt);
}

class MemoryStorageRepository {
  private readonly blocks: Map<string, Block>;

  constructor() {
    this.blocks = new Map<string, Block>();
  }

  saveBlock(input: Partial<Block> & Pick<Block, "startAt" | "endAt">): Block {
    const block = createBlock(input);
    this.blocks.set(block.id, block);
    return block;
  }
}

test("Feature: blocksched, Property 10: generated blocks are registered in calendar as draft", () => {
  const date = "2026-02-16";

  for (let run = 0; run < 100; run += 1) {
    const storage = new MemoryStorageRepository();
    const created: Block[] = [];
    const calendarGateway = {
      createDraftBlockEvent(block: Block): string {
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
      assert.notEqual(block.calendarEventId, null);
      if (block.calendarEventId !== null) {
        assert.equal(block.calendarEventId.startsWith(`evt-${run}-`), true);
      }
    }
  }
});

test("Feature: blocksched, Property 23: overlapping blocks are relocated and calendar is updated", () => {
  const date = "2026-02-16";

  for (let run = 0; run < 100; run += 1) {
    const storage = new MemoryStorageRepository();
    const updates: CalendarUpdate[] = [];
    const calendarGateway = {
      updateEvent(eventId: string, block: Block): void {
        updates.push({ eventId, block });
      },
    };
    const notifications: Notification[] = [];
    const notificationService = {
      notify(type: string, payload: Record<string, unknown>): void {
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
    const existingEvents: TimeRange[] = [
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
    if (!relocated) {
      continue;
    }
    assert.equal(relocated.startAt, minuteToIso(date, freeStart));
    assert.equal(relocated.endAt, minuteToIso(date, freeEnd));
    assert.equal(updates.length, 1);
    const update = updates[0];
    assert.notEqual(update, undefined);
    if (!update) {
      continue;
    }
    assert.equal(update.eventId, `evt-${run}`);
    assert.equal(notifications.length, 0);

    for (const event of existingEvents) {
      assert.equal(overlaps(relocated, event), false);
    }
  }
});

test("Feature: blocksched, Property 23: manual adjustment is notified when relocation fails", () => {
  const date = "2026-02-16";
  const storage = new MemoryStorageRepository();
  const updates: CalendarUpdate[] = [];
  const notifications: Notification[] = [];

  const service = new BlockPlanningService({
    policy: POLICY,
    storageRepository: storage,
    calendarGateway: {
      updateEvent(eventId: string, block: Block): void {
        updates.push({ eventId, block });
      },
    },
    notificationService: {
      notify(type: string, payload: Record<string, unknown>): void {
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

  const existingEvents: TimeRange[] = [
    {
      startAt: minuteToIso(date, 540),
      endAt: minuteToIso(date, 1080),
    },
  ];

  const relocated = service.relocateIfNeeded(block, existingEvents);
  assert.equal(relocated, null);
  assert.equal(updates.length, 0);
  assert.equal(notifications.length, 1);
  const first = notifications[0];
  assert.notEqual(first, undefined);
  if (!first) {
    return;
  }
  assert.equal(first.type, "manual_adjustment_required");
  assert.equal(first.payload.blockId, block.id);
});
