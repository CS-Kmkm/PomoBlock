import { createBlock, createPolicy } from "./models.js";
import { filterSlots, workWindowForDate } from "./policy.js";

function toInterval(entity) {
  const startValue = entity.startAt ?? entity.start ?? null;
  const endValue = entity.endAt ?? entity.end ?? null;
  if (!startValue || !endValue) {
    return null;
  }
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return null;
  }
  return { start, end };
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function mergeIntervals(intervals) {
  if (intervals.length === 0) {
    return [];
  }

  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged = [sorted[0]];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      if (current.end > last.end) {
        last.end = current.end;
      }
    } else {
      merged.push(current);
    }
  }
  return merged;
}

function createInstanceKey(source, sourceId, date, index, id) {
  if (source === "manual") {
    return `man:${id}`;
  }
  const stableSourceId = sourceId ?? "unknown";
  return `${source}:${stableSourceId}:${date}:${index}`;
}

function buildBusyIntervals(events, windowStart, windowEnd) {
  const intervals = [];
  for (const event of events) {
    const interval = toInterval(event);
    if (!interval) {
      continue;
    }
    if (interval.end <= windowStart || interval.start >= windowEnd) {
      continue;
    }
    intervals.push({
      start: new Date(Math.max(interval.start.getTime(), windowStart.getTime())),
      end: new Date(Math.min(interval.end.getTime(), windowEnd.getTime())),
    });
  }
  return mergeIntervals(intervals);
}

function durationMinutes(start, end) {
  return Math.floor((end.getTime() - start.getTime()) / 60000);
}

export class BlockGenerator {
  constructor(policyInput) {
    this.policy = createPolicy(policyInput);
  }

  findFreeSlots(date, existingEvents = []) {
    const { start: workStart, end: workEnd } = workWindowForDate(this.policy, date);
    if (workEnd <= workStart) {
      return [];
    }

    const busyIntervals = buildBusyIntervals(existingEvents, workStart, workEnd);
    const rawSlots = [];
    let cursor = new Date(workStart);

    for (const busy of busyIntervals) {
      if (busy.start > cursor) {
        rawSlots.push({
          startAt: new Date(cursor).toISOString(),
          endAt: new Date(busy.start).toISOString(),
        });
      }
      if (busy.end > cursor) {
        cursor = new Date(busy.end);
      }
    }

    if (cursor < workEnd) {
      rawSlots.push({
        startAt: new Date(cursor).toISOString(),
        endAt: new Date(workEnd).toISOString(),
      });
    }

    return filterSlots(this.policy, rawSlots).filter((slot) => {
      const start = new Date(slot.startAt);
      const end = new Date(slot.endAt);
      return durationMinutes(start, end) >= this.policy.blockDurationMinutes;
    });
  }

  generateBlocks(date, existingEvents = [], options = {}) {
    const existingBlocks = options.existingBlocks ?? [];
    const source = options.source ?? "routine";
    const sourceId = options.sourceId ?? null;
    const blockType = options.type ?? "deep";
    const maxBlocks = options.maxBlocks ?? 100;

    const blocks = [];
    const freeSlots = this.findFreeSlots(date, existingEvents);
    const takenIntervals = [
      ...existingEvents.map(toInterval).filter(Boolean),
      ...existingBlocks.map(toInterval).filter(Boolean),
    ];
    let instanceIndex = 0;

    for (const slot of freeSlots) {
      let cursor = new Date(slot.startAt);
      const slotEnd = new Date(slot.endAt);

      while (
        cursor < slotEnd &&
        blocks.length < maxBlocks
      ) {
        const endCandidate = new Date(
          cursor.getTime() + this.policy.blockDurationMinutes * 60000
        );
        if (endCandidate > slotEnd) {
          break;
        }

        const interval = { start: new Date(cursor), end: endCandidate };
        const collides = takenIntervals.some((busy) => overlaps(interval, busy));
        if (!collides) {
          const id = options.idFactory ? options.idFactory() : undefined;
          const instance = createInstanceKey(source, sourceId, date, instanceIndex, id ?? "generated");
          const duplicateInExisting = existingBlocks.some((b) => b.instance === instance);
          if (!duplicateInExisting) {
            const block = createBlock({
              id,
              instance,
              date,
              startAt: interval.start.toISOString(),
              endAt: interval.end.toISOString(),
              type: blockType,
              firmness: "draft",
              source,
              sourceId,
              plannedPomodoros: Math.max(
                1,
                Math.floor(
                  this.policy.blockDurationMinutes /
                    (25 + this.policy.breakDurationMinutes)
                )
              ),
            });
            blocks.push(block);
            takenIntervals.push(interval);
          }
          instanceIndex += 1;
        }

        cursor = new Date(
          endCandidate.getTime() + this.policy.minBlockGapMinutes * 60000
        );
      }
    }

    return blocks;
  }

  relocateBlock(block, existingEvents = []) {
    const current = toInterval(block);
    if (!current) {
      return null;
    }

    const duration = current.end.getTime() - current.start.getTime();
    const freeSlots = this.findFreeSlots(block.date, existingEvents);

    for (const slot of freeSlots) {
      const slotStart = new Date(slot.startAt);
      const slotEnd = new Date(slot.endAt);
      const candidateEnd = new Date(slotStart.getTime() + duration);
      if (candidateEnd > slotEnd) {
        continue;
      }

      if (
        slotStart.getTime() === current.start.getTime() &&
        candidateEnd.getTime() === current.end.getTime()
      ) {
        continue;
      }

      return createBlock({
        ...block,
        startAt: slotStart.toISOString(),
        endAt: candidateEnd.toISOString(),
      });
    }

    return null;
  }
}

export function intervalsOverlap(a, b) {
  return overlaps(
    { start: new Date(a.startAt), end: new Date(a.endAt) },
    { start: new Date(b.startAt), end: new Date(b.endAt) }
  );
}
