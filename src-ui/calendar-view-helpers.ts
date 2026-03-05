export function toClockText(milliseconds: number, options: Intl.DateTimeFormatOptions = {}): string {
  return new Date(milliseconds).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...options,
  });
}

export function toDurationLabel(totalMinutes: number): string {
  if (totalMinutes <= 0) return "0m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

export function intervalRangeLabel(interval: unknown): string {
  const source = (interval ?? {}) as { startMs?: number; endMs?: number };
  return `${toClockText(Number(source.startMs || 0))} - ${toClockText(Number(source.endMs || 0))}`;
}
