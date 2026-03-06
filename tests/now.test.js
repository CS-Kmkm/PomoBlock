import test from "node:test";
import assert from "node:assert/strict";
import { resolveNowAutoStartBlock } from "../src-ui/now.ts";

function localDate(year, month, day, hour, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function makeBlock(id, start, end) {
  return {
    id,
    date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    firmness: "soft",
    instance: "single",
    planned_pomodoros: 1,
    source: "test",
    source_id: null,
  };
}

test("resolveNowAutoStartBlock: reference within active block selects active block", () => {
  const blockA = makeBlock("A", localDate(2026, 3, 5, 9, 0), localDate(2026, 3, 5, 10, 0));
  const blockB = makeBlock("B", localDate(2026, 3, 5, 11, 0), localDate(2026, 3, 5, 12, 0));
  const selected = resolveNowAutoStartBlock([blockA, blockB], {}, localDate(2026, 3, 5, 9, 30));
  assert.equal(selected?.id, "A");
});

test("resolveNowAutoStartBlock: reference before blocks selects nearest upcoming block", () => {
  const blockA = makeBlock("A", localDate(2026, 3, 5, 9, 0), localDate(2026, 3, 5, 10, 0));
  const blockB = makeBlock("B", localDate(2026, 3, 5, 11, 0), localDate(2026, 3, 5, 12, 0));
  const selected = resolveNowAutoStartBlock([blockA, blockB], {}, localDate(2026, 3, 5, 8, 59));
  assert.equal(selected?.id, "A");
});

test("resolveNowAutoStartBlock: reference after all blocks falls back to day first block", () => {
  const blockA = makeBlock("A", localDate(2026, 3, 5, 9, 0), localDate(2026, 3, 5, 10, 0));
  const blockB = makeBlock("B", localDate(2026, 3, 5, 11, 0), localDate(2026, 3, 5, 12, 0));
  const selected = resolveNowAutoStartBlock([blockA, blockB], {}, localDate(2026, 3, 5, 12, 30));
  assert.equal(selected?.id, "A");
});

test("resolveNowAutoStartBlock: current_block_id is prioritized when block exists in day", () => {
  const blockA = makeBlock("A", localDate(2026, 3, 5, 9, 0), localDate(2026, 3, 5, 10, 0));
  const blockB = makeBlock("B", localDate(2026, 3, 5, 11, 0), localDate(2026, 3, 5, 12, 0));
  const selected = resolveNowAutoStartBlock(
    [blockA, blockB],
    { current_block_id: "B", phase: "idle", remaining_seconds: 0, total_cycles: 0, completed_cycles: 0, current_cycle: 0 },
    localDate(2026, 3, 5, 9, 30)
  );
  assert.equal(selected?.id, "B");
});
