import { createBlock, createPolicy } from "./models.js";
import type { Block, Policy } from "./models.js";
import { filterSlots, workWindowForDate } from "./policy.js";

type Interval = {
  start: Date;
  end: Date;
};

type EventLike = {
  startAt?: string;
  endAt?: string;
  start?: string;
  end?: string;
};

type TimeSlot = {
  startAt: string;
  endAt: string;
};

type GenerateBlocksOptions = {
  existingBlocks?: Block[];
  source?: string;
  sourceId?: string | null;
  maxBlocks?: number;
  idFactory?: () => string;
};

function toInterval(entity: EventLike | null | undefined): Interval | null {
  const startValue = entity?.startAt ?? entity?.start ?? null;
  const endValue = entity?.endAt ?? entity?.end ?? null;
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

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) {
    return [];
  }

  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const first = sorted[0];
  if (!first) {
    return [];
  }
  const merged: Interval[] = [{ start: new Date(first.start), end: new Date(first.end) }];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    if (!current) {
      continue;
    }
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ start: new Date(current.start), end: new Date(current.end) });
      continue;
    }
    if (current.start <= last.end) {
      if (current.end > last.end) {
        last.end = current.end;
      }
    } else {
      merged.push({ start: new Date(current.start), end: new Date(current.end) });
    }
  }
  return merged;
}

function createInstanceKey(
  source: string,
  sourceId: string | null,
  date: string,
  index: number,
  id: string
): string {
  if (source === "manual") {
    return `man:${id}`;
  }
  const stableSourceId = sourceId ?? "unknown";
  return `${source}:${stableSourceId}:${date}:${index}`;
}

function buildBusyIntervals(events: EventLike[], windowStart: Date, windowEnd: Date): Interval[] {
  const intervals: Interval[] = [];
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

function durationMinutes(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 60000);
}

export class BlockGenerator {
  private readonly policy: Policy;

  constructor(policyInput: Partial<Policy>) {
    this.policy = createPolicy(policyInput);
  }

  findFreeSlots(date: string, existingEvents: EventLike[] = []): TimeSlot[] {
    const { start: workStart, end: workEnd } = workWindowForDate(this.policy, date);
    if (workEnd <= workStart) {
      return [];
    }

    const busyIntervals = buildBusyIntervals(existingEvents, workStart, workEnd);
    const rawSlots: TimeSlot[] = [];
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

  generateBlocks(
    date: string,
    existingEvents: EventLike[] = [],
    options: GenerateBlocksOptions = {}
  ): Block[] {
    const existingBlocks = options.existingBlocks ?? [];
    const source = options.source ?? "routine";
    const sourceId = options.sourceId ?? null;
    const maxBlocks = options.maxBlocks ?? 100;

    const blocks: Block[] = [];
    const freeSlots = this.findFreeSlots(date, existingEvents);
    const existingEventIntervals = existingEvents
      .map(toInterval)
      .filter((interval): interval is Interval => interval !== null);
    const existingBlockIntervals = existingBlocks
      .map(toInterval)
      .filter((interval): interval is Interval => interval !== null);
    const takenIntervals: Interval[] = [...existingEventIntervals, ...existingBlockIntervals];
    let instanceIndex = 0;

    for (const slot of freeSlots) {
      let cursor = new Date(slot.startAt);
      const slotEnd = new Date(slot.endAt);

      while (cursor < slotEnd && blocks.length < maxBlocks) {
        const endCandidate = new Date(cursor.getTime() + this.policy.blockDurationMinutes * 60000);
        if (endCandidate > slotEnd) {
          break;
        }

        const interval = { start: new Date(cursor), end: endCandidate };
        const collides = takenIntervals.some((busy) => overlaps(interval, busy));
        if (!collides) {
          const id = options.idFactory ? options.idFactory() : null;
          const instance = createInstanceKey(source, sourceId, date, instanceIndex, id ?? "generated");
          const duplicateInExisting = existingBlocks.some((block) => block.instance === instance);
          if (!duplicateInExisting) {
            const block = createBlock({
              ...(id ? { id } : {}),
              instance,
              date,
              startAt: interval.start.toISOString(),
              endAt: interval.end.toISOString(),
              firmness: "draft",
              source,
              sourceId,
              plannedPomodoros: Math.max(
                1,
                Math.floor(
                  this.policy.blockDurationMinutes / (25 + this.policy.breakDurationMinutes)
                )
              ),
            });
            blocks.push(block);
            takenIntervals.push(interval);
          }
          instanceIndex += 1;
        }

        cursor = new Date(endCandidate.getTime() + this.policy.minBlockGapMinutes * 60000);
      }
    }

    return blocks;
  }

  relocateBlock(block: Block, existingEvents: EventLike[] = []): Block | null {
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

export function intervalsOverlap(a: TimeSlot, b: TimeSlot): boolean {
  return overlaps(
    { start: new Date(a.startAt), end: new Date(a.endAt) },
    { start: new Date(b.startAt), end: new Date(b.endAt) }
  );
}
