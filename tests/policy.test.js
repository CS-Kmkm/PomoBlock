import test from "node:test";
import assert from "node:assert/strict";
import { createPolicy, createPolicyOverride } from "../src/domain/models.js";
import { applyPolicyOverride, filterSlots, isWithinWorkHours } from "../src/domain/policy.js";

const BASE_POLICY = createPolicy({
  workHours: {
    start: "09:00",
    end: "18:00",
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  },
  blockDurationMinutes: 50,
  breakDurationMinutes: 10,
  minBlockGapMinutes: 5,
});

test("isWithinWorkHours returns true inside configured range", () => {
  const inside = "2026-02-16T12:00:00.000Z";
  const outside = "2026-02-16T20:00:00.000Z";

  assert.equal(isWithinWorkHours(BASE_POLICY, inside), true);
  assert.equal(isWithinWorkHours(BASE_POLICY, outside), false);
});

test("Feature: blocksched, Property 29: user override takes precedence", () => {
  const override = createPolicyOverride({
    mode: "hard",
    value: {
      blockDurationMinutes: 90,
      breakDurationMinutes: 15,
    },
  });

  const applied = applyPolicyOverride(BASE_POLICY, override);
  assert.equal(applied.blockDurationMinutes, 90);
  assert.equal(applied.breakDurationMinutes, 15);
  assert.equal(applied.minBlockGapMinutes, BASE_POLICY.minBlockGapMinutes);
});

test("filterSlots only returns slots inside work hours", () => {
  for (let index = 0; index < 100; index += 1) {
    const startMinute = Math.floor(Math.random() * (24 * 60 - 1));
    const endMinute = Math.min(
      startMinute + 1 + Math.floor(Math.random() * (4 * 60)),
      24 * 60
    );
    const day = "2026-02-16";
    const slot = {
      startAt: new Date(
        Date.UTC(2026, 1, 16, Math.floor(startMinute / 60), startMinute % 60)
      ).toISOString(),
      endAt: new Date(
        Date.UTC(2026, 1, 16, Math.floor(endMinute / 60), endMinute % 60)
      ).toISOString(),
    };

    const result = filterSlots(BASE_POLICY, [slot]);
    for (const filteredSlot of result) {
      const start = new Date(filteredSlot.startAt);
      const end = new Date(filteredSlot.endAt);
      assert.equal(filteredSlot.startAt.startsWith(day), true);
      assert.equal(filteredSlot.endAt.startsWith(day), true);
      assert.equal(start.getUTCHours() * 60 + start.getUTCMinutes() >= 540, true);
      assert.equal(end.getUTCHours() * 60 + end.getUTCMinutes() <= 1080, true);
      assert.equal(end > start, true);
    }
  }
});
