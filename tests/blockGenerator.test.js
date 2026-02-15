import test from "node:test";
import assert from "node:assert/strict";
import { BlockGenerator } from "../src/domain/blockGenerator.js";
import { createPolicy } from "../src/domain/models.js";

const POLICY = createPolicy({
  workHours: {
    start: "09:00",
    end: "18:00",
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  },
  blockDurationMinutes: 50,
  breakDurationMinutes: 10,
  minBlockGapMinutes: 5,
});

function overlaps(a, b) {
  return new Date(a.startAt) < new Date(b.endAt) && new Date(b.startAt) < new Date(a.endAt);
}

function randomEvents(date, count) {
  const events = [];
  for (let index = 0; index < count; index += 1) {
    const startMinute = 540 + Math.floor(Math.random() * 500);
    const duration = 15 + Math.floor(Math.random() * 90);
    const endMinute = Math.min(startMinute + duration, 1080);
    events.push({
      startAt: new Date(
        Date.UTC(
          Number(date.slice(0, 4)),
          Number(date.slice(5, 7)) - 1,
          Number(date.slice(8, 10)),
          Math.floor(startMinute / 60),
          startMinute % 60
        )
      ).toISOString(),
      endAt: new Date(
        Date.UTC(
          Number(date.slice(0, 4)),
          Number(date.slice(5, 7)) - 1,
          Number(date.slice(8, 10)),
          Math.floor(endMinute / 60),
          endMinute % 60
        )
      ).toISOString(),
    });
  }
  return events;
}

test("Feature: blocksched, Property 8: generated blocks do not overlap existing events", () => {
  const generator = new BlockGenerator(POLICY);
  const date = "2026-02-16";

  for (let run = 0; run < 100; run += 1) {
    const events = randomEvents(date, Math.floor(Math.random() * 8));
    const blocks = generator.generateBlocks(date, events, {
      source: "routine",
      sourceId: "rtn_focus",
      maxBlocks: 16,
    });

    for (const block of blocks) {
      for (const event of events) {
        assert.equal(overlaps(block, event), false);
      }
    }
    for (let i = 0; i < blocks.length; i += 1) {
      for (let j = i + 1; j < blocks.length; j += 1) {
        assert.equal(overlaps(blocks[i], blocks[j]), false);
      }
    }
  }
});

test("Feature: blocksched, Property 9: generated blocks stay within work hours", () => {
  const generator = new BlockGenerator(POLICY);
  const date = "2026-02-16";
  const events = randomEvents(date, 10);
  const blocks = generator.generateBlocks(date, events, {
    source: "routine",
    sourceId: "rtn_work",
  });

  for (const block of blocks) {
    const start = new Date(block.startAt);
    const end = new Date(block.endAt);
    const startMinute = start.getUTCHours() * 60 + start.getUTCMinutes();
    const endMinute = end.getUTCHours() * 60 + end.getUTCMinutes();
    assert.equal(startMinute >= 540, true);
    assert.equal(endMinute <= 1080, true);
    assert.equal(end > start, true);
  }
});
