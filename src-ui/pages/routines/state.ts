import type {
  JsonObject,
  JsonValue,
  ModuleFolder,
  RoutineScheduleEntry,
  RoutineScheduleRecurrence,
  RoutineStudioEntry,
  RoutineStudioModuleEditor,
  RoutineStudioState,
} from "../../types.js";
import {
  deriveModuleFolders,
  nextRoutineStudioEntryId,
  toPositiveInt,
  type RoutineStudioModuleView,
} from "./model.js";

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

function toJsonObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return { ...(value as Record<string, JsonValue>) };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function normalizeWeekdayList(value: unknown): string[] {
  const allowed = new Set(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);
  const normalized = toStringArray(value)
    .map((item) => item.toLowerCase())
    .filter((item) => allowed.has(item));
  return normalized.length > 0 ? normalized : ["mon"];
}

function normalizeTimeValue(value: unknown, fallback = "09:00"): string {
  const text = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

function normalizeDateValue(value: unknown): string {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function normalizeStudioEntry(entry: unknown, index: number): RoutineStudioEntry {
  const source = (entry ?? {}) as Record<string, unknown>;
  const rawStep = toJsonObject(source.rawStep) ?? {};
  const groupId = String(source.groupId || source.group_id || rawStep.groupId || rawStep.group_id || "");
  const moduleId = String(source.moduleId || source.module_id || rawStep.moduleId || rawStep.module_id || "");
  const note = String(source.note || rawStep.note || "");
  const stepType = String(source.stepType || source.step_type || source.type || rawStep.type || rawStep.stepType || rawStep.step_type || "micro");
  const checklist = toStringArray(source.checklist ?? rawStep.checklist);
  const pomodoro = toJsonObject(source.pomodoro ?? rawStep.pomodoro);
  const executionHints = toJsonObject(source.executionHints ?? source.execution_hints ?? rawStep.executionHints ?? rawStep.execution_hints);
  const overrunPolicy = String(
    source.overrunPolicy || source.overrun_policy || rawStep.overrunPolicy || rawStep.overrun_policy || "wait",
  );
  return {
    entryId: String(source.entryId || nextRoutineStudioEntryId()),
    sourceKind: String(source.sourceKind || source.source_kind || "module"),
    sourceId: String(source.sourceId || source.source_id || ""),
    ...(groupId ? { groupId } : {}),
    moduleId,
    title: String(source.title || `Step ${index + 1}`),
    subtitle: String(source.subtitle || ""),
    durationMinutes: toPositiveInt(source.durationMinutes || source.duration_minutes, 5),
    note,
    stepType,
    checklist,
    pomodoro,
    executionHints,
    overrunPolicy,
    rawStep: {
      ...rawStep,
      type: stepType,
      title: String(source.title || rawStep.title || `Step ${index + 1}`),
      durationSeconds: Math.max(60, toPositiveInt(source.durationMinutes || source.duration_minutes || rawStep.durationSeconds || rawStep.duration_seconds, 5) * 60),
      ...(moduleId ? { moduleId } : {}),
      ...(note ? { note } : {}),
      ...(checklist.length > 0 ? { checklist: [...checklist] } : {}),
      ...(pomodoro ? { pomodoro } : {}),
      ...(executionHints ? { executionHints } : {}),
      ...(overrunPolicy ? { overrunPolicy } : {}),
    },
  };
}

export function normalizeStudioModuleFolder(folder: unknown, index: number): ModuleFolder {
  const source = (folder ?? {}) as Record<string, unknown>;
  const id = String(source.id || source.name || `Folder ${index + 1}`).trim() || `Folder ${index + 1}`;
  return {
    id,
    name: String(source.name || id).trim() || id,
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

export function normalizeRoutineScheduleEntry(entry: unknown, index: number): RoutineScheduleEntry {
  const source = (entry ?? {}) as Record<string, unknown>;
  const assetKind = String(source.assetKind || source.asset_kind || "template").toLowerCase() === "module" ? "module" : "template";
  const id = String(source.id || `schedule-entry-${index + 1}`).trim() || `schedule-entry-${index + 1}`;
  return {
    id,
    assetKind,
    assetId: String(source.assetId || source.asset_id || "").trim(),
    recipeId: String(source.recipeId || source.recipe_id || "").trim(),
    moduleId: String(source.moduleId || source.module_id || "").trim(),
    title: String(source.title || `Schedule ${index + 1}`),
    subtitle: String(source.subtitle || ""),
    startTime: normalizeTimeValue(source.startTime || source.start_time, "09:00"),
    durationMinutes: toPositiveInt(source.durationMinutes || source.duration_minutes, 25),
  };
}

export function normalizeRoutineScheduleRecurrence(value: unknown): RoutineScheduleRecurrence {
  const source = (value ?? {}) as Record<string, unknown>;
  const repeatTypeRaw = String(source.repeatType || source.repeat_type || source.type || "weekly").toLowerCase();
  const repeatType =
    repeatTypeRaw === "monthly_date" || repeatTypeRaw === "monthly_nth" || repeatTypeRaw === "weekly"
      ? repeatTypeRaw
      : "weekly";
  return {
    repeatType,
    weekdays: normalizeWeekdayList(source.weekdays || source.days || []),
    dayOfMonth: toPositiveInt(source.dayOfMonth || source.day_of_month || source.day, 1),
    nthWeek: Math.max(1, Math.min(5, toPositiveInt(source.nthWeek || source.nth_week || source.nth, 1))),
    nthWeekday: normalizeWeekdayList([source.nthWeekday || source.nth_weekday || source.weekday || "mon"])[0] || "mon",
    startDate: normalizeDateValue(source.startDate || source.start_date),
    endDate: normalizeDateValue(source.endDate || source.end_date),
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

export function ensureStudioModuleFolders(studio: RoutineStudioState): void {
  const normalizedFolders = Array.isArray(studio.moduleFolders)
    ? studio.moduleFolders.map(normalizeStudioModuleFolder)
    : [];
  const derivedFolders = deriveModuleFolders(Array.isArray(studio.modules) ? studio.modules : []);
  const seen = new Set<string>();
  const mergedFolders = [...normalizedFolders, ...derivedFolders].filter((folder) => {
    const id = String(folder?.id || "").trim();
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
  studio.moduleFolders = mergedFolders;
  if (studio.moduleEditor && studio.moduleFolders.length > 0) {
    const hasFolder = studio.moduleFolders.some((folder) => folder.id === studio.moduleEditor?.category);
    if (!hasFolder) {
      studio.moduleEditor.category = studio.moduleFolders[0]?.id || "General";
    }
  }
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
