import type { RoutineStudioEntry, RoutineStudioModuleEditor, RoutineStudioState } from "../types.js";
import {
  nextRoutineStudioEntryId,
  toPositiveInt,
  type RoutineStudioModuleView,
} from "./routines-model.js";

export function normalizeStudioModule(module: unknown, index: number): RoutineStudioModuleView {
  const source = (module ?? {}) as Record<string, unknown>;
  const id = String(source.id || `mod-${index + 1}`).trim() || `mod-${index + 1}`;
  const durationMinutes = toPositiveInt(source.durationMinutes || source.duration_minutes, 1);
  return {
    id,
    name: String(source.name || id),
    category: String(source.category || "General"),
    description: String(source.description || ""),
    icon: String(source.icon || "module"),
    durationMinutes,
  };
}

export function normalizeStudioEntry(entry: unknown, index: number): RoutineStudioEntry {
  const source = (entry ?? {}) as Record<string, unknown>;
  return {
    entryId: String(source.entryId || nextRoutineStudioEntryId()),
    sourceKind: String(source.sourceKind || source.source_kind || "module"),
    sourceId: String(source.sourceId || source.source_id || ""),
    moduleId: String(source.moduleId || source.module_id || ""),
    title: String(source.title || `Step ${index + 1}`),
    subtitle: String(source.subtitle || ""),
    durationMinutes: toPositiveInt(source.durationMinutes || source.duration_minutes, 5),
    note: String(source.note || ""),
  };
}

export function normalizeStudioModuleEditor(editor: unknown): RoutineStudioModuleEditor {
  const source = (editor ?? {}) as Record<string, unknown>;
  return {
    id: String(source.id || ""),
    name: String(source.name || ""),
    category: String(source.category || "General"),
    description: String(source.description || ""),
    icon: String(source.icon || "module"),
    durationMinutes: toPositiveInt(source.durationMinutes || source.duration_minutes, 5),
  };
}

export function toEntryRecords(entries: RoutineStudioEntry[]): RoutineStudioEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

export function readStudioEntryId(entry: RoutineStudioEntry | undefined): string {
  return String(entry?.entryId || "");
}

export function createEmptyStudioModuleEditor(): RoutineStudioModuleEditor {
  return normalizeStudioModuleEditor({
    id: "",
    name: "",
    category: "General",
    description: "",
    icon: "module",
    durationMinutes: 5,
  });
}

export function pushStudioHistorySnapshot(params: {
  studio: RoutineStudioState;
  cloneValue: <T>(value: T) => T;
  normalizeEntry: (entry: unknown, index: number) => RoutineStudioEntry;
}): void {
  const { studio, cloneValue, normalizeEntry } = params;
  const snapshot = cloneValue(studio.canvasEntries.map((entry, index) => normalizeEntry(entry, index)));
  const current = studio.historyIndex >= 0 && studio.historyIndex < studio.history.length ? studio.history[studio.historyIndex] : null;
  if (current && JSON.stringify(current) === JSON.stringify(snapshot)) {
    return;
  }
  const truncated = studio.history.slice(0, studio.historyIndex + 1);
  truncated.push(snapshot);
  if (truncated.length > 50) {
    truncated.shift();
  }
  studio.history = truncated;
  studio.historyIndex = studio.history.length - 1;
}

export function applyStudioCanvasEntries(params: {
  studio: RoutineStudioState;
  nextEntries: RoutineStudioEntry[];
  normalizeEntry: (entry: unknown, index: number) => RoutineStudioEntry;
  toEntryRecords: (entries: RoutineStudioEntry[]) => RoutineStudioEntry[];
  readEntryId: (entry: RoutineStudioEntry | undefined) => string;
  recordHistory?: boolean;
  pushHistory: () => void;
}): void {
  const { studio, nextEntries, normalizeEntry, toEntryRecords, readEntryId, recordHistory = true, pushHistory } = params;
  const normalizedEntries = (Array.isArray(nextEntries) ? nextEntries : []).map((entry, index) => normalizeEntry(entry, index));
  studio.canvasEntries = toEntryRecords(normalizedEntries);
  if (studio.canvasEntries.length > 0 && !studio.selectedEntryId) {
    studio.selectedEntryId = readEntryId(studio.canvasEntries[0]);
  }
  if (studio.selectedEntryId && studio.canvasEntries.every((entry) => String(entry.entryId || "") !== studio.selectedEntryId)) {
    studio.selectedEntryId = readEntryId(studio.canvasEntries[0]);
  }
  if (recordHistory) {
    pushHistory();
  }
}

export function updateStudioEntry(params: {
  studio: RoutineStudioState;
  entryId: string;
  updater: (entry: RoutineStudioEntry) => RoutineStudioEntry;
  normalizeEntry: (entry: unknown, index: number) => RoutineStudioEntry;
  applyCanvasEntries: (nextEntries: RoutineStudioEntry[], recordHistory?: boolean) => void;
}): boolean {
  const { studio, entryId, updater, normalizeEntry, applyCanvasEntries } = params;
  const index = studio.canvasEntries.findIndex((entry) => String(entry.entryId || "") === entryId);
  if (index < 0) return false;
  const nextEntries = [...studio.canvasEntries].map((entry, i) => normalizeEntry(entry, i));
  const draft = normalizeEntry(nextEntries[index], index);
  nextEntries[index] = normalizeEntry(updater(draft) || draft, index);
  applyCanvasEntries(nextEntries, true);
  studio.selectedEntryId = entryId;
  return true;
}
