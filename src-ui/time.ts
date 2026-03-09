export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP");
}

export function formatHHmm(value: string | null | undefined): string {
  if (!value) {
    return "--:--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function toLocalInputValue(rfc3339: string | null | undefined): string {
  if (!rfc3339) {
    return "";
  }
  const date = new Date(rfc3339);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

export function fromLocalInputValue(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

export function toTimerText(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.floor(seconds || 0));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function resolveDayBounds(dateValue: string): { dayStart: Date; dayEnd: Date } {
  const parsed = new Date(`${dateValue}T00:00:00`);
  const dayStart = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
}

export function resolveWeekBounds(dateValue: string): { weekStart: Date; weekEnd: Date } {
  const anchor = parseLocalDate(dateValue);
  const weekStart = shiftDateByDays(anchor, -3);
  const weekEnd = shiftDateByDays(anchor, 4);
  return { weekStart, weekEnd };
}

export function shiftDateKey(dateValue: string, offsetDays: number): string {
  return toLocalDateKey(shiftDateByDays(parseLocalDate(dateValue), offsetDays));
}

export function resolveVisibleWeekDateKeys(dateValue: string): string[] {
  const { weekStart } = resolveWeekBounds(dateValue);
  return Array.from({ length: 7 }, (_, index) => toLocalDateKey(shiftDateByDays(weekStart, index)));
}

export function resolveWeekBufferDateKeys(dateValue: string): string[] {
  const bufferStart = shiftDateByDays(parseLocalDate(dateValue), -10);
  return Array.from({ length: 21 }, (_, index) => toLocalDateKey(shiftDateByDays(bufferStart, index)));
}

export function resolveWeekDateKeys(dateValue: string): string[] {
  return resolveVisibleWeekDateKeys(dateValue);
}

export function clampDateKeyToBuffer(anchorDate: string, bufferAnchorDate: string): string {
  const bufferDateKeys = resolveWeekBufferDateKeys(bufferAnchorDate);
  if (bufferDateKeys.includes(anchorDate)) {
    return anchorDate;
  }
  if (bufferDateKeys.length === 0) {
    return anchorDate;
  }
  const firstDateKey = bufferDateKeys[0] || anchorDate;
  const lastDateKey = bufferDateKeys[bufferDateKeys.length - 1] || anchorDate;
  return anchorDate < firstDateKey ? firstDateKey : lastDateKey;
}

export function toSyncWindowPayload(
  dateValue: string,
  scope: "day" | "week" = "day"
): { time_min: string; time_max: string } {
  if (scope === "week") {
    const bufferDateKeys = resolveWeekBufferDateKeys(dateValue);
    const weekStart = parseLocalDate(bufferDateKeys[0] || dateValue);
    const weekEnd = shiftDateByDays(parseLocalDate(bufferDateKeys[bufferDateKeys.length - 1] || dateValue), 1);
    return {
      time_min: weekStart.toISOString(),
      time_max: weekEnd.toISOString(),
    };
  }
  const { dayStart, dayEnd } = resolveDayBounds(dateValue);
  return {
    time_min: dayStart.toISOString(),
    time_max: dayEnd.toISOString(),
  };
}

export function parseLocalDate(dateValue: string): Date {
  const parsed = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    const fallback = new Date();
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

export function shiftDateByDays(baseDate: Date, offsetDays: number): Date {
  const next = new Date(baseDate);
  next.setDate(baseDate.getDate() + offsetDays);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function toMonthDayLabel(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}`;
}
