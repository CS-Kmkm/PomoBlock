import type { RoutineStudioEntry } from "../../../types.js";

export type RoutineStudioEntryGroupBounds = {
  start: number;
  end: number;
};

export type RoutineStudioEntryGroup = {
  entryId: string;
  groupId: string;
  start: number;
  end: number;
  isGrouped: boolean;
  totalMinutes: number;
  entries: RoutineStudioEntry[];
};

export function resolveStudioEntryGroupBoundsAtIndex(
  entries: RoutineStudioEntry[],
  index: number,
): RoutineStudioEntryGroupBounds | null {
  if (index < 0 || index >= entries.length) {
    return null;
  }
  const anchor = entries[index];
  if (!anchor) {
    return null;
  }
  const groupId = String(anchor.groupId || "");
  if (!groupId) {
    return { start: index, end: index };
  }
  let start = index;
  while (start > 0 && String(entries[start - 1]?.groupId || "") === groupId) {
    start -= 1;
  }
  let end = index;
  while (end + 1 < entries.length && String(entries[end + 1]?.groupId || "") === groupId) {
    end += 1;
  }
  return { start, end };
}

export function resolveStudioEntryGroupBounds(
  entries: RoutineStudioEntry[],
  entryId: string,
): RoutineStudioEntryGroupBounds | null {
  return resolveStudioEntryGroupBoundsAtIndex(
    entries,
    entries.findIndex((entry) => String(entry.entryId || "") === entryId),
  );
}

export function resolveStudioEntryGroupEntries(
  entries: RoutineStudioEntry[],
  entryId: string,
): RoutineStudioEntry[] {
  const bounds = resolveStudioEntryGroupBounds(entries, entryId);
  return bounds ? entries.slice(bounds.start, bounds.end + 1) : [];
}

export function collectStudioEntryGroups(entries: RoutineStudioEntry[]): RoutineStudioEntryGroup[] {
  const groups: RoutineStudioEntryGroup[] = [];
  let index = 0;
  while (index < entries.length) {
    const bounds = resolveStudioEntryGroupBoundsAtIndex(entries, index);
    if (!bounds) {
      index += 1;
      continue;
    }
    const groupEntries = entries.slice(bounds.start, bounds.end + 1);
    const anchor = groupEntries[0];
    if (!anchor) {
      index = bounds.end + 1;
      continue;
    }
    groups.push({
      entryId: String(anchor.entryId || ""),
      groupId: String(anchor.groupId || ""),
      start: bounds.start,
      end: bounds.end,
      isGrouped: groupEntries.length > 1 && Boolean(anchor.groupId),
      totalMinutes: groupEntries.reduce((sum, entry) => sum + Math.max(1, Number(entry.durationMinutes) || 0), 0),
      entries: groupEntries,
    });
    index = bounds.end + 1;
  }
  return groups;
}

export function canMoveStudioEntryGroup(
  entries: RoutineStudioEntry[],
  entryId: string,
  direction: "up" | "down",
): boolean {
  const bounds = resolveStudioEntryGroupBounds(entries, entryId);
  if (!bounds) {
    return false;
  }
  return direction === "up" ? bounds.start > 0 : bounds.end < entries.length - 1;
}

export function removeStudioEntryGroup(
  entries: RoutineStudioEntry[],
  entryId: string,
): RoutineStudioEntry[] {
  const bounds = resolveStudioEntryGroupBounds(entries, entryId);
  if (!bounds) {
    return [...entries];
  }
  return entries.filter((_, index) => index < bounds.start || index > bounds.end);
}

export function moveStudioEntryGroupToIndex(
  entries: RoutineStudioEntry[],
  entryId: string,
  insertIndex: number,
): RoutineStudioEntry[] {
  const bounds = resolveStudioEntryGroupBounds(entries, entryId);
  if (!bounds) {
    return [...entries];
  }
  const clampedInsertIndex = Math.max(0, Math.min(insertIndex, entries.length));
  if (clampedInsertIndex >= bounds.start && clampedInsertIndex <= bounds.end + 1) {
    return [...entries];
  }
  const groupEntries = entries.slice(bounds.start, bounds.end + 1);
  const remaining = removeStudioEntryGroup(entries, entryId);
  const adjustedInsertIndex =
    clampedInsertIndex > bounds.end ? clampedInsertIndex - groupEntries.length : clampedInsertIndex;
  remaining.splice(Math.max(0, Math.min(adjustedInsertIndex, remaining.length)), 0, ...groupEntries);
  return remaining;
}

export function moveStudioEntryGroupByDirection(
  entries: RoutineStudioEntry[],
  entryId: string,
  direction: "up" | "down",
): RoutineStudioEntry[] {
  const bounds = resolveStudioEntryGroupBounds(entries, entryId);
  if (!bounds) {
    return [...entries];
  }
  if (direction === "up") {
    const previousBounds = resolveStudioEntryGroupBoundsAtIndex(entries, bounds.start - 1);
    return previousBounds ? moveStudioEntryGroupToIndex(entries, entryId, previousBounds.start) : [...entries];
  }
  const nextBounds = resolveStudioEntryGroupBoundsAtIndex(entries, bounds.end + 1);
  return nextBounds ? moveStudioEntryGroupToIndex(entries, entryId, nextBounds.end + 1) : [...entries];
}
