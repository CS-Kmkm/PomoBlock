import type { CommandService } from "./services/command-service.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type Block = {
  id: string;
  date: string;
  start_at: string;
  end_at: string;
  firmness: string;
  instance: string;
  planned_pomodoros: number;
  source: string;
  source_id: string | null;
  recipe_id?: string;
  auto_drive_mode?: string;
  contents?: unknown;
};

export type SyncedEvent = {
  account_id: string;
  id: string;
  title: string;
  start_at: string;
  end_at: string;
};

export type Task = {
  id: string;
  title: string;
  description: string | null;
  estimated_pomodoros: number | null;
  status: string;
  completed_pomodoros: number;
};

export type PomodoroState = {
  current_block_id: string | null;
  current_task_id: string | null;
  phase: string;
  remaining_seconds: number;
  start_time: string | null;
  total_cycles: number;
  completed_cycles: number;
  current_cycle: number;
  focus_seconds?: number;
  break_seconds?: number;
  paused_phase?: string | null;
};

export type ReflectionLogItem = {
  id: string;
  block_id: string;
  task_id: string | null;
  phase: string;
  start_time: string;
  end_time: string | null;
  interruption_reason: string | null;
};

export type ReflectionSummary = {
  start: string;
  end: string;
  completed_count: number;
  interrupted_count: number;
  total_focus_minutes: number;
  logs: ReflectionLogItem[];
};

export type RecipeStep = {
  id: string;
  type: string;
  title: string;
  durationSeconds: number;
  moduleId?: string;
  checklist?: string[];
  note?: string;
  executionHints?: JsonObject | null;
  pomodoro?: JsonObject | null;
};

export type Recipe = {
  id: string;
  name: string;
  auto_drive_mode?: string;
  studioMeta?: JsonObject;
  steps: RecipeStep[];
  [key: string]: unknown;
};

export type Module = {
  id: string;
  name: string;
  category?: string;
  description?: string;
  icon?: string;
  durationMinutes?: number;
  stepType?: string;
  checklist?: string[];
  pomodoro?: JsonObject | null;
  overrunPolicy?: string;
  executionHints?: JsonObject | null;
  [key: string]: unknown;
};

export type DayItemKind = string;
export type DayItemSelection = { kind: DayItemKind; id: string } | null;
export type DayCalendarViewMode = "grid" | "simple";

export interface RoutineStudioState {
  assetsLoaded: boolean;
  assetsLoading: boolean;
  activeTab: string;
  subPage: string;
  search: string;
  draftName: string;
  templateId: string;
  triggerTime: string;
  context: string;
  autoStart: boolean;
  macroTargetMinutes: number;
  modules: Module[];
  hiddenTemplateCount: number;
  canvasEntries: Array<Record<string, unknown>>;
  history: Array<Array<Record<string, unknown>>>;
  historyIndex: number;
  dragInsertIndex: number;
  selectedEntryId: string;
  entryEditorEntryId: string;
  editingModuleId: string;
  lastApplyResult: string;
  bootstrapped: boolean;
  moduleEditor: JsonObject | null;
  [key: string]: unknown;
}

export interface UiState {
  auth: JsonObject | null;
  accountId: string;
  dashboardDate: string;
  blocks: Block[];
  blocksVisibleCount: number;
  calendarEvents: SyncedEvent[];
  tasks: Task[];
  pomodoro: PomodoroState | null;
  reflection: ReflectionSummary | null;
  recipes: Recipe[];
  dayCalendarSelection: DayItemSelection;
  dayCalendarViewMode: DayCalendarViewMode;
  blockTitles: Record<string, string>;
  nowUi: {
    taskOrder: string[];
    phaseTotalSeconds: number;
    displayRemainingSeconds: number;
    lastPhase: string;
    lastSyncEpochMs: number;
    lastReflectionSyncEpochMs: number;
    actionInFlight: boolean;
  };
  routineStudio: RoutineStudioState;
  settings: {
    page: string;
    workStart: string;
    workEnd: string;
    blockDuration: number;
    breakDuration: number;
    gitRemote: string;
  };
}

export interface PageRenderDeps {
  uiState: UiState;
  appRoot: HTMLElement;
  services: CommandService;
  setStatus: (message: string) => void;
  refreshCoreData: (date?: string) => Promise<void>;
  authenticateAndSyncCalendar: (date?: string, options?: Record<string, unknown>) => Promise<unknown>;
  settingsPages: string[];
  settingsPageLabels: Record<string, string>;
  helpers: {
    normalizeAccountId: (value: unknown) => string;
    withAccount: (payload?: Record<string, unknown>) => Record<string, unknown>;
    isoDate: (value: Date) => string;
    formatTime: (value: string | null | undefined) => string;
  };
  renderers: {
    renderDashboard: () => void;
    renderTodayDetailsPage: () => void;
    renderPomodoro: () => void;
    renderRoutines: () => void;
    renderReflection: () => void;
    renderSettings: () => void;
    renderBlocks: () => void;
  };
}

export interface MockState {
  sequence: number;
  tasks: Task[];
  blocks: Block[];
  recipes: Recipe[];
  modules: Module[];
  syncedEventsByAccount: Record<string, SyncedEvent[]>;
  taskAssignmentsByTask: Record<string, string>;
  taskAssignmentsByBlock: Record<string, string>;
  pomodoro: PomodoroState;
  logs: ReflectionLogItem[];
}

export interface ProgressState {
  active: boolean;
  command: string;
  label: string;
  percent: number;
  timerId: ReturnType<typeof setTimeout> | 0;
  hideTimerId: ReturnType<typeof setTimeout> | 0;
}

export interface DayBlockDragState {
  active: boolean;
  moved: boolean;
  pointerId: number | null;
  blockId: string;
  dayStartMs: number;
  dayEndMs: number;
  rangeMs: number;
  trackHeightPx: number;
  trackWidthPx: number;
  originClientY: number;
  originClientX: number;
  originStartMs: number;
  originEndMs: number;
  previewStartMs: number;
  previewEndMs: number;
  suppressClickUntil: number;
  originalTopCss: string;
  originalLeftCss: string;
  originalTimeLabelText: string;
  originalTitle: string;
  hoveredFreeEntry: HTMLElement | null;
  entry: HTMLButtonElement | null;
  timeLabel: HTMLElement | null;
  onMove: ((event: PointerEvent) => void) | null;
  onUp: ((event: PointerEvent) => void) | null;
}
