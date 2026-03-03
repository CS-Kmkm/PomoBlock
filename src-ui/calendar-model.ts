export type TimelineInterval = {
  startMs: number;
  endMs: number;
};

export function dayItemKey(kind: unknown, id: unknown): string {
  return `${String(kind)}:${String(id)}`;
}

export function minutesBetween(startMs: unknown, endMs: unknown): number {
  return Math.max(0, Math.round((Number(endMs) - Number(startMs)) / 60000));
}

export function toClippedInterval(
  startAt: unknown,
  endAt: unknown,
  dayStartMs: unknown,
  dayEndMs: unknown
): TimelineInterval | null {
  const startMs = new Date(String(startAt)).getTime();
  const endMs = new Date(String(endAt)).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }
  const clippedStart = Math.max(startMs, Number(dayStartMs));
  const clippedEnd = Math.min(endMs, Number(dayEndMs));
  if (clippedEnd <= clippedStart) {
    return null;
  }
  return { startMs: clippedStart, endMs: clippedEnd };
}

export function mergeTimelineIntervals(intervals: TimelineInterval[]): TimelineInterval[] {
  if (!intervals.length) {
    return [];
  }
  const sorted = [...intervals].sort((left, right) => left.startMs - right.startMs);
  const first = sorted[0];
  if (!first) {
    return [];
  }
  const merged: TimelineInterval[] = [{ startMs: first.startMs, endMs: first.endMs }];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const last = merged[merged.length - 1];
    if (!current || !last) {
      continue;
    }
    if (current.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, current.endMs);
      continue;
    }
    merged.push({ startMs: current.startMs, endMs: current.endMs });
  }
  return merged;
}

export function toTimelineIntervals(
  items: Array<{ start_at: string; end_at: string }>,
  dayStartMs: unknown,
  dayEndMs: unknown
): TimelineInterval[] {
  const intervals = items
    .map((item) => toClippedInterval(item.start_at, item.end_at, dayStartMs, dayEndMs))
    .filter((slot): slot is TimelineInterval => slot !== null);
  return mergeTimelineIntervals(intervals);
}

export function invertTimelineIntervals(
  dayStartMs: unknown,
  dayEndMs: unknown,
  busyIntervals: TimelineInterval[]
): TimelineInterval[] {
  const safeDayStartMs = Number(dayStartMs);
  const safeDayEndMs = Number(dayEndMs);
  if (safeDayEndMs <= safeDayStartMs) {
    return [];
  }
  if (!busyIntervals.length) {
    return [{ startMs: safeDayStartMs, endMs: safeDayEndMs }];
  }
  const freeIntervals: TimelineInterval[] = [];
  let cursor = safeDayStartMs;
  busyIntervals.forEach((interval) => {
    if (interval.startMs > cursor) {
      freeIntervals.push({ startMs: cursor, endMs: interval.startMs });
    }
    if (interval.endMs > cursor) {
      cursor = interval.endMs;
    }
  });
  if (cursor < safeDayEndMs) {
    freeIntervals.push({ startMs: cursor, endMs: safeDayEndMs });
  }
  return freeIntervals;
}

export function sumIntervalMinutes(intervals: TimelineInterval[]): number {
  return intervals.reduce((total, interval) => total + minutesBetween(interval.startMs, interval.endMs), 0);
}
