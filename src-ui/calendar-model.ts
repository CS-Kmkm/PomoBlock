import { isoDate, parseLocalDate, resolveDayBounds, resolveWeekDateKeys, toLocalDateKey, toMonthDayLabel } from "./time.js";
import type { DayItemSelection as UiDayItemSelection } from "./types.js";

export type TimelineInterval = {
  startMs: number;
  endMs: number;
};

export type DayItemSelection = UiDayItemSelection;

type CalendarItem = {
  kind: string;
  id: string;
  key: string;
  title: string;
  subtitle: string;
  startMs: number;
  endMs: number;
  durationMinutes: number;
  payload: unknown;
};

type DailyModel = {
  dayStartMs: number;
  dayEndMs: number;
  blockIntervals: TimelineInterval[];
  eventIntervals: TimelineInterval[];
  busyIntervals: TimelineInterval[];
  freeIntervals: TimelineInterval[];
  blockItems: CalendarItem[];
  eventItems: CalendarItem[];
  freeItems: CalendarItem[];
  selectedItem: CalendarItem | null;
  selection: DayItemSelection;
  totals: {
    blockMinutes: number;
    eventMinutes: number;
    freeMinutes: number;
  };
};

type BuildDailyOptions = {
  syncSelection?: boolean;
  preferredSelection?: DayItemSelection;
  currentSelection?: DayItemSelection;
  blockDisplayName: (block: unknown) => string;
};

type BuildWeeklyOptions = {
  currentSelection?: DayItemSelection;
  buildDaily: (dateKey: string, options: { syncSelection: boolean; preferredSelection?: DayItemSelection }) => DailyModel;
};

type PlannerStripDay = DailyModel & {
  dayKey: string;
  dayDate: Date;
  dayNumber: string;
  monthDayLabel: string;
  weekdayLabel: string;
  isCurrent: boolean;
  isToday: boolean;
  combinedItems: CalendarItem[];
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

export function buildDailyCalendarModel(
  dateValue: unknown,
  blocks: unknown[],
  events: unknown[],
  options: BuildDailyOptions
): DailyModel {
  const syncSelection = options.syncSelection !== false;
  const preferredSelection = options.preferredSelection || null;
  const { dayStart, dayEnd } = resolveDayBounds(String(dateValue ?? ""));
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();

  const blockItems = (Array.isArray(blocks) ? blocks : [])
    .map((block) => {
      const typed = block as { id?: string; start_at?: string; end_at?: string; firmness?: string };
      const interval = toClippedInterval(typed.start_at, typed.end_at, dayStartMs, dayEndMs);
      if (!interval || typeof typed.id !== "string") {
        return null;
      }
      return {
        kind: "block",
        id: typed.id,
        key: dayItemKey("block", typed.id),
        title: options.blockDisplayName(block),
        subtitle: typed.firmness || "draft",
        startMs: interval.startMs,
        endMs: interval.endMs,
        durationMinutes: minutesBetween(interval.startMs, interval.endMs),
        payload: block,
      } satisfies CalendarItem;
    })
    .filter((item): item is CalendarItem => item !== null)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);

  const eventItems = (Array.isArray(events) ? events : [])
    .map((event) => {
      const typed = event as { id?: string; start_at?: string; end_at?: string; title?: string; account_id?: string };
      const interval = toClippedInterval(typed.start_at, typed.end_at, dayStartMs, dayEndMs);
      if (!interval || typeof typed.id !== "string") {
        return null;
      }
      return {
        kind: "event",
        id: typed.id,
        key: dayItemKey("event", typed.id),
        title: typed.title || "予定",
        subtitle: typed.account_id || "default",
        startMs: interval.startMs,
        endMs: interval.endMs,
        durationMinutes: minutesBetween(interval.startMs, interval.endMs),
        payload: event,
      } satisfies CalendarItem;
    })
    .filter((item): item is CalendarItem => item !== null)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);

  const blockIntervals = toTimelineIntervals((Array.isArray(blocks) ? blocks : []) as Array<{ start_at: string; end_at: string }>, dayStartMs, dayEndMs);
  const eventIntervals = toTimelineIntervals((Array.isArray(events) ? events : []) as Array<{ start_at: string; end_at: string }>, dayStartMs, dayEndMs);
  const busyIntervals = mergeTimelineIntervals([...blockIntervals, ...eventIntervals]);
  const freeIntervals = invertTimelineIntervals(dayStartMs, dayEndMs, busyIntervals);
  const freeItems = freeIntervals
    .filter((interval) => minutesBetween(interval.startMs, interval.endMs) >= 10)
    .map((interval) => ({
      kind: "free",
      id: `${interval.startMs}-${interval.endMs}`,
      key: dayItemKey("free", `${interval.startMs}-${interval.endMs}`),
      title: "空き枠",
      subtitle: "available",
      startMs: interval.startMs,
      endMs: interval.endMs,
      durationMinutes: minutesBetween(interval.startMs, interval.endMs),
      payload: interval,
    } satisfies CalendarItem));

  const allItems = [...blockItems, ...eventItems, ...freeItems];
  const itemMap = new Map(allItems.map((item) => [item.key, item]));
  const selectionSource =
    preferredSelection && typeof preferredSelection.kind === "string" && typeof preferredSelection.id === "string"
      ? preferredSelection
      : options.currentSelection || null;

  const selectedByState = selectionSource ? itemMap.get(dayItemKey(selectionSource.kind, selectionSource.id)) : null;
  const selectedItem = selectedByState || blockItems[0] || eventItems[0] || freeItems[0] || null;
  const selection = syncSelection && selectedItem ? { kind: selectedItem.kind, id: selectedItem.id } : syncSelection ? null : options.currentSelection || null;

  return {
    dayStartMs,
    dayEndMs,
    blockIntervals,
    eventIntervals,
    busyIntervals,
    freeIntervals,
    blockItems,
    eventItems,
    freeItems,
    selectedItem,
    selection,
    totals: {
      blockMinutes: sumIntervalMinutes(blockIntervals),
      eventMinutes: sumIntervalMinutes(eventIntervals),
      freeMinutes: sumIntervalMinutes(freeIntervals),
    },
  };
}

export function buildWeeklyPlannerModel(
  dateValue: unknown,
  options: BuildWeeklyOptions
): { days: PlannerStripDay[]; selectedItem: CalendarItem | null; weekLabel: string; selection: DayItemSelection } {
  const anchor = parseLocalDate(String(dateValue ?? ""));
  const dateKey = toLocalDateKey(anchor);
  const weekDateKeys = resolveWeekDateKeys(dateKey);
  return buildPlannerStripModel(weekDateKeys, dateKey, options);
}

export function buildPlannerStripModel(
  dateKeys: string[],
  currentDateKey: string,
  options: BuildWeeklyOptions
): { days: PlannerStripDay[]; selectedItem: CalendarItem | null; weekLabel: string; selection: DayItemSelection } {
  const safeDateKeys = (Array.isArray(dateKeys) ? dateKeys : []).filter((dateKey): dateKey is string => Boolean(dateKey));
  const fallbackDateKey = safeDateKeys[0] || currentDateKey;
  const normalizedCurrentDateKey = currentDateKey || fallbackDateKey;
  const weekStart = parseLocalDate(fallbackDateKey);
  const todayDateKey = isoDate(new Date());
  const weekdayLabels = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const days = safeDateKeys.map((dayKey) => {
    const dayDate = parseLocalDate(dayKey);
    const dailyModel = options.buildDaily(dayKey, { syncSelection: false });
    const combinedItems = [...dailyModel.blockItems, ...dailyModel.eventItems, ...dailyModel.freeItems].sort(
      (left, right) => left.startMs - right.startMs || left.endMs - right.endMs
    );
    return {
      ...dailyModel,
      dayKey,
      dayDate,
      dayNumber: String(dayDate.getDate()).padStart(2, "0"),
      monthDayLabel: toMonthDayLabel(dayDate),
      weekdayLabel: weekdayLabels[dayDate.getDay()] || "N/A",
      isCurrent: dayKey === normalizedCurrentDateKey,
      isToday: dayKey === todayDateKey,
      combinedItems,
    };
  });

  const allItems = days.flatMap((day) => day.combinedItems);
  const itemMap = new Map(allItems.map((item) => [item.key, item]));
  const selectedByState = options.currentSelection
    ? itemMap.get(dayItemKey(options.currentSelection.kind, options.currentSelection.id))
    : null;
  const currentDay = days.find((day) => day.isCurrent) || days[0] || null;
  const firstAvailable = days.find((day) => day.combinedItems.length > 0)?.combinedItems[0] || null;
  const selectedItem = selectedByState || currentDay?.combinedItems[0] || firstAvailable || null;
  const selection = selectedItem ? { kind: selectedItem.kind, id: selectedItem.id } : null;
  const visibleStart = currentDay ? Math.max(0, days.indexOf(currentDay) - 3) : 0;
  const visibleEnd = Math.min(days.length - 1, visibleStart + 6);
  const labelStartDate = days[visibleStart]?.dayDate || weekStart;
  const labelEndDate = days[visibleEnd]?.dayDate || days[days.length - 1]?.dayDate || weekStart;
  const weekLabel = `${labelStartDate.getFullYear()} ${toMonthDayLabel(labelStartDate)} - ${toMonthDayLabel(labelEndDate)}`;

  return {
    days,
    selectedItem,
    weekLabel,
    selection,
  };
}
