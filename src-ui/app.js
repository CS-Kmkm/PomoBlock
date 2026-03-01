// @ts-check

const appRoot = /** @type {HTMLElement} */ (document.getElementById("app"));
const statusChip = /** @type {HTMLElement | null} */ (document.getElementById("global-status"));
const progressChip = /** @type {HTMLElement | null} */ (document.getElementById("global-progress"));
const progressLabel = /** @type {HTMLElement | null} */ (document.getElementById("global-progress-label"));
const progressFill = /** @type {HTMLElement | null} */ (document.getElementById("global-progress-fill"));
const progressValue = /** @type {HTMLElement | null} */ (document.getElementById("global-progress-value"));

const routes = ["today", "details", "now", "routines", "insights", "settings"];
const settingsPages = ["blocks", "git", "auth"];
const settingsPageLabels = {
  blocks: "ブロック構成",
  git: "Git同期",
  auth: "Google Auth",
};
const longRunningCommands = new Set([
  "sync_calendar",
  "generate_blocks",
  "generate_today_blocks",
  "authenticate_google_sso",
]);
const longRunningLabels = {
  sync_calendar: "カレンダー同期",
  generate_blocks: "ブロック生成",
  generate_today_blocks: "本日ブロック生成",
  authenticate_google_sso: "Google SSO認証",
};
const commandArgAliases = {
  authenticate_google: [
    ["account_id", "accountId"],
    ["authorization_code", "authorizationCode"],
  ],
  authenticate_google_sso: [
    ["account_id", "accountId"],
    ["force_reauth", "forceReauth"],
  ],
  sync_calendar: [
    ["account_id", "accountId"],
    ["time_min", "timeMin"],
    ["time_max", "timeMax"],
  ],
  generate_blocks: [["account_id", "accountId"]],
  generate_today_blocks: [["account_id", "accountId"]],
  generate_one_block: [["account_id", "accountId"]],
  approve_blocks: [["block_ids", "blockIds"]],
  delete_block: [["block_id", "blockId"]],
  adjust_block_time: [
    ["block_id", "blockId"],
    ["start_at", "startAt"],
    ["end_at", "endAt"],
  ],
  list_synced_events: [
    ["account_id", "accountId"],
    ["time_min", "timeMin"],
    ["time_max", "timeMax"],
  ],
  start_pomodoro: [
    ["block_id", "blockId"],
    ["task_id", "taskId"],
  ],
  start_block_timer: [
    ["block_id", "blockId"],
    ["task_id", "taskId"],
  ],
  pause_timer: [["reason", "reason"]],
  interrupt_timer: [["reason", "reason"]],
  update_recipe: [["recipe_id", "recipeId"]],
  delete_recipe: [["recipe_id", "recipeId"]],
  update_module: [["module_id", "moduleId"]],
  delete_module: [["module_id", "moduleId"]],
  apply_studio_template_to_today: [
    ["template_id", "templateId"],
    ["trigger_time", "triggerTime"],
    ["conflict_policy", "conflictPolicy"],
    ["account_id", "accountId"],
  ],
  create_task: [["estimated_pomodoros", "estimatedPomodoros"]],
  update_task: [
    ["task_id", "taskId"],
    ["estimated_pomodoros", "estimatedPomodoros"],
  ],
  delete_task: [["task_id", "taskId"]],
  split_task: [["task_id", "taskId"]],
  carry_over_task: [
    ["task_id", "taskId"],
    ["from_block_id", "fromBlockId"],
    ["candidate_block_ids", "candidateBlockIds"],
  ],
  relocate_if_needed: [
    ["block_id", "blockId"],
    ["account_id", "accountId"],
  ],
};
const progressTargetPercent = 92;
const progressUpdateIntervalMs = 180;
const BLOCKS_INITIAL_VISIBLE = 50;
const DAY_BLOCK_DRAG_SNAP_MINUTES = 5;
const DAY_BLOCK_DRAG_THRESHOLD_PX = 4;
const BLOCK_TITLE_STORAGE_KEY = "pomo_block_titles_v1";

// Routine Studio のドラッグデータを保持するモジュール変数
let routineStudioActiveDrag = /** @type {{ kind: string, id: string } | null} */ (null);
/** @type {{ move: (e: PointerEvent) => void, up: (e: PointerEvent) => void } | null} */
let _rsDragHandlers = null;
/** @type {HTMLElement | null} */
let _rsDragGhost = null;
/** @type {HTMLElement | null} */
let _rsDragSource = null;
let _rsDragOffsetX = 0;
let _rsDragOffsetY = 0;
const routineStudioSeedModules = [
  {
    id: "mod-deep-work-init",
    name: "Deep Work Init",
    category: "Focus Work",
    description: "Environment prep",
    icon: "spark",
    durationMinutes: 5,
    stepType: "micro",
    checklist: ["Close distracting tabs", "Set Slack to Away", "Enable Do Not Disturb"],
    pomodoro: null,
    overrunPolicy: "wait",
    executionHints: {
      allowSkip: true,
      mustCompleteChecklist: false,
      autoAdvance: true,
    },
  },
  {
    id: "mod-pomodoro-focus",
    name: "Pomodoro Focus",
    category: "Focus Work",
    description: "25m work block",
    icon: "timer",
    durationMinutes: 25,
    stepType: "pomodoro",
    pomodoro: {
      focusSeconds: 1500,
      breakSeconds: 300,
      cycles: 1,
      longBreakSeconds: 900,
      longBreakEvery: 4,
    },
    checklist: ["Focus on one task only", "No context switching"],
    overrunPolicy: "wait",
    executionHints: {
      allowSkip: true,
      mustCompleteChecklist: false,
      autoAdvance: true,
    },
  },
  {
    id: "mod-two-min-triage",
    name: "2m Triage",
    category: "Communication",
    description: "Quick inbox sort",
    icon: "mail",
    durationMinutes: 2,
    stepType: "micro",
    checklist: ["Reply, archive, or defer", "No deep replies"],
    pomodoro: null,
    overrunPolicy: "wait",
    executionHints: {
      allowSkip: true,
      mustCompleteChecklist: false,
      autoAdvance: true,
    },
  },
  {
    id: "mod-slack-status",
    name: "Slack Status",
    category: "Communication",
    description: "Update availability",
    icon: "chat",
    durationMinutes: 3,
    stepType: "micro",
    checklist: ["Set current status", "Confirm mention rules"],
    pomodoro: null,
    overrunPolicy: "wait",
    executionHints: {
      allowSkip: true,
      mustCompleteChecklist: false,
      autoAdvance: true,
    },
  },
  {
    id: "mod-break-reset",
    name: "Reset Break",
    category: "Recovery",
    description: "Short recovery",
    icon: "break",
    durationMinutes: 5,
    stepType: "free",
    checklist: ["Leave desk", "Hydrate", "Eye rest"],
    pomodoro: null,
    overrunPolicy: "wait",
    executionHints: {
      allowSkip: true,
      mustCompleteChecklist: false,
      autoAdvance: true,
    },
  },
  {
    id: "mod-plan-next",
    name: "Plan Next",
    category: "Planning",
    description: "Choose next task",
    icon: "plan",
    durationMinutes: 4,
    stepType: "micro",
    checklist: ["Pick next high-impact task", "Write first action"],
    pomodoro: null,
    overrunPolicy: "wait",
    executionHints: {
      allowSkip: true,
      mustCompleteChecklist: false,
      autoAdvance: true,
    },
  },
];
const routineStudioContexts = ["Work - Deep Focus", "Admin", "Planning", "Learning", "Personal"];
const routineStudioMacroTargets = [30, 45, 60, 90];
let routineStudioSequence = 1;

/** @typedef {{id:string,date:string,start_at:string,end_at:string,firmness:string,instance:string,planned_pomodoros:number,source:string,source_id:string|null,recipe_id?:string,auto_drive_mode?:string,contents?:any}} Block */
/** @typedef {{account_id:string,id:string,title:string,start_at:string,end_at:string}} SyncedEvent */
/** @typedef {{id:string,title:string,description:string|null,estimated_pomodoros:number|null,status:string,completed_pomodoros:number}} Task */
/** @typedef {{current_block_id:string|null,current_task_id:string|null,phase:string,remaining_seconds:number,start_time:string|null,total_cycles:number,completed_cycles:number,current_cycle:number}} PomodoroState */
/** @typedef {"block" | "event" | "free"} DayItemKind */
/** @typedef {{kind: DayItemKind, id: string} | null} DayItemSelection */
/** @typedef {"grid" | "simple"} DayCalendarViewMode */

/** @type {{auth: any, accountId: string, dashboardDate: string, blocks: Block[], blocksVisibleCount: number, calendarEvents: SyncedEvent[], tasks: Task[], pomodoro: PomodoroState|null, reflection: any|null, recipes: any[], dayCalendarSelection: DayItemSelection, dayCalendarViewMode: DayCalendarViewMode, blockTitles: Record<string, string>, nowUi: {taskOrder: string[], phaseTotalSeconds: number, displayRemainingSeconds: number, lastPhase: string, lastSyncEpochMs: number, lastReflectionSyncEpochMs: number, actionInFlight: boolean}, settings: any}} */
const uiState = {
  auth: null,
  accountId: "default",
  dashboardDate: isoDate(new Date()),
  blocks: [],
  blocksVisibleCount: BLOCKS_INITIAL_VISIBLE,
  calendarEvents: [],
  tasks: [],
  pomodoro: null,
  reflection: null,
  recipes: [],
  dayCalendarSelection: null,
  dayCalendarViewMode: "grid",
  blockTitles: loadBlockTitles(),
  nowUi: {
    taskOrder: [],
    phaseTotalSeconds: 0,
    displayRemainingSeconds: 0,
    lastPhase: "idle",
    lastSyncEpochMs: 0,
    lastReflectionSyncEpochMs: 0,
    actionInFlight: false,
  },
  routineStudio: {
    assetsLoaded: false,
    assetsLoading: false,
    activeTab: "modules",
    search: "",
    draftName: "Morning Deep Work",
    templateId: "rcp-routine-studio",
    triggerTime: "09:00",
    context: "Work - Deep Focus",
    autoStart: true,
    macroTargetMinutes: 30,
    modules: [],
    hiddenTemplateCount: 0,
    canvasEntries: [],
    history: [],
    historyIndex: -1,
    dragInsertIndex: -1,
    selectedEntryId: "",
    editingModuleId: "",
    moduleEditor: null,
  },
  settings: {
    page: "blocks",
    workStart: "09:00",
    workEnd: "18:00",
    blockDuration: 60,
    breakDuration: 5,
    gitRemote: "",
  },
};

const mockState = {
  sequence: 1,
  tasks: [],
  blocks: [],
  recipes: [],
  modules: [],
  syncedEventsByAccount: {},
  taskAssignmentsByTask: {},
  taskAssignmentsByBlock: {},
  pomodoro: {
    current_block_id: null,
    current_task_id: null,
    phase: "idle",
    remaining_seconds: 0,
    start_time: null,
    total_cycles: 0,
    completed_cycles: 0,
    current_cycle: 0,
    focus_seconds: 1500,
    break_seconds: 300,
    paused_phase: null,
  },
  logs: [],
};

const progressState = {
  active: false,
  command: "",
  label: "",
  percent: 0,
  timerId: 0,
  hideTimerId: 0,
};

const dayBlockDragState = {
  active: false,
  moved: false,
  pointerId: null,
  blockId: "",
  dayStartMs: 0,
  dayEndMs: 0,
  rangeMs: 0,
  trackHeightPx: 0,
  trackWidthPx: 0,
  originClientY: 0,
  originClientX: 0,
  originStartMs: 0,
  originEndMs: 0,
  previewStartMs: 0,
  previewEndMs: 0,
  suppressClickUntil: 0,
  originalTopCss: "",
  originalLeftCss: "",
  originalTimeLabelText: "",
  originalTitle: "",
  hoveredFreeEntry: /** @type {HTMLElement | null} */ (null),
  entry: /** @type {HTMLButtonElement | null} */ (null),
  timeLabel: /** @type {HTMLElement | null} */ (null),
  onMove: /** @type {((event: PointerEvent) => void) | null} */ (null),
  onUp: /** @type {((event: PointerEvent) => void) | null} */ (null),
};

function nextMockId(prefix) {
  const id = `${prefix}-${Date.now()}-${mockState.sequence}`;
  mockState.sequence += 1;
  return id;
}

function ensureMockRecipesSeeded() {
  if (mockState.recipes.length > 0) return;
  mockState.recipes = [
    {
      id: "rcp-default",
      name: "Default Focus",
      auto_drive_mode: "manual",
      studioMeta: { version: 1, kind: "routine_studio" },
      steps: [
        {
          id: "step-1",
          type: "pomodoro",
          title: "Focus",
          durationSeconds: 1500,
          moduleId: "mod-pomodoro-focus",
          checklist: ["Focus on one task only"],
          executionHints: { allowSkip: false, mustCompleteChecklist: false, autoAdvance: true },
        },
      ],
    },
    {
      id: "rcp-legacy",
      name: "Legacy Template",
      auto_drive_mode: "auto",
      steps: [{ id: "step-1", type: "micro", title: "Admin", durationSeconds: 900 }],
    },
  ];
}

function ensureMockModulesSeeded() {
  if (mockState.modules.length > 0) return;
  mockState.modules = routineStudioSeedModules.map((module) => ({
    ...module,
    checklist: Array.isArray(module.checklist) ? [...module.checklist] : [],
    pomodoro: module.pomodoro ? { ...module.pomodoro } : null,
    executionHints: module.executionHints ? { ...module.executionHints } : null,
  }));
}

function isoDate(value) {
  return value.toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP");
}

function formatHHmm(value) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function blockDisplayName(block) {
  const timeRange = `${formatHHmm(block?.start_at)}-${formatHHmm(block?.end_at)}`;
  const title = blockTitle(block);
  return title ? `${title} (${timeRange})` : timeRange;
}

function toLocalInputValue(rfc3339) {
  if (!rfc3339) return "";
  const date = new Date(rfc3339);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

function fromLocalInputValue(value) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function toTimerText(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function normalizePomodoroState(state) {
  return {
    current_block_id: state?.current_block_id ?? null,
    current_task_id: state?.current_task_id ?? null,
    phase: state?.phase ?? "idle",
    remaining_seconds: Number.isFinite(state?.remaining_seconds) ? Math.max(0, state.remaining_seconds) : 0,
    start_time: state?.start_time ?? null,
    total_cycles: Number.isFinite(state?.total_cycles) ? Math.max(0, state.total_cycles) : 0,
    completed_cycles: Number.isFinite(state?.completed_cycles) ? Math.max(0, state.completed_cycles) : 0,
    current_cycle: Number.isFinite(state?.current_cycle) ? Math.max(0, state.current_cycle) : 0,
  };
}

function pomodoroPhaseLabel(phase) {
  switch (phase) {
    case "focus":
      return "集中";
    case "break":
      return "休憩";
    case "paused":
      return "一時停止";
    default:
      return "待機";
  }
}

function blockDurationMinutes(block) {
  const startMs = new Date(block.start_at).getTime();
  const endMs = new Date(block.end_at).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  return Math.max(1, Math.round((endMs - startMs) / 60000));
}

function blockPomodoroTarget(block) {
  if (Number.isFinite(block.planned_pomodoros) && block.planned_pomodoros > 0) {
    return Math.max(1, Math.floor(block.planned_pomodoros));
  }
  const duration = blockDurationMinutes(block);
  const cycleMinutes = 25 + Math.max(1, Math.floor(uiState.settings.breakDuration || 5));
  return Math.max(1, Math.floor(duration / cycleMinutes));
}

function pomodoroProgressPercent(state) {
  const total = Math.max(1, state.total_cycles || 0);
  return Math.max(0, Math.min(100, Math.round((Math.min(state.completed_cycles, total) / total) * 100)));
}

function syncNowTaskOrder(tasksInput = uiState.tasks) {
  const tasks = Array.isArray(tasksInput) ? tasksInput : [];
  const ids = tasks
    .map((task) => (typeof task?.id === "string" ? task.id : ""))
    .filter((taskId) => taskId.length > 0);
  const idSet = new Set(ids);
  const nextOrder = uiState.nowUi.taskOrder.filter((taskId) => idSet.has(taskId));
  ids.forEach((taskId) => {
    if (!nextOrder.includes(taskId)) {
      nextOrder.push(taskId);
    }
  });
  uiState.nowUi.taskOrder = nextOrder;
}

function getNowOrderedTasks(includeCompleted = false) {
  syncNowTaskOrder(uiState.tasks);
  const byId = new Map(uiState.tasks.map((task) => [task.id, task]));
  const ordered = uiState.nowUi.taskOrder
    .map((taskId) => byId.get(taskId))
    .filter((task) => Boolean(task));
  return includeCompleted ? ordered : ordered.filter((task) => task.status !== "completed");
}

function resolveNowDayBounds(reference = new Date()) {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { dayStartMs: start.getTime(), dayEndMs: end.getTime() };
}

function resolveNowBlocks(reference = new Date()) {
  const { dayStartMs, dayEndMs } = resolveNowDayBounds(reference);
  return [...uiState.blocks]
    .map((block) => {
      const startMs = new Date(block.start_at).getTime();
      const endMs = new Date(block.end_at).getTime();
      return { block, startMs, endMs };
    })
    .filter(
      ({ startMs, endMs }) =>
        Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs && endMs > dayStartMs && startMs < dayEndMs
    )
    .sort((left, right) => left.startMs - right.startMs);
}

function resolveNowAutoStartBlock(state) {
  const todayBlocks = resolveNowBlocks();
  if (state.current_block_id) {
    const current = todayBlocks.find(({ block }) => block.id === state.current_block_id);
    if (current) return current.block;
  }
  const nowMs = Date.now();
  const active = todayBlocks.find(({ startMs, endMs }) => startMs <= nowMs && nowMs < endMs);
  if (active) return active.block;
  const upcoming = todayBlocks.find(({ startMs }) => startMs >= nowMs);
  if (upcoming) return upcoming.block;
  return todayBlocks[0]?.block || null;
}

function resolveNowAutoStartTask(state) {
  const ordered = getNowOrderedTasks();
  if (state.current_task_id) {
    const current = ordered.find((task) => task.id === state.current_task_id);
    if (current) return current;
  }
  return ordered.find((task) => task.status === "in_progress") || ordered.find((task) => task.status === "pending") || null;
}

function syncNowTimerDisplay(stateInput) {
  const state = normalizePomodoroState(stateInput || uiState.pomodoro || {});
  const remainingSeconds = Math.max(0, Math.floor(state.remaining_seconds || 0));
  const previousPhase = uiState.nowUi.lastPhase;
  const previousDisplay = Math.max(0, Math.floor(uiState.nowUi.displayRemainingSeconds || 0));
  const runningPhase = state.phase === "focus" || state.phase === "break";
  const previousRunningPhase = previousPhase === "focus" || previousPhase === "break";
  const runningPhaseSwitched = runningPhase && previousRunningPhase && previousPhase !== state.phase;

  if (uiState.nowUi.lastSyncEpochMs === 0) {
    uiState.nowUi.phaseTotalSeconds = Math.max(1, remainingSeconds);
    uiState.nowUi.displayRemainingSeconds = remainingSeconds;
  } else if (runningPhaseSwitched) {
    uiState.nowUi.phaseTotalSeconds = Math.max(1, remainingSeconds);
    uiState.nowUi.displayRemainingSeconds = remainingSeconds;
  } else if (runningPhase) {
    if (!previousRunningPhase) {
      if (previousPhase !== "paused" || uiState.nowUi.phaseTotalSeconds <= 0) {
        uiState.nowUi.phaseTotalSeconds = Math.max(1, remainingSeconds);
      }
      if (previousPhase === "paused" && previousDisplay > 0) {
        uiState.nowUi.displayRemainingSeconds = Math.min(previousDisplay, remainingSeconds);
      } else {
        uiState.nowUi.displayRemainingSeconds = remainingSeconds;
      }
    } else {
      // Keep local 1-second countdown smooth; only correct downward from backend snapshots.
      uiState.nowUi.displayRemainingSeconds = Math.min(previousDisplay, remainingSeconds);
      if (previousDisplay <= 0 && remainingSeconds > 0) {
        uiState.nowUi.displayRemainingSeconds = remainingSeconds;
      }
      if (remainingSeconds > uiState.nowUi.phaseTotalSeconds) {
        uiState.nowUi.phaseTotalSeconds = Math.max(1, remainingSeconds);
      }
    }
  } else if (state.phase === "paused") {
    if (previousDisplay > 0) {
      uiState.nowUi.displayRemainingSeconds = Math.min(previousDisplay, remainingSeconds);
    } else {
      uiState.nowUi.displayRemainingSeconds = remainingSeconds;
    }
    if (uiState.nowUi.phaseTotalSeconds <= 0) {
      uiState.nowUi.phaseTotalSeconds = Math.max(1, remainingSeconds);
    }
  } else {
    uiState.nowUi.phaseTotalSeconds = Math.max(1, remainingSeconds || uiState.nowUi.phaseTotalSeconds || 1);
    uiState.nowUi.displayRemainingSeconds = remainingSeconds;
  }

  uiState.nowUi.lastPhase = state.phase;
  uiState.nowUi.lastSyncEpochMs = Date.now();
}

function nowBufferAvailableMinutes(reference = new Date()) {
  const nowMs = reference.getTime();
  const { dayEndMs } = resolveNowDayBounds(reference);
  const availableWindowMs = Math.max(0, dayEndMs - nowMs);
  if (availableWindowMs <= 0) return 0;

  const intervals = resolveNowBlocks(reference)
    .map(({ startMs, endMs }) => ({
      startMs: Math.max(startMs, nowMs),
      endMs: Math.min(endMs, dayEndMs),
    }))
    .filter((interval) => interval.endMs > interval.startMs)
    .sort((left, right) => left.startMs - right.startMs);

  let occupiedMs = 0;
  let cursorStart = -1;
  let cursorEnd = -1;
  intervals.forEach((interval) => {
    if (cursorStart < 0) {
      cursorStart = interval.startMs;
      cursorEnd = interval.endMs;
      return;
    }
    if (interval.startMs > cursorEnd) {
      occupiedMs += cursorEnd - cursorStart;
      cursorStart = interval.startMs;
      cursorEnd = interval.endMs;
      return;
    }
    cursorEnd = Math.max(cursorEnd, interval.endMs);
  });
  if (cursorStart >= 0 && cursorEnd > cursorStart) {
    occupiedMs += cursorEnd - cursorStart;
  }
  return Math.max(0, Math.floor((availableWindowMs - occupiedMs) / 60000));
}

function resolveCurrentFocusTask(stateInput = uiState.pomodoro) {
  const state = normalizePomodoroState(stateInput || {});
  if (state.current_task_id) {
    const linked = uiState.tasks.find((task) => task.id === state.current_task_id) || null;
    if (linked) return linked;
  }
  return uiState.tasks.find((task) => task.status === "in_progress") || null;
}

function resolveDayBounds(dateValue) {
  const parsed = new Date(`${dateValue}T00:00:00`);
  const dayStart = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
}

function resolveWeekBounds(dateValue) {
  const { dayStart } = resolveDayBounds(dateValue);
  const weekday = dayStart.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const weekStart = new Date(dayStart);
  weekStart.setDate(dayStart.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { weekStart, weekEnd };
}

function resolveWeekDateKeys(dateValue) {
  const { weekStart } = resolveWeekBounds(dateValue);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + index);
    day.setHours(0, 0, 0, 0);
    return isoDate(day);
  });
}

function toSyncWindowPayload(dateValue, scope = "day") {
  if (scope === "week") {
    const { weekStart, weekEnd } = resolveWeekBounds(dateValue);
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

function normalizeAccountId(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || "default";
}

function loadBlockTitles() {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(BLOCK_TITLE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) => typeof key === "string" && typeof value === "string"
      )
    );
  } catch {
    return {};
  }
}

function persistBlockTitles() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(BLOCK_TITLE_STORAGE_KEY, JSON.stringify(uiState.blockTitles));
  } catch {
    // ignore storage errors
  }
}

function blockTitle(block) {
  const blockId = typeof block?.id === "string" ? block.id.trim() : "";
  if (!blockId) return "";
  return uiState.blockTitles[blockId] || "";
}

function setBlockTitle(blockId, title) {
  const normalizedId = typeof blockId === "string" ? blockId.trim() : "";
  if (!normalizedId) return false;
  const normalizedTitle = typeof title === "string" ? title.trim() : "";
  if (normalizedTitle) {
    uiState.blockTitles[normalizedId] = normalizedTitle;
  } else {
    delete uiState.blockTitles[normalizedId];
  }
  persistBlockTitles();
  return true;
}

function withAccount(payload = {}) {
  return {
    ...payload,
    account_id: normalizeAccountId(uiState.accountId),
  };
}

async function resetBlocksForDate(date) {
  const targetDate = typeof date === "string" && date.trim() ? date.trim() : uiState.dashboardDate;
  const existingBlocks = await safeInvoke("list_blocks", { date: targetDate });
  if (existingBlocks.length > 0) {
    await Promise.all(
      existingBlocks.map((block) =>
        safeInvoke("delete_block", {
          block_id: block.id,
        })
      )
    );
  }
  return existingBlocks.length;
}

function toClockText(milliseconds, options = {}) {
  return new Date(milliseconds).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...options,
  });
}

function timezoneOffsetLabel() {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minutes = String(absoluteMinutes % 60).padStart(2, "0");
  return `GMT${sign}${hours}${minutes === "00" ? "" : `:${minutes}`}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dayItemKey(kind, id) {
  return `${kind}:${id}`;
}

function minutesBetween(startMs, endMs) {
  return Math.max(0, Math.round((endMs - startMs) / 60000));
}

function toDurationLabel(totalMinutes) {
  if (totalMinutes <= 0) return "0m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function nextRoutineStudioEntryId() {
  const id = `studio-entry-${routineStudioSequence}`;
  routineStudioSequence += 1;
  return id;
}

function routineStudioStepDurationMinutes(step) {
  const durationSeconds = Number(step?.durationSeconds ?? step?.duration_seconds ?? 300);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 5;
  return Math.max(1, Math.round(durationSeconds / 60));
}

function routineStudioSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function isRoutineStudioRecipe(recipe) {
  const meta = recipe?.studioMeta || recipe?.studio_meta;
  return Number(meta?.version) === 1 && String(meta?.kind || "").toLowerCase() === "routine_studio";
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function toClippedInterval(startAt, endAt, dayStartMs, dayEndMs) {
  const startMs = new Date(startAt).getTime();
  const endMs = new Date(endAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }
  const clippedStart = Math.max(startMs, dayStartMs);
  const clippedEnd = Math.min(endMs, dayEndMs);
  if (clippedEnd <= clippedStart) {
    return null;
  }
  return { startMs: clippedStart, endMs: clippedEnd };
}

function toTimelineIntervals(items, dayStartMs, dayEndMs) {
  const intervals = items
    .map((item) => {
      const startMs = new Date(item.start_at).getTime();
      const endMs = new Date(item.end_at).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return null;
      }
      const clippedStart = Math.max(startMs, dayStartMs);
      const clippedEnd = Math.min(endMs, dayEndMs);
      if (clippedEnd <= clippedStart) {
        return null;
      }
      return { startMs: clippedStart, endMs: clippedEnd };
    })
    .filter((slot) => slot !== null);

  return mergeTimelineIntervals(intervals);
}

function mergeTimelineIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((left, right) => left.startMs - right.startMs);
  const merged = [{ ...sorted[0] }];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const last = merged[merged.length - 1];
    if (current.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, current.endMs);
      continue;
    }
    merged.push({ ...current });
  }

  return merged;
}

function invertTimelineIntervals(dayStartMs, dayEndMs, busyIntervals) {
  if (dayEndMs <= dayStartMs) return [];
  if (!busyIntervals.length) {
    return [{ startMs: dayStartMs, endMs: dayEndMs }];
  }

  const freeIntervals = [];
  let cursor = dayStartMs;
  busyIntervals.forEach((interval) => {
    if (interval.startMs > cursor) {
      freeIntervals.push({ startMs: cursor, endMs: interval.startMs });
    }
    if (interval.endMs > cursor) {
      cursor = interval.endMs;
    }
  });

  if (cursor < dayEndMs) {
    freeIntervals.push({ startMs: cursor, endMs: dayEndMs });
  }
  return freeIntervals;
}

function sumIntervalMinutes(intervals) {
  return intervals.reduce((total, interval) => total + minutesBetween(interval.startMs, interval.endMs), 0);
}

function intervalRangeLabel(interval) {
  return `${toClockText(interval.startMs)} - ${toClockText(interval.endMs)}`;
}

function snapToMinutes(milliseconds, minutes) {
  const step = Math.max(1, Math.floor(minutes)) * 60000;
  return Math.round(milliseconds / step) * step;
}

function clampBlockIntervalToDay(startMs, durationMs, dayStartMs, dayEndMs) {
  const safeDuration = Math.max(60000, durationMs);
  const maxStartMs = Math.max(dayStartMs, dayEndMs - safeDuration);
  const clampedStartMs = Math.min(Math.max(startMs, dayStartMs), maxStartMs);
  return {
    startMs: clampedStartMs,
    endMs: clampedStartMs + safeDuration,
  };
}

function snapAndClampBlockInterval(startMs, durationMs, dayStartMs, dayEndMs) {
  const snappedStartMs = snapToMinutes(startMs, DAY_BLOCK_DRAG_SNAP_MINUTES);
  return clampBlockIntervalToDay(snappedStartMs, durationMs, dayStartMs, dayEndMs);
}

function clearDayBlockDragDocumentListeners() {
  if (dayBlockDragState.onMove) {
    window.removeEventListener("pointermove", dayBlockDragState.onMove);
    dayBlockDragState.onMove = null;
  }
  if (dayBlockDragState.onUp) {
    window.removeEventListener("pointerup", dayBlockDragState.onUp);
    window.removeEventListener("pointercancel", dayBlockDragState.onUp);
    dayBlockDragState.onUp = null;
  }
}

function setHoveredFreeEntry(entry) {
  if (dayBlockDragState.hoveredFreeEntry === entry) return;
  if (dayBlockDragState.hoveredFreeEntry) {
    dayBlockDragState.hoveredFreeEntry.classList.remove("is-drop-target");
  }
  dayBlockDragState.hoveredFreeEntry = entry;
  if (dayBlockDragState.hoveredFreeEntry) {
    dayBlockDragState.hoveredFreeEntry.classList.add("is-drop-target");
  }
}

function resetDayBlockDragVisualState() {
  setHoveredFreeEntry(null);
  if (dayBlockDragState.entry) {
    dayBlockDragState.entry.classList.remove("is-dragging");
    dayBlockDragState.entry.style.top = dayBlockDragState.originalTopCss;
    dayBlockDragState.entry.style.left = dayBlockDragState.originalLeftCss;
    dayBlockDragState.entry.style.removeProperty("z-index");
    dayBlockDragState.entry.title = dayBlockDragState.originalTitle;
    if (dayBlockDragState.timeLabel) {
      dayBlockDragState.timeLabel.textContent = dayBlockDragState.originalTimeLabelText;
    }
  }
}

async function commitDayBlockMove(rerender, snapshot) {
  const blockId = snapshot.blockId;
  if (!blockId) return;
  const durationMs = snapshot.previewEndMs - snapshot.previewStartMs;
  const finalInterval = snapAndClampBlockInterval(
    snapshot.previewStartMs,
    durationMs,
    snapshot.dayStartMs,
    snapshot.dayEndMs
  );
  const finalStartMs = finalInterval.startMs;
  const finalEndMs = finalInterval.endMs;
  const unchanged =
    Math.abs(finalStartMs - snapshot.originStartMs) < 1000 &&
    Math.abs(finalEndMs - snapshot.originEndMs) < 1000;
  if (unchanged) return;

  await runUiAction(async () => {
    await safeInvoke("adjust_block_time", {
      block_id: blockId,
      start_at: new Date(finalStartMs).toISOString(),
      end_at: new Date(finalEndMs).toISOString(),
    });
    uiState.dayCalendarSelection = { kind: "block", id: blockId };
    await refreshCoreData(uiState.dashboardDate);
    setStatus(`block moved: ${toClockText(finalStartMs)} - ${toClockText(finalEndMs)}`);
    rerender();
  });
}

function finishDayBlockDrag(rerender) {
  clearDayBlockDragDocumentListeners();
  if (!dayBlockDragState.active) return;

  resetDayBlockDragVisualState();
  const commitSnapshot = {
    blockId: dayBlockDragState.blockId,
    dayStartMs: dayBlockDragState.dayStartMs,
    dayEndMs: dayBlockDragState.dayEndMs,
    originStartMs: dayBlockDragState.originStartMs,
    originEndMs: dayBlockDragState.originEndMs,
    previewStartMs: dayBlockDragState.previewStartMs,
    previewEndMs: dayBlockDragState.previewEndMs,
  };
  const moved = dayBlockDragState.moved;
  const shouldCommit = moved;
  if (moved) {
    dayBlockDragState.suppressClickUntil = Date.now() + 220;
  }

  const releaseEntry = dayBlockDragState.entry;
  const pointerId = dayBlockDragState.pointerId;
  if (releaseEntry && Number.isInteger(pointerId)) {
    try {
      releaseEntry.releasePointerCapture(/** @type {number} */ (pointerId));
    } catch {
      // ignore unsupported or already released capture
    }
  }

  dayBlockDragState.active = false;
  dayBlockDragState.moved = false;
  dayBlockDragState.pointerId = null;
  dayBlockDragState.blockId = "";
  dayBlockDragState.dayStartMs = 0;
  dayBlockDragState.dayEndMs = 0;
  dayBlockDragState.rangeMs = 0;
  dayBlockDragState.trackHeightPx = 0;
  dayBlockDragState.trackWidthPx = 0;
  dayBlockDragState.originClientY = 0;
  dayBlockDragState.originClientX = 0;
  dayBlockDragState.originStartMs = 0;
  dayBlockDragState.originEndMs = 0;
  dayBlockDragState.previewStartMs = 0;
  dayBlockDragState.previewEndMs = 0;
  dayBlockDragState.originalTopCss = "";
  dayBlockDragState.originalLeftCss = "";
  dayBlockDragState.originalTimeLabelText = "";
  dayBlockDragState.originalTitle = "";
  dayBlockDragState.hoveredFreeEntry = null;
  dayBlockDragState.entry = null;
  dayBlockDragState.timeLabel = null;

  if (shouldCommit) {
    void commitDayBlockMove(rerender, commitSnapshot);
  }
}

function applyDayBlockPreview(entry, interval) {
  if (!dayBlockDragState.rangeMs || dayBlockDragState.rangeMs <= 0) return;
  dayBlockDragState.previewStartMs = interval.startMs;
  dayBlockDragState.previewEndMs = interval.endMs;
  const startPercent = ((interval.startMs - dayBlockDragState.dayStartMs) / dayBlockDragState.rangeMs) * 100;
  if (entry.classList.contains("day-simple-segment")) {
    entry.style.left = `${startPercent}%`;
  } else {
    entry.style.top = `${startPercent}%`;
  }
  const timeText = intervalRangeLabel(interval);
  if (dayBlockDragState.timeLabel) {
    dayBlockDragState.timeLabel.textContent = timeText;
  }
  entry.title = `${blockDisplayName({
    start_at: new Date(interval.startMs).toISOString(),
    end_at: new Date(interval.endMs).toISOString(),
    date: uiState.dashboardDate,
  })} | ${timeText}`;
}

function buildDailyCalendarModel(dateValue, blocks, events, options = {}) {
  const syncSelection = options.syncSelection !== false;
  const preferredSelection = options.preferredSelection || null;
  const { dayStart, dayEnd } = resolveDayBounds(dateValue);
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();
  const blockItems = blocks
    .map((block) => {
      const interval = toClippedInterval(block.start_at, block.end_at, dayStartMs, dayEndMs);
      if (!interval) return null;
      return {
        kind: /** @type {DayItemKind} */ ("block"),
        id: block.id,
        key: dayItemKey("block", block.id),
        title: blockDisplayName(block),
        subtitle: block.firmness || "draft",
        startMs: interval.startMs,
        endMs: interval.endMs,
        durationMinutes: minutesBetween(interval.startMs, interval.endMs),
        payload: block,
      };
    })
    .filter((item) => item !== null)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const eventItems = events
    .map((event) => {
      const interval = toClippedInterval(event.start_at, event.end_at, dayStartMs, dayEndMs);
      if (!interval) return null;
      return {
        kind: /** @type {DayItemKind} */ ("event"),
        id: event.id,
        key: dayItemKey("event", event.id),
        title: event.title || "予定",
        subtitle: event.account_id || "default",
        startMs: interval.startMs,
        endMs: interval.endMs,
        durationMinutes: minutesBetween(interval.startMs, interval.endMs),
        payload: event,
      };
    })
    .filter((item) => item !== null)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const blockIntervals = toTimelineIntervals(blocks, dayStartMs, dayEndMs);
  const eventIntervals = toTimelineIntervals(events, dayStartMs, dayEndMs);
  const busyIntervals = mergeTimelineIntervals([...blockIntervals, ...eventIntervals]);
  const freeIntervals = invertTimelineIntervals(dayStartMs, dayEndMs, busyIntervals);
  const freeItems = freeIntervals
    .filter((interval) => minutesBetween(interval.startMs, interval.endMs) >= 10)
    .map((interval) => ({
      kind: /** @type {DayItemKind} */ ("free"),
      id: `${interval.startMs}-${interval.endMs}`,
      key: dayItemKey("free", `${interval.startMs}-${interval.endMs}`),
      title: "空き枠",
      subtitle: "available",
      startMs: interval.startMs,
      endMs: interval.endMs,
      durationMinutes: minutesBetween(interval.startMs, interval.endMs),
      payload: interval,
    }));
  const allItems = [...blockItems, ...eventItems, ...freeItems];
  const itemMap = new Map(allItems.map((item) => [item.key, item]));
  const selectionSource =
    preferredSelection && typeof preferredSelection.kind === "string" && typeof preferredSelection.id === "string"
      ? { kind: preferredSelection.kind, id: preferredSelection.id }
      : uiState.dayCalendarSelection;
  const selectedByState = selectionSource ? itemMap.get(dayItemKey(selectionSource.kind, selectionSource.id)) : null;
  const selectedItem = selectedByState || blockItems[0] || eventItems[0] || freeItems[0] || null;
  if (syncSelection) {
    uiState.dayCalendarSelection = selectedItem
      ? {
          kind: selectedItem.kind,
          id: selectedItem.id,
        }
      : null;
  }

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
    totals: {
      blockMinutes: sumIntervalMinutes(blockIntervals),
      eventMinutes: sumIntervalMinutes(eventIntervals),
      freeMinutes: sumIntervalMinutes(freeIntervals),
    },
  };
}

function parseLocalDate(dateValue) {
  const parsed = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    const fallback = new Date();
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  }
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function shiftDateByDays(baseDate, offsetDays) {
  const next = new Date(baseDate);
  next.setDate(baseDate.getDate() + offsetDays);
  next.setHours(0, 0, 0, 0);
  return next;
}

function toLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toMonthDayLabel(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}`;
}

function buildWeeklyPlannerModel(dateValue, blocks, events) {
  const anchor = parseLocalDate(dateValue);
  const weekday = anchor.getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const weekStart = shiftDateByDays(anchor, mondayOffset);
  const weekdayLabels = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const days = Array.from({ length: 7 }, (_, index) => {
    const dayDate = shiftDateByDays(weekStart, index);
    const dayKey = toLocalDateKey(dayDate);
    const dailyModel = buildDailyCalendarModel(dayKey, blocks, events, { syncSelection: false });
    const combinedItems = [...dailyModel.blockItems, ...dailyModel.eventItems, ...dailyModel.freeItems].sort(
      (left, right) => left.startMs - right.startMs || left.endMs - right.endMs
    );
    return {
      ...dailyModel,
      dayKey,
      dayDate,
      dayNumber: String(dayDate.getDate()).padStart(2, "0"),
      weekdayLabel: weekdayLabels[dayDate.getDay()],
      isCurrent: dayKey === dateValue,
      combinedItems,
    };
  });

  const allItems = days.flatMap((day) => day.combinedItems);
  const itemMap = new Map(allItems.map((item) => [item.key, item]));
  const selectedByState = uiState.dayCalendarSelection
    ? itemMap.get(dayItemKey(uiState.dayCalendarSelection.kind, uiState.dayCalendarSelection.id))
    : null;
  const currentDay = days.find((day) => day.isCurrent) || days[0] || null;
  const firstAvailable = days.find((day) => day.combinedItems.length > 0)?.combinedItems[0] || null;
  const selectedItem = selectedByState || currentDay?.combinedItems[0] || firstAvailable || null;
  uiState.dayCalendarSelection = selectedItem
    ? {
        kind: selectedItem.kind,
        id: selectedItem.id,
      }
    : null;

  const weekEnd = days[days.length - 1]?.dayDate || weekStart;
  const weekLabel = `${weekStart.getFullYear()} ${toMonthDayLabel(weekStart)} - ${toMonthDayLabel(weekEnd)}`;

  return {
    days,
    selectedItem,
    weekLabel,
  };
}

function renderDayHourGuides() {
  return Array.from({ length: 25 }, (_, index) => {
    const top = (index / 24) * 100;
    return `<span class="day-hour-line" style="top:${top}%"></span>`;
  }).join("");
}

function renderDayTimeAxis(dayStartMs, dayEndMs) {
  const totalHours = Math.max(1, Math.round((dayEndMs - dayStartMs) / (60 * 60 * 1000)));
  return `
    <div class="day-time-axis">
      ${renderDayHourGuides()}
      ${Array.from({ length: totalHours + 1 }, (_, index) => {
        const top = (index / totalHours) * 100;
        const clock = toClockText(dayStartMs + index * 60 * 60 * 1000);
        return `<span class="day-time-label" style="top:${top}%">${clock}</span>`;
      }).join("")}
    </div>
  `;
}

function renderDayLaneItems(kind, items, dayStartMs, dayEndMs, selectedItem) {
  const totalRange = Math.max(1, dayEndMs - dayStartMs);
  return items
    .map((item) => {
      const top = ((item.startMs - dayStartMs) / totalRange) * 100;
      const baseHeight = ((item.endMs - item.startMs) / totalRange) * 100;
      const minHeight = kind === "free" ? 2.2 : 3.2;
      const height = Math.max(minHeight, baseHeight);
      const compact = height < 7 ? "is-compact" : "";
      const selectedClass = selectedItem && selectedItem.key === item.key ? "is-selected" : "";
      const dragClass = kind === "block" ? "is-draggable" : "";
      return `
        <button
          type="button"
          class="day-entry day-entry-${kind} ${selectedClass} ${compact} ${dragClass}"
          style="top:${top}%;height:${height}%"
          data-day-item-kind="${kind}"
          data-day-item-id="${escapeHtml(item.id)}"
          data-day-start-ms="${dayStartMs}"
          data-day-end-ms="${dayEndMs}"
          data-day-item-start-ms="${item.startMs}"
          data-day-item-end-ms="${item.endMs}"
          title="${escapeHtml(`${item.title} | ${intervalRangeLabel(item)}`)}"
        >
          <span class="day-entry-title">${escapeHtml(item.title)}</span>
          <span class="day-entry-time">${intervalRangeLabel(item)}</span>
          <span class="day-entry-duration">${toDurationLabel(item.durationMinutes)}</span>
        </button>
      `;
    })
    .join("");
}

function renderCombinedDayLaneItems(items, dayStartMs, dayEndMs, selectedItem) {
  const totalRange = Math.max(1, dayEndMs - dayStartMs);
  return items
    .map((item) => {
      const top = ((item.startMs - dayStartMs) / totalRange) * 100;
      const baseHeight = ((item.endMs - item.startMs) / totalRange) * 100;
      const minHeight = item.kind === "free" ? 2.2 : 3.2;
      const height = Math.max(minHeight, baseHeight);
      const compact = height < 7 ? "is-compact" : "";
      const selectedClass = selectedItem && selectedItem.key === item.key ? "is-selected" : "";
      const dragClass = item.kind === "block" ? "is-draggable" : "";
      return `
        <button
          type="button"
          class="day-entry day-entry-${item.kind} ${selectedClass} ${compact} ${dragClass}"
          style="top:${top}%;height:${height}%"
          data-day-item-kind="${item.kind}"
          data-day-item-id="${escapeHtml(item.id)}"
          data-day-start-ms="${dayStartMs}"
          data-day-end-ms="${dayEndMs}"
          data-day-item-start-ms="${item.startMs}"
          data-day-item-end-ms="${item.endMs}"
          title="${escapeHtml(`${item.title} | ${intervalRangeLabel(item)}`)}"
        >
          <span class="day-entry-title">${escapeHtml(item.title)}</span>
          <span class="day-entry-time">${intervalRangeLabel(item)}</span>
          <span class="day-entry-duration">${toDurationLabel(item.durationMinutes)}</span>
        </button>
      `;
    })
    .join("");
}

function renderWeeklyPlannerCalendar(model) {
  if (!model.days.length) {
    return '<div class="panel"><p class="small">週次データがありません。</p></div>';
  }
  const gridColumns = `84px repeat(${model.days.length}, minmax(150px, 1fr))`;
  return `
    <div class="week-board">
      <div class="week-board-head" style="grid-template-columns:${gridColumns}">
        <span class="week-board-head-time">時刻</span>
        ${model.days
          .map(
            (day) => `
          <span class="week-board-day ${day.isCurrent ? "is-current" : ""}">
            <small>${day.weekdayLabel}</small>
            <strong>${day.dayNumber}</strong>
          </span>
        `
          )
          .join("")}
      </div>
      <div class="week-board-body" style="grid-template-columns:${gridColumns}">
        ${renderDayTimeAxis(model.days[0].dayStartMs, model.days[0].dayEndMs)}
        ${model.days
          .map((day) => {
            const entries = renderCombinedDayLaneItems(
              day.combinedItems,
              day.dayStartMs,
              day.dayEndMs,
              model.selectedItem
            );
            return `
              <section class="week-day-lane ${day.isCurrent ? "is-current" : ""}">
                <div class="day-lane-track week-day-track">
                  ${renderDayHourGuides()}
                  ${entries || '<span class="day-lane-empty">なし</span>'}
                </div>
              </section>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderDayLane(label, kind, items, dayStartMs, dayEndMs, selectedItem) {
  const entries = renderDayLaneItems(kind, items, dayStartMs, dayEndMs, selectedItem);
  const hint = "";
  return `
    <section class="day-lane">
      <header class="day-lane-head">
        <span>${label}</span>
        <span class="small">${items.length}件${hint}</span>
      </header>
      <div class="day-lane-track">
        ${renderDayHourGuides()}
        ${entries || '<span class="day-lane-empty">なし</span>'}
      </div>
    </section>
  `;
}

function renderSimpleTimelineScale() {
  return [0, 6, 12, 18, 24]
    .map((hour) => {
      const left = (hour / 24) * 100;
      return `<span style="left:${left}%">${String(hour).padStart(2, "0")}:00</span>`;
    })
    .join("");
}

function renderSimpleTimelineSegments(kind, items, dayStartMs, dayEndMs, selectedItem) {
  const totalRange = Math.max(1, dayEndMs - dayStartMs);
  return items
    .map((item) => {
      const left = ((item.startMs - dayStartMs) / totalRange) * 100;
      const width = Math.max(0.9, ((item.endMs - item.startMs) / totalRange) * 100);
      const selectedClass = selectedItem && selectedItem.key === item.key ? "is-selected" : "";
      const dragClass = kind === "block" ? "is-draggable" : "";
      return `
        <button
          type="button"
          class="day-simple-segment day-simple-segment-${kind} ${selectedClass} ${dragClass}"
          style="left:${left}%;width:${width}%"
          data-day-item-kind="${kind}"
          data-day-item-id="${escapeHtml(item.id)}"
          data-day-start-ms="${dayStartMs}"
          data-day-end-ms="${dayEndMs}"
          data-day-item-start-ms="${item.startMs}"
          data-day-item-end-ms="${item.endMs}"
          title="${escapeHtml(`${item.title} | ${intervalRangeLabel(item)}`)}"
        >
          <span>${escapeHtml(item.title)}</span>
        </button>
      `;
    })
    .join("");
}

function renderSimpleOccupancySegments(intervals, dayStartMs, dayEndMs) {
  const totalRange = Math.max(1, dayEndMs - dayStartMs);
  return intervals
    .map((interval) => {
      const left = ((interval.startMs - dayStartMs) / totalRange) * 100;
      const width = Math.max(0.7, ((interval.endMs - interval.startMs) / totalRange) * 100);
      const title = `${intervalRangeLabel(interval)} (${toDurationLabel(
        minutesBetween(interval.startMs, interval.endMs)
      )})`;
      return `<span class="day-simple-occupancy-segment" style="left:${left}%;width:${width}%" title="${title}"></span>`;
    })
    .join("");
}

function renderSimpleTimelineRow(label, kind, items, dayStartMs, dayEndMs, selectedItem) {
  const segments = renderSimpleTimelineSegments(kind, items, dayStartMs, dayEndMs, selectedItem);
  return `
    <div class="day-simple-row">
      <span class="day-simple-row-label">${label}</span>
      <div class="day-simple-track">
        ${segments || '<span class="day-simple-empty">なし</span>'}
      </div>
    </div>
  `;
}

function renderSimpleDailyCalendar(model, options = {}) {
  const includeDetail = options.includeDetail !== false;
  const includeTimeline = options.includeTimeline !== false;
  return `
    <div class="day-view-simple">
      ${
        includeTimeline
          ? `
      <div class="panel day-simple-timeline">
        <div class="day-simple-scale">${renderSimpleTimelineScale()}</div>
        <div class="day-simple-row">
          <span class="day-simple-row-label">埋まり具合</span>
          <div class="day-simple-track day-simple-track-occupancy">
            ${renderSimpleOccupancySegments(model.busyIntervals, model.dayStartMs, model.dayEndMs)}
          </div>
        </div>
        ${renderSimpleTimelineRow(
          "ブロック",
          "block",
          model.blockItems,
          model.dayStartMs,
          model.dayEndMs,
          model.selectedItem
        )}
        ${renderSimpleTimelineRow(
          "予定",
          "event",
          model.eventItems,
          model.dayStartMs,
          model.dayEndMs,
          model.selectedItem
        )}
        ${renderSimpleTimelineRow(
          "空き枠",
          "free",
          model.freeItems,
          model.dayStartMs,
          model.dayEndMs,
          model.selectedItem
        )}
      </div>
      `
          : ""
      }
      ${includeDetail ? renderDailyDetail(model.selectedItem) : ""}
    </div>
  `;
}

function renderGridDailyCalendar(model, options = {}) {
  const includeDetail = options.includeDetail !== false;
  const includeBoard = options.includeBoard !== false;
  return `
    <div class="day-view-grid ${includeBoard ? "" : "is-detail-only"}">
      ${
        includeBoard
          ? `
      <div class="day-board">
        <div class="day-board-head">
          <span class="day-board-head-time">時刻</span>
          <span>ブロック</span>
          <span>予定</span>
          <span>空き枠</span>
        </div>
        <div class="day-board-body">
          ${renderDayTimeAxis(model.dayStartMs, model.dayEndMs)}
          ${renderDayLane("ブロック", "block", model.blockItems, model.dayStartMs, model.dayEndMs, model.selectedItem)}
          ${renderDayLane("予定", "event", model.eventItems, model.dayStartMs, model.dayEndMs, model.selectedItem)}
          ${renderDayLane("空き枠", "free", model.freeItems, model.dayStartMs, model.dayEndMs, model.selectedItem)}
        </div>
      </div>
      `
          : ""
      }
      ${includeDetail ? renderDailyDetail(model.selectedItem) : ""}
    </div>
  `;
}

function renderDailyDetail(selectedItem) {
  if (!selectedItem) {
    return `
      <div class="day-detail panel">
        <h4>詳細</h4>
        <p class="small">表示対象がありません。</p>
      </div>
    `;
  }

  if (selectedItem.kind === "block") {
    const block = selectedItem.payload;
    const titleValue = blockTitle(block);
    return `
      <div class="day-detail panel">
        <h4>ブロック詳細</h4>
        <div class="row">
          <label style="flex:1">
            タイトル
            <input
              type="text"
              value="${escapeHtml(titleValue)}"
              data-block-title-input="${escapeHtml(block.id)}"
              placeholder="タイトルなし"
            />
          </label>
          <button type="button" class="btn-secondary" data-block-title-save="${escapeHtml(block.id)}">タイトル保存</button>
        </div>
        <dl class="day-detail-list">
          <div><dt>ID</dt><dd>${escapeHtml(block.id)}</dd></div>
          <div><dt>時間</dt><dd>${intervalRangeLabel(selectedItem)}</dd></div>
          <div><dt>長さ</dt><dd>${toDurationLabel(selectedItem.durationMinutes)}</dd></div>
          <div><dt>Firmness</dt><dd>${escapeHtml(block.firmness || "-")}</dd></div>
          <div><dt>予定ポモドーロ</dt><dd>${Number.isFinite(block.planned_pomodoros) ? block.planned_pomodoros : "-"}</dd></div>
          <div><dt>Source</dt><dd>${escapeHtml(block.source || "-")}</dd></div>
        </dl>
      </div>
    `;
  }

  if (selectedItem.kind === "event") {
    const event = selectedItem.payload;
    return `
      <div class="day-detail panel">
        <h4>予定詳細</h4>
        <dl class="day-detail-list">
          <div><dt>タイトル</dt><dd>${escapeHtml(event.title || "予定")}</dd></div>
          <div><dt>時間</dt><dd>${intervalRangeLabel(selectedItem)}</dd></div>
          <div><dt>長さ</dt><dd>${toDurationLabel(selectedItem.durationMinutes)}</dd></div>
          <div><dt>Event ID</dt><dd>${escapeHtml(event.id || "-")}</dd></div>
          <div><dt>Account</dt><dd>${escapeHtml(event.account_id || "-")}</dd></div>
        </dl>
      </div>
    `;
  }

  return `
    <div class="day-detail panel">
      <h4>空き枠詳細</h4>
      <dl class="day-detail-list">
        <div><dt>時間</dt><dd>${intervalRangeLabel(selectedItem)}</dd></div>
        <div><dt>長さ</dt><dd>${toDurationLabel(selectedItem.durationMinutes)}</dd></div>
        <div><dt>種別</dt><dd>ブロック作成可能な時間帯</dd></div>
      </dl>
    </div>
  `;
}

function renderDailyCalendar(dateValue, options = {}) {
  const model = buildDailyCalendarModel(dateValue, uiState.blocks, uiState.calendarEvents, {
    syncSelection: options.syncSelection,
    preferredSelection: options.preferredSelection,
  });
  const mode =
    options.forceMode === "grid" || options.forceMode === "simple"
      ? options.forceMode
      : uiState.dayCalendarViewMode === "simple"
      ? "simple"
      : "grid";
  const panelClass = typeof options.panelClass === "string" && options.panelClass.trim() ? ` ${options.panelClass}` : "";
  const showHeader = options.showHeader !== false;
  const showMetrics = options.showMetrics !== false;
  const showViewToggle = options.showViewToggle !== false;
  const includeDetail = options.includeDetail !== false;
  const includeBoard = options.includeBoard !== false;
  const includeTimeline = options.includeTimeline !== false;
  return `
    <div class="panel day-calendar${panelClass}">
      ${
        showHeader
          ? `
      <div class="row spread">
        <h3>1日の時間ビュー</h3>
        <span class="small">${escapeHtml(dateValue)} / ${timezoneOffsetLabel()}</span>
      </div>
      `
          : ""
      }
      ${
        showMetrics
          ? `
      <div class="calendar-metrics">
        <span class="pill calendar-pill block">ブロック ${toDurationLabel(model.totals.blockMinutes)}</span>
        <span class="pill calendar-pill event">予定 ${toDurationLabel(model.totals.eventMinutes)}</span>
        <span class="pill calendar-pill free">空き ${toDurationLabel(model.totals.freeMinutes)}</span>
      </div>
      `
          : ""
      }
      ${
        showViewToggle
          ? `
      <div class="day-view-toggle" role="group" aria-label="表示モード切替">
        <button
          type="button"
          class="btn-secondary ${mode === "grid" ? "is-active" : ""}"
          data-day-view="grid"
          aria-pressed="${mode === "grid"}"
        >
          詳細グリッド
        </button>
        <button
          type="button"
          class="btn-secondary ${mode === "simple" ? "is-active" : ""}"
          data-day-view="simple"
          aria-pressed="${mode === "simple"}"
        >
          シンプル
        </button>
      </div>
      `
          : ""
      }
      ${
        mode === "simple"
          ? renderSimpleDailyCalendar(model, { includeDetail, includeTimeline })
          : renderGridDailyCalendar(model, { includeDetail, includeBoard })
      }
    </div>
  `;
}

function setStatus(message) {
  if (statusChip) {
    statusChip.textContent = message;
  }
}

function normalizeCommandPayload(name, payload = {}) {
  const normalized = { ...payload };
  const aliases = commandArgAliases[name] || [];
  for (const [snakeKey, camelKey] of aliases) {
    const hasSnake = Object.prototype.hasOwnProperty.call(normalized, snakeKey);
    const hasCamel = Object.prototype.hasOwnProperty.call(normalized, camelKey);
    if (hasSnake && !hasCamel) {
      normalized[camelKey] = normalized[snakeKey];
    } else if (hasCamel && !hasSnake) {
      normalized[snakeKey] = normalized[camelKey];
    }
  }
  return normalized;
}

function clearProgressTimers() {
  if (progressState.timerId) {
    clearInterval(progressState.timerId);
    progressState.timerId = 0;
  }
  if (progressState.hideTimerId) {
    clearTimeout(progressState.hideTimerId);
    progressState.hideTimerId = 0;
  }
}

function renderGlobalProgress() {
  if (!progressChip || !progressLabel || !progressFill || !progressValue) return;
  progressChip.hidden = !progressState.active;
  if (!progressState.active) return;
  progressLabel.textContent = progressState.label;
  progressValue.textContent = `${progressState.percent}%`;
  progressFill.style.width = `${progressState.percent}%`;
}

function setProgressPercent(percent) {
  progressState.percent = Math.max(0, Math.min(100, Math.round(percent)));
  renderGlobalProgress();
}

function beginLongRunningProgress(command) {
  const label = longRunningLabels[command] ?? command;
  clearProgressTimers();
  progressState.active = true;
  progressState.command = command;
  progressState.label = `${label} 実行中`;
  setProgressPercent(5);
  progressState.timerId = setInterval(() => {
    if (!progressState.active || progressState.percent >= progressTargetPercent) return;
    const remaining = progressTargetPercent - progressState.percent;
    const step = Math.max(1, Math.round(remaining / 6));
    setProgressPercent(progressState.percent + step);
  }, progressUpdateIntervalMs);
}

function finishLongRunningProgress(success) {
  if (!progressState.active) return;
  clearProgressTimers();
  progressState.label = success ? "完了" : "失敗";
  setProgressPercent(100);
  progressState.hideTimerId = setTimeout(() => {
    progressState.active = false;
    progressState.command = "";
    progressState.label = "";
    progressState.percent = 0;
    renderGlobalProgress();
    progressState.hideTimerId = 0;
  }, success ? 360 : 900);
}

function waitForNextFrame() {
  if (typeof window.requestAnimationFrame === "function") {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => setTimeout(resolve, 0));
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function getRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const [root, detail] = hash.split("/");

  if (root === "auth") {
    uiState.settings.page = "auth";
    return "settings";
  }

  if (root === "settings") {
    if (settingsPages.includes(detail)) {
      uiState.settings.page = detail;
    } else if (!settingsPages.includes(uiState.settings.page)) {
      uiState.settings.page = "blocks";
    }
    return "settings";
  }

  const routeAlias = {
    dashboard: "today",
    manage: "details",
    detail: "details",
    blocks: "today",
    tasks: "today",
    pomodoro: "now",
    reflection: "insights",
  };
  const normalized = routeAlias[root] || root;
  return routes.includes(normalized) ? normalized : "today";
}

function markActiveRoute(route) {
  document.querySelectorAll("a[data-route]").forEach((node) => {
    const anchor = /** @type {HTMLAnchorElement} */ (node);
    if (anchor.dataset.route === route) {
      anchor.setAttribute("aria-current", "page");
    } else {
      anchor.removeAttribute("aria-current");
    }
  });
}

async function invokeCommand(name, payload = {}) {
  const normalizedPayload = normalizeCommandPayload(name, payload);
  const tauriInvoke =
    window.__TAURI__?.core?.invoke ??
    window.__TAURI__?.invoke ??
    window.__TAURI_INTERNALS__?.invoke;
  if (tauriInvoke) {
    return tauriInvoke(name, normalizedPayload);
  }
  return mockInvoke(name, normalizedPayload);
}

function isTauriRuntimeAvailable() {
  return Boolean(
    window.__TAURI__?.core?.invoke ??
      window.__TAURI__?.invoke ??
      window.__TAURI_INTERNALS__?.invoke
  );
}

async function safeInvoke(name, payload = {}) {
  try {
    const result = await invokeCommand(name, payload);
    setStatus(`${name} success`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`${name} failed: ${message}`);
    throw error;
  }
}

function isUnknownCommandError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown|not found|unsupported|invoke|command/i.test(message);
}

async function safeInvokeWithFallback(
  primaryName,
  payload,
  fallbackName,
  fallbackPayload = payload
) {
  try {
    return await safeInvoke(primaryName, payload);
  } catch (error) {
    if (!isUnknownCommandError(error) || !fallbackName) {
      throw error;
    }
    return safeInvoke(fallbackName, fallbackPayload);
  }
}

async function runUiAction(action) {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`operation failed: ${message}`);
    console.error(error);
  }
}

async function invokeCommandWithProgress(name, payload = {}) {
  if (!longRunningCommands.has(name)) {
    return safeInvoke(name, payload);
  }

  beginLongRunningProgress(name);
  await waitForNextFrame();
  try {
    const result = await safeInvoke(name, payload);
    finishLongRunningProgress(true);
    return result;
  } catch (error) {
    finishLongRunningProgress(false);
    throw error;
  }
}

function emptyMockPomodoroState() {
  return {
    current_block_id: null,
    current_task_id: null,
    phase: "idle",
    remaining_seconds: 0,
    start_time: null,
    total_cycles: 0,
    completed_cycles: 0,
    current_cycle: 0,
    focus_seconds: 1500,
    break_seconds: 300,
    paused_phase: null,
  };
}

function mockSessionPlan(block) {
  const requestedCycles = blockPomodoroTarget(block);
  const recipe = mockState.recipes.find((item) => item.id === block.recipe_id);
  const step = Array.isArray(recipe?.steps) ? recipe.steps[0] : null;
  const pomodoro = step?.pomodoro || null;
  const focusSeconds = Number(pomodoro?.focusSeconds || pomodoro?.focus_seconds || 25 * 60);
  const breakSeconds = Math.max(
    60,
    Number(pomodoro?.breakSeconds || pomodoro?.break_seconds || Math.floor((uiState.settings.breakDuration || 5) * 60))
  );
  const cycles = Number(pomodoro?.cycles || requestedCycles);
  const cycleSeconds = Math.max(1, focusSeconds + breakSeconds);
  const blockSeconds = Math.max(0, blockDurationMinutes(block) * 60);
  const maxCyclesByDuration = Math.max(1, Math.floor(blockSeconds / cycleSeconds));
  const totalCycles = Math.max(1, Math.min(Number.isFinite(cycles) ? cycles : requestedCycles, maxCyclesByDuration));
  return {
    totalCycles,
    focusSeconds,
    breakSeconds,
  };
}

function appendMockPomodoroLog(phase, interruptionReason = null) {
  mockState.logs.push({
    id: nextMockId("pom"),
    block_id: mockState.pomodoro.current_block_id,
    task_id: mockState.pomodoro.current_task_id,
    phase,
    start_time: mockState.pomodoro.start_time ?? nowIso(),
    end_time: nowIso(),
    interruption_reason: interruptionReason,
  });
}

function unassignMockTask(taskId) {
  const previousBlockId = mockState.taskAssignmentsByTask[taskId];
  if (previousBlockId) {
    delete mockState.taskAssignmentsByTask[taskId];
    delete mockState.taskAssignmentsByBlock[previousBlockId];
  }
}

function assignMockTask(taskId, blockId) {
  const previousTaskId = mockState.taskAssignmentsByBlock[blockId];
  if (previousTaskId) {
    delete mockState.taskAssignmentsByTask[previousTaskId];
  }
  unassignMockTask(taskId);
  mockState.taskAssignmentsByTask[taskId] = blockId;
  mockState.taskAssignmentsByBlock[blockId] = taskId;
}

async function mockInvoke(name, payload) {
  switch (name) {
    case "bootstrap":
      return { workspace_root: "mock", database_path: "mock.sqlite" };
    case "authenticate_google": {
      const accountId = normalizeAccountId(payload.account_id);
      return {
        account_id: accountId,
        status: payload.authorization_code ? "authenticated" : "reauthentication_required",
        authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      };
    }
    case "authenticate_google_sso": {
      throw new Error(
        "Google SSO is unavailable in mock mode. Run the desktop app with `cargo tauri dev`."
      );
    }
    case "sync_calendar": {
      const accountId = normalizeAccountId(payload.account_id);
      const seed = typeof payload.time_min === "string" ? payload.time_min : nowIso();
      const parsed = new Date(seed);
      const dayStart = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
      dayStart.setHours(0, 0, 0, 0);

      const morningStart = new Date(dayStart.getTime() + 10 * 60 * 60 * 1000);
      const morningEnd = new Date(morningStart.getTime() + 30 * 60 * 1000);
      const afternoonStart = new Date(dayStart.getTime() + 14 * 60 * 60 * 1000);
      const afternoonEnd = new Date(afternoonStart.getTime() + 60 * 60 * 1000);

      mockState.syncedEventsByAccount[accountId] = [
        {
          id: nextMockId("evt"),
          title: "Mock Event A",
          start_at: morningStart.toISOString(),
          end_at: morningEnd.toISOString(),
        },
        {
          id: nextMockId("evt"),
          title: "Mock Event B",
          start_at: afternoonStart.toISOString(),
          end_at: afternoonEnd.toISOString(),
        },
      ];

      return {
        account_id: accountId,
        added: mockState.syncedEventsByAccount[accountId].length,
        updated: 0,
        deleted: 0,
        next_sync_token: "mock-token",
        calendar_id: "primary",
      };
    }
    case "list_recipes":
      ensureMockRecipesSeeded();
      return [...mockState.recipes];
    case "create_recipe": {
      ensureMockRecipesSeeded();
      const payloadRecipe = payload.payload || payload;
      if (!payloadRecipe?.id) {
        throw new Error("recipe id is required");
      }
      if (mockState.recipes.some((recipe) => recipe.id === payloadRecipe.id)) {
        throw new Error("recipe already exists");
      }
      const recipe = {
        id: String(payloadRecipe.id),
        name: String(payloadRecipe.name || payloadRecipe.id),
        auto_drive_mode: String(payloadRecipe.autoDriveMode || payloadRecipe.auto_drive_mode || "manual"),
        steps: Array.isArray(payloadRecipe.steps) ? payloadRecipe.steps : [],
        studioMeta: payloadRecipe.studioMeta || payloadRecipe.studio_meta || null,
      };
      mockState.recipes.push(recipe);
      return recipe;
    }
    case "update_recipe": {
      ensureMockRecipesSeeded();
      const payloadRecipe = payload.payload || payload;
      const recipeId = String(payload.recipe_id || "").trim();
      if (!recipeId) throw new Error("recipe_id is required");
      const index = mockState.recipes.findIndex((recipe) => recipe.id === recipeId);
      if (index < 0) throw new Error("recipe not found");
      const updated = {
        ...mockState.recipes[index],
        ...payloadRecipe,
        id: recipeId,
      };
      mockState.recipes[index] = updated;
      return updated;
    }
    case "delete_recipe": {
      ensureMockRecipesSeeded();
      const recipeId = String(payload.recipe_id || "").trim();
      const before = mockState.recipes.length;
      mockState.recipes = mockState.recipes.filter((recipe) => recipe.id !== recipeId);
      return before !== mockState.recipes.length;
    }
    case "list_modules":
      ensureMockModulesSeeded();
      return [...mockState.modules];
    case "create_module": {
      ensureMockModulesSeeded();
      const payloadModule = payload.payload || payload;
      if (!payloadModule?.id) {
        throw new Error("module id is required");
      }
      const id = String(payloadModule.id);
      if (mockState.modules.some((module) => module.id === id)) {
        throw new Error("module already exists");
      }
      const created = {
        id,
        name: String(payloadModule.name || id),
        category: String(payloadModule.category || "General"),
        description: payloadModule.description ? String(payloadModule.description) : "",
        icon: payloadModule.icon ? String(payloadModule.icon) : "module",
        stepType: String(payloadModule.stepType || payloadModule.step_type || "micro"),
        durationMinutes: Math.max(1, Number(payloadModule.durationMinutes || payloadModule.duration_minutes || 1)),
        checklist: Array.isArray(payloadModule.checklist) ? payloadModule.checklist.map(String).filter(Boolean) : [],
        pomodoro: payloadModule.pomodoro ? { ...payloadModule.pomodoro } : null,
        overrunPolicy: String(payloadModule.overrunPolicy || payloadModule.overrun_policy || "wait"),
        executionHints: payloadModule.executionHints
          ? { ...payloadModule.executionHints }
          : { allowSkip: true, mustCompleteChecklist: false, autoAdvance: true },
      };
      mockState.modules.push(created);
      return created;
    }
    case "update_module": {
      ensureMockModulesSeeded();
      const moduleId = String(payload.module_id || "").trim();
      if (!moduleId) throw new Error("module_id is required");
      const payloadModule = payload.payload || payload;
      const index = mockState.modules.findIndex((module) => module.id === moduleId);
      if (index < 0) throw new Error("module not found");
      const updated = {
        ...mockState.modules[index],
        ...payloadModule,
        id: moduleId,
      };
      updated.durationMinutes = Math.max(1, Number(updated.durationMinutes || updated.duration_minutes || 1));
      updated.checklist = Array.isArray(updated.checklist) ? updated.checklist.map(String).filter(Boolean) : [];
      updated.pomodoro = updated.pomodoro ? { ...updated.pomodoro } : null;
      updated.executionHints = updated.executionHints
        ? { ...updated.executionHints }
        : { allowSkip: true, mustCompleteChecklist: false, autoAdvance: true };
      mockState.modules[index] = updated;
      return updated;
    }
    case "delete_module": {
      ensureMockModulesSeeded();
      const moduleId = String(payload.module_id || "").trim();
      const before = mockState.modules.length;
      mockState.modules = mockState.modules.filter((module) => module.id !== moduleId);
      return before !== mockState.modules.length;
    }
    case "apply_studio_template_to_today": {
      ensureMockRecipesSeeded();
      const templateId = String(payload.template_id || "").trim();
      const date = String(payload.date || isoDate(new Date()));
      const triggerTime = String(payload.trigger_time || "09:00");
      const recipe = mockState.recipes.find((entry) => entry.id === templateId);
      if (!recipe) throw new Error("template not found");
      const meta = recipe.studioMeta || recipe.studio_meta;
      if (!meta || Number(meta.version) !== 1 || String(meta.kind || "").toLowerCase() !== "routine_studio") {
        throw new Error("template is not a routine studio template");
      }
      const totalSeconds = (Array.isArray(recipe.steps) ? recipe.steps : []).reduce(
        (sum, step) => sum + Math.max(60, Number(step?.durationSeconds || step?.duration_seconds || 0)),
        0
      );
      if (totalSeconds <= 0) throw new Error("template has no duration");
      const [hh, mm] = triggerTime.split(":").map((entry) => Number(entry || 0));
      const requestedStart = new Date(`${date}T00:00:00`);
      requestedStart.setHours(Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0, 0, 0);
      const requestedEnd = new Date(requestedStart.getTime() + totalSeconds * 1000);
      const busyIntervals = [];
      mockState.blocks
        .filter((block) => block.date === date)
        .forEach((block) => {
          busyIntervals.push({
            startMs: new Date(block.start_at).getTime(),
            endMs: new Date(block.end_at).getTime(),
          });
        });
      Object.values(mockState.syncedEventsByAccount)
        .flat()
        .forEach((event) => {
          busyIntervals.push({
            startMs: new Date(event.start_at).getTime(),
            endMs: new Date(event.end_at).getTime(),
          });
        });
      const overlaps = (leftStart, leftEnd, rightStart, rightEnd) => leftStart < rightEnd && rightStart < leftEnd;
      const requestedStartMs = requestedStart.getTime();
      const requestedEndMs = requestedEnd.getTime();
      const conflictCount = busyIntervals.filter((interval) =>
        overlaps(requestedStartMs, requestedEndMs, interval.startMs, interval.endMs)
      ).length;
      let appliedStartMs = requestedStartMs;
      let appliedEndMs = requestedEndMs;
      let shifted = false;
      if (conflictCount > 0) {
        const sorted = busyIntervals
          .filter((interval) => Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs) && interval.endMs > interval.startMs)
          .sort((left, right) => left.startMs - right.startMs);
        let cursor = requestedStartMs;
        for (const interval of sorted) {
          if (cursor + totalSeconds * 1000 <= interval.startMs) break;
          if (interval.endMs > cursor) {
            cursor = interval.endMs;
          }
        }
        const dayEnd = new Date(`${date}T23:59:59`).getTime();
        if (cursor + totalSeconds * 1000 > dayEnd) {
          throw new Error("no available free slot to apply template today");
        }
        appliedStartMs = cursor;
        appliedEndMs = cursor + totalSeconds * 1000;
        shifted = true;
      }
      const blockId = nextMockId("blk");
      const block = {
        id: blockId,
        instance: `studio:${templateId}:${date}:${Date.now()}`,
        date,
        start_at: new Date(appliedStartMs).toISOString(),
        end_at: new Date(appliedEndMs).toISOString(),
        firmness: "draft",
        planned_pomodoros: Math.max(1, Math.round(totalSeconds / 1500)),
        source: "routine_studio",
        source_id: templateId,
        recipe_id: templateId,
        auto_drive_mode: String(recipe.auto_drive_mode || recipe.autoDriveMode || "manual"),
        contents: {},
      };
      mockState.blocks.push(block);
      return {
        template_id: templateId,
        date,
        requested_start_at: requestedStart.toISOString(),
        requested_end_at: requestedEnd.toISOString(),
        applied_start_at: new Date(appliedStartMs).toISOString(),
        applied_end_at: new Date(appliedEndMs).toISOString(),
        shifted,
        conflict_count: conflictCount,
        block_id: blockId,
      };
    }
    case "list_tasks":
      return [...mockState.tasks];
    case "create_task": {
      const task = {
        id: nextMockId("tsk"),
        title: payload.title,
        description: payload.description ?? null,
        estimated_pomodoros: payload.estimated_pomodoros ?? null,
        completed_pomodoros: 0,
        status: "pending",
        created_at: nowIso(),
      };
      mockState.tasks.push(task);
      return task;
    }
    case "update_task": {
      const task = mockState.tasks.find((item) => item.id === payload.task_id);
      if (!task) throw new Error("task not found");
      if (typeof payload.title === "string") task.title = payload.title;
      if (typeof payload.description === "string") task.description = payload.description || null;
      if (typeof payload.status === "string") task.status = payload.status;
      if (typeof payload.estimated_pomodoros === "number") task.estimated_pomodoros = payload.estimated_pomodoros;
      return { ...task };
    }
    case "delete_task":
      unassignMockTask(payload.task_id);
      mockState.tasks = mockState.tasks.filter((item) => item.id !== payload.task_id);
      return true;
    case "split_task": {
      const parts = Number(payload.parts ?? 0);
      if (!Number.isInteger(parts) || parts < 2) {
        throw new Error("parts must be >= 2");
      }
      const parent = mockState.tasks.find((item) => item.id === payload.task_id);
      if (!parent) throw new Error("task not found");
      const estimated = parent.estimated_pomodoros;
      const childEstimate =
        typeof estimated === "number" ? Math.max(1, Math.ceil(estimated / parts)) : null;
      parent.status = "deferred";
      unassignMockTask(parent.id);
      if (mockState.pomodoro.current_task_id === parent.id) {
        mockState.pomodoro.current_task_id = null;
      }

      const children = [];
      for (let index = 1; index <= parts; index += 1) {
        const child = {
          id: nextMockId("tsk"),
          title: `${parent.title} (${index}/${parts})`,
          description: parent.description ?? null,
          estimated_pomodoros: childEstimate,
          completed_pomodoros: 0,
          status: "pending",
          created_at: nowIso(),
        };
        mockState.tasks.push(child);
        children.push(child);
      }
      return children;
    }
    case "carry_over_task": {
      const taskId = String(payload.task_id ?? "").trim();
      const fromBlockId = String(payload.from_block_id ?? "").trim();
      if (!taskId || !fromBlockId) {
        throw new Error("task_id and from_block_id are required");
      }
      const task = mockState.tasks.find((item) => item.id === taskId);
      if (!task) throw new Error("task not found");
      const fromBlock = mockState.blocks.find((item) => item.id === fromBlockId);
      if (!fromBlock) throw new Error("block not found");

      const requested = Array.isArray(payload.candidate_block_ids)
        ? payload.candidate_block_ids.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      const candidates = [...mockState.blocks]
        .filter((block) => block.id !== fromBlock.id)
        .filter((block) => block.date === fromBlock.date)
        .filter((block) => new Date(block.start_at).getTime() >= new Date(fromBlock.end_at).getTime())
        .filter((block) => requested.length === 0 || requested.includes(block.id))
        .sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime());
      const next = candidates.find((block) => !mockState.taskAssignmentsByBlock[block.id]);
      if (!next) {
        throw new Error("no available block for carry-over");
      }

      assignMockTask(taskId, next.id);
      task.status = "in_progress";
      return {
        task_id: taskId,
        from_block_id: fromBlockId,
        to_block_id: next.id,
        status: task.status,
      };
    }
    case "list_blocks": {
      const date = payload.date || null;
      const blocks = date
        ? mockState.blocks.filter((block) => block.date === date)
        : mockState.blocks;
      return [...blocks];
    }
    case "list_synced_events": {
      const accountId = normalizeAccountId(payload.account_id);
      const timeMin = new Date(payload.time_min || "1970-01-01T00:00:00.000Z").getTime();
      const timeMax = new Date(payload.time_max || "2999-12-31T23:59:59.000Z").getTime();
      const entries =
        payload.account_id == null
          ? Object.entries(mockState.syncedEventsByAccount).flatMap(([entryAccountId, events]) =>
              events.map((event) => ({ ...event, account_id: entryAccountId }))
            )
          : (mockState.syncedEventsByAccount[accountId] || []).map((event) => ({
              ...event,
              account_id: accountId,
            }));
      return entries
        .filter((event) => {
          const startMs = new Date(event.start_at).getTime();
          const endMs = new Date(event.end_at).getTime();
          if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
          return endMs > timeMin && startMs < timeMax;
        })
        .sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime());
    }
    case "generate_today_blocks":
      return mockInvoke("generate_blocks", { ...payload, date: payload.date || isoDate(new Date()) });
    case "generate_blocks":
    case "generate_one_block": {
      ensureMockRecipesSeeded();
      const date = payload.date || isoDate(new Date());
      const existing = mockState.blocks.filter((block) => block.date === date);
      const isOneShot = name === "generate_one_block";
      const generated = [];
      for (let hour = 9; hour < 18; hour += 1) {
        if (isOneShot && generated.length >= 1) {
          break;
        }
        const startAt = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00.000Z`);
        const endAt = new Date(startAt.getTime() + 60 * 60000);
        const collides = existing.some((block) => {
          const startMs = new Date(block.start_at).getTime();
          const endMs = new Date(block.end_at).getTime();
          return startAt.getTime() < endMs && startMs < endAt.getTime();
        });
        if (!isOneShot && collides) {
          continue;
        }

        const block = {
          id: nextMockId("blk"),
          instance: `mock:${date}:${mockState.sequence}`,
          date,
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          firmness: "draft",
          planned_pomodoros: 2,
          source: "routine",
          source_id: "mock",
          recipe_id: "rcp-default",
          auto_drive_mode: "manual",
          contents: { task_refs: [], checklist: [], time_splits: [], memo: null },
        };
        mockState.blocks.push(block);
        existing.push(block);
        generated.push(block);
      }
      return generated;
    }
    case "approve_blocks":
      mockState.blocks = mockState.blocks.map((block) =>
        payload.block_ids.includes(block.id) ? { ...block, firmness: "soft" } : block
      );
      return mockState.blocks.filter((block) => payload.block_ids.includes(block.id));
    case "delete_block":
      if (mockState.taskAssignmentsByBlock[payload.block_id]) {
        const taskId = mockState.taskAssignmentsByBlock[payload.block_id];
        delete mockState.taskAssignmentsByBlock[payload.block_id];
        delete mockState.taskAssignmentsByTask[taskId];
      }
      mockState.blocks = mockState.blocks.filter((block) => block.id !== payload.block_id);
      return true;
    case "adjust_block_time":
      mockState.blocks = mockState.blocks.map((block) =>
        block.id === payload.block_id
          ? { ...block, start_at: payload.start_at, end_at: payload.end_at }
          : block
      );
      return mockState.blocks.find((block) => block.id === payload.block_id);
    case "start_block_timer":
    case "start_pomodoro":
      if (payload.task_id) {
        assignMockTask(payload.task_id, payload.block_id);
        const task = mockState.tasks.find((item) => item.id === payload.task_id);
        if (task && task.status !== "completed") {
          task.status = "in_progress";
        }
      }
      const targetBlock = mockState.blocks.find((block) => block.id === payload.block_id);
      const plan = targetBlock
        ? mockSessionPlan(targetBlock)
        : { totalCycles: 1, focusSeconds: 25 * 60, breakSeconds: 5 * 60 };
      mockState.pomodoro = {
        current_block_id: payload.block_id,
        current_task_id: payload.task_id ?? null,
        phase: "focus",
        remaining_seconds: plan.focusSeconds,
        start_time: nowIso(),
        total_cycles: plan.totalCycles,
        completed_cycles: 0,
        current_cycle: 1,
        focus_seconds: plan.focusSeconds,
        break_seconds: plan.breakSeconds,
        paused_phase: null,
      };
      return { ...mockState.pomodoro };
    case "next_step":
    case "advance_pomodoro": {
      const totalCycles = Math.max(1, Number(mockState.pomodoro.total_cycles || 1));
      if (mockState.pomodoro.phase === "focus") {
        mockState.pomodoro = {
          ...mockState.pomodoro,
          phase: "break",
          completed_cycles: Math.min(totalCycles, (mockState.pomodoro.completed_cycles || 0) + 1),
          remaining_seconds: mockState.pomodoro.break_seconds || 300,
        };
      } else if (mockState.pomodoro.phase === "break") {
        if ((mockState.pomodoro.completed_cycles || 0) >= totalCycles) {
          mockState.pomodoro = {
            ...emptyMockPomodoroState(),
          };
        } else {
          mockState.pomodoro = {
            ...mockState.pomodoro,
            phase: "focus",
            current_cycle: (mockState.pomodoro.current_cycle || 1) + 1,
            remaining_seconds: mockState.pomodoro.focus_seconds || 1500,
          };
        }
      }
      return { ...mockState.pomodoro };
    }
    case "pause_timer":
    case "pause_pomodoro":
      mockState.pomodoro = { ...mockState.pomodoro, phase: "paused" };
      mockState.logs.push({
        id: nextMockId("pom"),
        block_id: mockState.pomodoro.current_block_id,
        task_id: mockState.pomodoro.current_task_id,
        phase: "focus",
        start_time: nowIso(),
        end_time: nowIso(),
        interruption_reason: payload.reason ?? "paused",
      });
      return { ...mockState.pomodoro };
    case "resume_timer":
    case "resume_pomodoro":
      mockState.pomodoro = { ...mockState.pomodoro, phase: "focus" };
      return { ...mockState.pomodoro };
    case "interrupt_timer":
      appendMockPomodoroLog(mockState.pomodoro.phase || "focus", payload.reason ?? "interrupted");
      mockState.pomodoro = {
        ...emptyMockPomodoroState(),
      };
      return { ...mockState.pomodoro };
    case "complete_pomodoro":
      mockState.pomodoro = {
        current_block_id: null,
        current_task_id: null,
        phase: "idle",
        remaining_seconds: 0,
        start_time: null,
      };
      return { ...mockState.pomodoro };
    case "get_pomodoro_state":
      return { ...mockState.pomodoro };
    case "relocate_if_needed": {
      const accountId = normalizeAccountId(payload.account_id);
      const block = mockState.blocks.find((item) => item.id === payload.block_id);
      if (!block) throw new Error("block not found");
      const currentStartMs = new Date(block.start_at).getTime();
      const currentEndMs = new Date(block.end_at).getTime();
      if (!Number.isFinite(currentStartMs) || !Number.isFinite(currentEndMs) || currentEndMs <= currentStartMs) {
        return null;
      }
      const collisions = (mockState.syncedEventsByAccount[accountId] || []).filter((event) => {
        const startMs = new Date(event.start_at).getTime();
        const endMs = new Date(event.end_at).getTime();
        return Number.isFinite(startMs) && Number.isFinite(endMs) && currentStartMs < endMs && startMs < currentEndMs;
      });
      if (collisions.length === 0) {
        return null;
      }
      const latestCollisionEnd = collisions
        .map((event) => new Date(event.end_at).getTime())
        .reduce((max, value) => Math.max(max, value), currentStartMs);
      const durationMs = currentEndMs - currentStartMs;
      block.start_at = new Date(latestCollisionEnd).toISOString();
      block.end_at = new Date(latestCollisionEnd + durationMs).toISOString();
      return { ...block };
    }
    case "get_reflection_summary":
      return {
        start: payload.start ?? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
        end: payload.end ?? nowIso(),
        completed_count: 1,
        interrupted_count: mockState.logs.length,
        total_focus_minutes: 42,
        logs: [...mockState.logs],
      };
    default:
      throw new Error(`mock command not implemented: ${name}`);
  }
}

async function refreshCoreData(date = isoDate(new Date())) {
  const normalizedDate = typeof date === "string" && date.trim() ? date.trim() : isoDate(new Date());
  const syncWindow = toSyncWindowPayload(normalizedDate, "week");
  const weekDateKeys = resolveWeekDateKeys(normalizedDate);
  const weeklyBlocksPromise = Promise.all(
    weekDateKeys.map((dateKey) => safeInvoke("list_blocks", { date: dateKey }))
  ).then((dailyBlocks) => {
    const merged = dailyBlocks.flat();
    const seen = new Set();
    return merged.filter((block) => {
      if (!block?.id || seen.has(block.id)) return false;
      seen.add(block.id);
      return true;
    });
  });
  uiState.dashboardDate = normalizedDate;
  const [tasksResult, blocksResult, calendarEventsResult, pomodoroResult, recipesResult] =
    await Promise.allSettled([
    safeInvoke("list_tasks"),
    weeklyBlocksPromise,
    safeInvoke("list_synced_events", withAccount(syncWindow)),
    safeInvoke("get_pomodoro_state"),
    safeInvoke("list_recipes"),
  ]);
  const refreshErrors = [];
  if (tasksResult.status === "fulfilled") {
    uiState.tasks = tasksResult.value;
    syncNowTaskOrder(uiState.tasks);
  } else {
    const message = tasksResult.reason instanceof Error ? tasksResult.reason.message : String(tasksResult.reason);
    refreshErrors.push(`list_tasks: ${message}`);
  }
  if (blocksResult.status === "fulfilled") {
    uiState.blocks = blocksResult.value;
  } else {
    const message = blocksResult.reason instanceof Error ? blocksResult.reason.message : String(blocksResult.reason);
    refreshErrors.push(`list_blocks: ${message}`);
  }
  if (calendarEventsResult.status === "fulfilled") {
    uiState.calendarEvents = calendarEventsResult.value;
  } else {
    const message =
      calendarEventsResult.reason instanceof Error
        ? calendarEventsResult.reason.message
        : String(calendarEventsResult.reason);
    refreshErrors.push(`list_synced_events: ${message}`);
  }
  if (pomodoroResult.status === "fulfilled") {
    uiState.pomodoro = pomodoroResult.value;
    syncNowTimerDisplay(uiState.pomodoro);
  } else {
    const message = pomodoroResult.reason instanceof Error ? pomodoroResult.reason.message : String(pomodoroResult.reason);
    refreshErrors.push(`get_pomodoro_state: ${message}`);
  }
  if (recipesResult.status === "fulfilled") {
    uiState.recipes = recipesResult.value;
  } else {
    const message = recipesResult.reason instanceof Error ? recipesResult.reason.message : String(recipesResult.reason);
    refreshErrors.push(`list_recipes: ${message}`);
  }
  uiState.blocksVisibleCount = BLOCKS_INITIAL_VISIBLE;
  if (refreshErrors.length > 0) {
    setStatus(`refresh partially failed: ${refreshErrors.join(" | ")}`);
  }
}

async function authenticateAndSyncCalendar(
  date = uiState.dashboardDate || isoDate(new Date()),
  options = {}
) {
  if (options.forceReauth && !isTauriRuntimeAvailable()) {
    throw new Error(
      "SSO login requires the Tauri desktop runtime. Start it with `cd src-tauri && cargo tauri dev`."
    );
  }
  const normalizedDate = typeof date === "string" && date.trim() ? date.trim() : isoDate(new Date());
  uiState.dashboardDate = normalizedDate;
  uiState.auth = await invokeCommandWithProgress(
    "authenticate_google_sso",
    withAccount({ force_reauth: Boolean(options.forceReauth) })
  );
  const syncResult = await invokeCommandWithProgress(
    "sync_calendar",
    withAccount(toSyncWindowPayload(normalizedDate))
  );
  uiState.auth = {
    ...uiState.auth,
    synced_at: nowIso(),
    sync_result: syncResult,
  };
  return { normalizedDate, syncResult };
}

async function refreshNowPanelState(includeReflection = false) {
  const operations = [safeInvoke("get_pomodoro_state"), safeInvoke("list_tasks")];
  if (includeReflection) {
    operations.push(safeInvoke("get_reflection_summary", {}));
  }
  const [pomodoroResult, tasksResult, reflectionResult] = await Promise.allSettled(operations);
  if (pomodoroResult.status === "fulfilled") {
    uiState.pomodoro = pomodoroResult.value;
    syncNowTimerDisplay(uiState.pomodoro);
  }
  if (tasksResult.status === "fulfilled") {
    uiState.tasks = tasksResult.value;
    syncNowTaskOrder(uiState.tasks);
  }
  if (includeReflection && reflectionResult?.status === "fulfilled") {
    uiState.reflection = reflectionResult.value;
    uiState.nowUi.lastReflectionSyncEpochMs = Date.now();
  }
}

function render() {
  const route = getRoute();
  markActiveRoute(route);
  document.body.classList.toggle("route-today", route === "today");
  document.body.classList.toggle("route-now", route === "now");
  document.body.classList.toggle("route-routines", route === "routines");
  appRoot.classList.toggle("view-root--today", route === "today");
  appRoot.classList.toggle("view-root--now", route === "now");
  appRoot.classList.toggle("view-root--routines", route === "routines");

  switch (route) {
    case "today":
      renderDashboard();
      break;
    case "details":
      renderTodayDetailsPage();
      break;
    case "now":
      renderPomodoro();
      break;
    case "routines":
      renderRoutines();
      break;
    case "insights":
      renderReflection();
      break;
    case "settings":
      renderSettings();
      break;
    default:
      renderDashboard();
  }
}

function renderTodaySequenceItems() {
  const recipes = Array.isArray(uiState.recipes) ? uiState.recipes : [];
  if (recipes.length === 0) {
    return '<p class="small">シーケンスがありません。Routinesで追加してください。</p>';
  }
  return recipes
    .slice(0, 8)
    .map((recipe) => {
      const name = typeof recipe?.name === "string" && recipe.name.trim() ? recipe.name.trim() : "Untitled";
      const autoDriveMode =
        typeof recipe?.auto_drive_mode === "string" && recipe.auto_drive_mode.trim()
          ? recipe.auto_drive_mode.trim()
          : "manual";
      const stepCount = Array.isArray(recipe?.steps) ? recipe.steps.length : 0;
      return `
        <article class="today-sequence-item">
          <div class="today-sequence-icon" aria-hidden="true">${escapeHtml(name.slice(0, 1).toUpperCase())}</div>
          <div class="today-sequence-content">
            <p class="today-sequence-title">${escapeHtml(name)}</p>
            <p class="today-sequence-meta">${escapeHtml(autoDriveMode)} / ${stepCount} steps</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTodayLibraryLinks() {
  return `
    <ul class="today-library-links">
      <li><a href="#/insights">History</a></li>
      <li><a href="#/routines">Templates</a></li>
    </ul>
  `;
}

function renderTodayStatusCard() {
  const state = normalizePomodoroState(uiState.pomodoro || {});
  const controls = resolveTimerControlModel(state);
  const phaseLabel = pomodoroPhaseLabel(state.phase);
  const focusTask = resolveCurrentFocusTask(state);
  const currentBlock = state.current_block_id
    ? uiState.blocks.find((block) => block.id === state.current_block_id) || null
    : null;
  const currentTitle = currentBlock ? blockTitle(currentBlock) || currentBlock.id : "-";
  const progressPercent = pomodoroProgressPercent(state);
  const displayRemainingSeconds =
    uiState.nowUi.lastSyncEpochMs > 0
      ? Math.max(0, Math.floor(uiState.nowUi.displayRemainingSeconds || 0))
      : Math.max(0, Math.floor(state.remaining_seconds || 0));
  return `
    <section class="today-right-section today-right-section--status">
      <h3>Current Status</h3>
      <div class="today-status-card">
        <span class="pill today-status-pill">${phaseLabel}</span>
        <p class="today-status-title">${escapeHtml(currentTitle)}</p>
        <p class="today-status-subtitle">Block: ${escapeHtml(state.current_block_id || "-")}</p>
        <p class="today-status-subtitle">Task: ${escapeHtml(focusTask?.title || "-")}</p>
        <div class="today-status-time" data-today-status-time>${toTimerText(displayRemainingSeconds)}</div>
        <div class="today-status-controls">
          <button
            class="today-status-action today-status-action--secondary"
            data-today-timer-action="${controls.leftAction}"
            aria-label="${controls.leftLabel}"
            title="${controls.leftLabel}"
            ${controls.leftDisabled ? "disabled" : ""}
          ><span class="now-control-icon" aria-hidden="true">${controls.leftIcon}</span><span class="now-visually-hidden">${controls.leftLabel}</span></button>
          <button
            class="today-status-action today-status-action--primary"
            data-today-timer-action="${controls.primaryAction}"
            aria-label="${controls.primaryLabel}"
            title="${controls.primaryLabel}"
            ${controls.primaryDisabled ? "disabled" : ""}
          ><span class="now-control-icon" aria-hidden="true">${controls.primaryIcon}</span><span class="now-visually-hidden">${controls.primaryLabel}</span></button>
          <button
            class="today-status-action today-status-action--secondary"
            data-today-timer-action="${controls.rightAction}"
            aria-label="${controls.rightLabel}"
            title="${controls.rightLabel}"
            ${controls.rightDisabled ? "disabled" : ""}
          ><span class="now-control-icon" aria-hidden="true">${controls.rightIcon}</span><span class="now-visually-hidden">${controls.rightLabel}</span></button>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${progressPercent}%"></div></div>
      </div>
    </section>
  `;
}

function refreshTodayStatusTimerDisplay() {
  if (getRoute() !== "today") {
    return;
  }
  const statusTime = appRoot.querySelector("[data-today-status-time]");
  if (!(statusTime instanceof HTMLElement)) {
    return;
  }
  const state = normalizePomodoroState(uiState.pomodoro || {});
  const displayRemainingSeconds =
    uiState.nowUi.lastSyncEpochMs > 0
      ? Math.max(0, Math.floor(uiState.nowUi.displayRemainingSeconds || 0))
      : Math.max(0, Math.floor(state.remaining_seconds || 0));
  statusTime.textContent = toTimerText(displayRemainingSeconds);
}

function resolveTimerControlModel(stateInput = uiState.pomodoro) {
  const state = normalizePomodoroState(stateInput || {});
  const canStart = state.phase === "idle" && Boolean(resolveNowAutoStartBlock(state));
  const isRunningPhase = state.phase === "focus" || state.phase === "break";
  const canPause = isRunningPhase;
  const canNext = isRunningPhase;
  const canStop = isRunningPhase;
  const canResume = state.phase === "paused";
  const controlsDisabled = Boolean(uiState.nowUi.actionInFlight);
  const leftAction = canStop ? "stop" : "";
  const rightAction = canNext ? "next" : "";
  const primaryAction = state.phase === "idle" ? "start" : canPause ? "pause" : canResume ? "resume" : "";
  return {
    leftAction,
    leftLabel: "Stop",
    leftIcon: "⏹",
    leftDisabled: controlsDisabled || !leftAction,
    rightAction,
    rightLabel: "Next",
    rightIcon: "⏭",
    rightDisabled: controlsDisabled || !rightAction,
    primaryAction,
    primaryLabel: primaryAction === "start" ? "開始" : primaryAction === "pause" ? "中断" : "再開",
    primaryIcon: primaryAction === "pause" ? "⏸" : "▶",
    primaryDisabled:
      controlsDisabled ||
      !primaryAction ||
      (primaryAction === "start" && !canStart) ||
      (primaryAction === "pause" && !canPause) ||
      (primaryAction === "resume" && !canResume),
  };
}

async function executeTimerAction(action, rerender) {
  if (!action || uiState.nowUi.actionInFlight) return;
  uiState.nowUi.actionInFlight = true;
  rerender();

  let shouldRefresh = true;
  await runUiAction(async () => {
    if (action === "start") {
      const latestState = normalizePomodoroState(uiState.pomodoro || {});
      const targetBlock = resolveNowAutoStartBlock(latestState);
      if (!targetBlock) {
        setStatus("start_block_timer skipped: no block available for today");
        shouldRefresh = false;
        return;
      }
      const targetTask = resolveNowAutoStartTask(latestState);
      const payload = { block_id: targetBlock.id, task_id: targetTask?.id || null };
      await safeInvokeWithFallback("start_block_timer", payload, "start_pomodoro", payload);
    } else if (action === "pause") {
      await safeInvokeWithFallback("pause_timer", { reason: "manual_pause" }, "pause_pomodoro", {
        reason: "manual_pause",
      });
    } else if (action === "resume") {
      await safeInvokeWithFallback("resume_timer", {}, "resume_pomodoro", {});
    } else if (action === "next") {
      await safeInvokeWithFallback("next_step", {}, "advance_pomodoro", {});
    } else if (action === "stop") {
      await safeInvokeWithFallback("pause_timer", { reason: "manual_stop" }, "pause_pomodoro", {
        reason: "manual_stop",
      });
    } else {
      shouldRefresh = false;
    }

    if (shouldRefresh) {
      await refreshNowPanelState(true);
    }
  });

  uiState.nowUi.actionInFlight = false;
  rerender();
}

function renderTodayTaskPanel() {
  const state = normalizePomodoroState(uiState.pomodoro || {});
  const focusTask = resolveCurrentFocusTask(state);
  const focusTaskId = focusTask?.id || "";
  const activeTasks = uiState.tasks.filter((task) => task.status !== "completed");
  const visibleTasks = activeTasks.slice(0, 5);
  const overflowCount = Math.max(0, activeTasks.length - visibleTasks.length);
  return `
    <section class="today-right-section today-right-section--tasks">
      <div class="row spread">
        <h3>Active Micro-Tasks</h3>
        <span class="small">${focusTask ? `Current: ${escapeHtml(focusTask.title || "(untitled)")}` : "Current: -"}</span>
      </div>
      <ul class="today-task-list">
        ${
          visibleTasks.length === 0
            ? '<li class="today-task-empty">未完了タスクはありません。</li>'
            : visibleTasks
                .map(
                  (task) => `
            <li class="today-task-item">
              <span class="today-task-bullet ${task.id === focusTaskId ? "is-active" : ""}" aria-hidden="true"></span>
              <span>${escapeHtml(task.title || "(untitled)")}</span>
            </li>
          `
                )
                .join("")
        }
      </ul>
      ${overflowCount > 0 ? `<p class="small">他 ${overflowCount} 件</p>` : ""}
    </section>
  `;
}

function renderTodayTimelinePanel() {
  const timelineBlocks = [...uiState.blocks]
    .sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime())
    .slice(0, 10);
  return `
    <section class="today-timeline-panel">
      <div class="row spread">
        <h3>Today's Timeline</h3>
        <span class="small">${uiState.blocks.length} items</span>
      </div>
      <ul class="today-timeline-list">
        ${
          timelineBlocks.length === 0
            ? '<li class="today-timeline-empty">予定はまだありません。</li>'
            : timelineBlocks
                .map((block) => {
                  const title = blockTitle(block) || "Untitled Block";
                  const timeRange = `${formatHHmm(block.start_at)} - ${formatHHmm(block.end_at)}`;
                  return `
                    <li class="today-timeline-item">
                      <div class="today-timeline-time">${escapeHtml(timeRange)}</div>
                      <div class="today-timeline-content">
                        <p class="today-timeline-title">${escapeHtml(title)}</p>
                        <p class="today-timeline-meta">${escapeHtml(block.firmness || "draft")} / ${escapeHtml(
                    block.source || "generated"
                  )}</p>
                      </div>
                    </li>
                  `;
                })
                .join("")
        }
      </ul>
    </section>
  `;
}

function renderTodayNotesPanel() {
  const activeTask = resolveCurrentFocusTask(uiState.pomodoro || {}) || null;
  const defaultNote = activeTask ? `Now focusing: ${activeTask.title || "(untitled)"}` : "Type notes here...";
  return `
    <section class="today-right-section today-right-section--notes">
      <div class="row spread">
        <h3>Session Notes</h3>
        <span class="small">${activeTask ? "active task linked" : "free form"}</span>
      </div>
      <textarea class="today-notes-input" placeholder="${escapeHtml(defaultNote)}"></textarea>
    </section>
  `;
}

function renderTodayAmbientPanel() {
  return `
    <section class="today-right-footer">
      <div class="today-ambient-cover" aria-hidden="true">A</div>
      <div class="today-ambient-meta">
        <p class="today-ambient-title">Deep Focus Ambient</p>
        <p class="today-ambient-source">Brain.fm</p>
      </div>
      <div class="today-ambient-controls" aria-hidden="true">| |</div>
    </section>
  `;
}

function blockRows(blocks) {
  return blocks
    .map(
      (block) => `
      <tr>
        <td>${blockDisplayName(block)}</td>
        <td>${formatTime(block.start_at)}</td>
        <td>${formatTime(block.end_at)}</td>
        <td><span class="pill">${block.firmness}</span></td>
      </tr>`
    )
    .join("");
}

function bindDailyCalendarInteractions(rerender) {
  appRoot.querySelectorAll(".day-entry-block.is-draggable[data-day-item-id]").forEach((node) => {
    node.addEventListener("pointerdown", (event) => {
      const pointerEvent = /** @type {PointerEvent} */ (event);
      if (pointerEvent.button !== 0) return;
      const entry = /** @type {HTMLButtonElement} */ (node);
      const blockId = entry.dataset.dayItemId;
      const dayStartMs = Number(entry.dataset.dayStartMs || "");
      const dayEndMs = Number(entry.dataset.dayEndMs || "");
      const itemStartMs = Number(entry.dataset.dayItemStartMs || "");
      const itemEndMs = Number(entry.dataset.dayItemEndMs || "");
      const laneTrack = entry.closest(".day-lane-track");
      const laneHeight = laneTrack instanceof HTMLElement ? laneTrack.clientHeight : 0;
      if (
        !blockId ||
        !Number.isFinite(dayStartMs) ||
        !Number.isFinite(dayEndMs) ||
        !Number.isFinite(itemStartMs) ||
        !Number.isFinite(itemEndMs) ||
        dayEndMs <= dayStartMs ||
        itemEndMs <= itemStartMs ||
        laneHeight <= 1
      ) {
        return;
      }

      clearDayBlockDragDocumentListeners();
      dayBlockDragState.active = true;
      dayBlockDragState.moved = false;
      dayBlockDragState.pointerId = pointerEvent.pointerId;
      dayBlockDragState.blockId = blockId;
      dayBlockDragState.dayStartMs = dayStartMs;
      dayBlockDragState.dayEndMs = dayEndMs;
      dayBlockDragState.rangeMs = dayEndMs - dayStartMs;
      dayBlockDragState.trackHeightPx = laneHeight;
      dayBlockDragState.trackWidthPx = 0;
      dayBlockDragState.originClientY = pointerEvent.clientY;
      dayBlockDragState.originClientX = pointerEvent.clientX;
      dayBlockDragState.originStartMs = itemStartMs;
      dayBlockDragState.originEndMs = itemEndMs;
      dayBlockDragState.previewStartMs = itemStartMs;
      dayBlockDragState.previewEndMs = itemEndMs;
      dayBlockDragState.entry = entry;
      dayBlockDragState.timeLabel = entry.querySelector(".day-entry-time");
      dayBlockDragState.originalTopCss = entry.style.top || "";
      dayBlockDragState.originalLeftCss = entry.style.left || "";
      dayBlockDragState.originalTimeLabelText = dayBlockDragState.timeLabel?.textContent || "";
      dayBlockDragState.originalTitle = entry.title || "";
      entry.classList.add("is-dragging");
      entry.style.zIndex = "4";
      try {
        entry.setPointerCapture(pointerEvent.pointerId);
      } catch {
        // ignore unsupported pointer capture
      }

      const onMove = (moveEvent) => {
        if (!dayBlockDragState.active || moveEvent.pointerId !== dayBlockDragState.pointerId) return;
        const durationMs = dayBlockDragState.originEndMs - dayBlockDragState.originStartMs;
        const hovered = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
        const hoveredFreeEntry =
          hovered instanceof Element
            ? hovered.closest(".day-entry-free[data-day-item-start-ms][data-day-item-end-ms]")
            : null;
        const hoveredFree =
          hoveredFreeEntry instanceof HTMLElement ? hoveredFreeEntry : null;
        let movedByFreeDrop = false;

        if (hoveredFree) {
          const freeStartMs = Number(hoveredFree.dataset.dayItemStartMs || "");
          const freeEndMs = Number(hoveredFree.dataset.dayItemEndMs || "");
          if (
            Number.isFinite(freeStartMs) &&
            Number.isFinite(freeEndMs) &&
            freeEndMs > freeStartMs &&
            freeEndMs - freeStartMs >= durationMs
          ) {
            setHoveredFreeEntry(hoveredFree);
            const nextInterval = snapAndClampBlockInterval(
              freeStartMs,
              durationMs,
              dayBlockDragState.dayStartMs,
              dayBlockDragState.dayEndMs
            );
            applyDayBlockPreview(entry, nextInterval);
            movedByFreeDrop = true;
          } else {
            setHoveredFreeEntry(null);
          }
        } else {
          setHoveredFreeEntry(null);
        }

        const deltaY = moveEvent.clientY - dayBlockDragState.originClientY;
        if (!movedByFreeDrop) {
          if (!dayBlockDragState.moved && Math.abs(deltaY) < DAY_BLOCK_DRAG_THRESHOLD_PX) {
            return;
          }

          const deltaMsRaw = (deltaY / dayBlockDragState.trackHeightPx) * dayBlockDragState.rangeMs;
          const nextInterval = snapAndClampBlockInterval(
            dayBlockDragState.originStartMs + deltaMsRaw,
            durationMs,
            dayBlockDragState.dayStartMs,
            dayBlockDragState.dayEndMs
          );
          applyDayBlockPreview(entry, nextInterval);
        }

        dayBlockDragState.moved =
          Math.abs(dayBlockDragState.previewStartMs - dayBlockDragState.originStartMs) >= 1000 ||
          Math.abs(dayBlockDragState.previewEndMs - dayBlockDragState.originEndMs) >= 1000;
        moveEvent.preventDefault();
      };

      const onUp = (upEvent) => {
        if (!dayBlockDragState.active || upEvent.pointerId !== dayBlockDragState.pointerId) return;
        finishDayBlockDrag(rerender);
      };

      dayBlockDragState.onMove = onMove;
      dayBlockDragState.onUp = onUp;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      pointerEvent.preventDefault();
    });
  });
  appRoot.querySelectorAll(".day-simple-segment-block.is-draggable[data-day-item-id]").forEach((node) => {
    node.addEventListener("pointerdown", (event) => {
      const pointerEvent = /** @type {PointerEvent} */ (event);
      if (pointerEvent.button !== 0) return;
      const entry = /** @type {HTMLButtonElement} */ (node);
      const blockId = entry.dataset.dayItemId;
      const dayStartMs = Number(entry.dataset.dayStartMs || "");
      const dayEndMs = Number(entry.dataset.dayEndMs || "");
      const itemStartMs = Number(entry.dataset.dayItemStartMs || "");
      const itemEndMs = Number(entry.dataset.dayItemEndMs || "");
      const laneTrack = entry.closest(".day-simple-track");
      const laneWidth = laneTrack instanceof HTMLElement ? laneTrack.clientWidth : 0;
      if (
        !blockId ||
        !Number.isFinite(dayStartMs) ||
        !Number.isFinite(dayEndMs) ||
        !Number.isFinite(itemStartMs) ||
        !Number.isFinite(itemEndMs) ||
        dayEndMs <= dayStartMs ||
        itemEndMs <= itemStartMs ||
        laneWidth <= 1
      ) {
        return;
      }

      clearDayBlockDragDocumentListeners();
      dayBlockDragState.active = true;
      dayBlockDragState.moved = false;
      dayBlockDragState.pointerId = pointerEvent.pointerId;
      dayBlockDragState.blockId = blockId;
      dayBlockDragState.dayStartMs = dayStartMs;
      dayBlockDragState.dayEndMs = dayEndMs;
      dayBlockDragState.rangeMs = dayEndMs - dayStartMs;
      dayBlockDragState.trackHeightPx = 0;
      dayBlockDragState.trackWidthPx = laneWidth;
      dayBlockDragState.originClientY = pointerEvent.clientY;
      dayBlockDragState.originClientX = pointerEvent.clientX;
      dayBlockDragState.originStartMs = itemStartMs;
      dayBlockDragState.originEndMs = itemEndMs;
      dayBlockDragState.previewStartMs = itemStartMs;
      dayBlockDragState.previewEndMs = itemEndMs;
      dayBlockDragState.entry = entry;
      dayBlockDragState.timeLabel = null;
      dayBlockDragState.originalTopCss = entry.style.top || "";
      dayBlockDragState.originalLeftCss = entry.style.left || "";
      dayBlockDragState.originalTimeLabelText = "";
      dayBlockDragState.originalTitle = entry.title || "";
      entry.classList.add("is-dragging");
      entry.style.zIndex = "4";
      try {
        entry.setPointerCapture(pointerEvent.pointerId);
      } catch {
        // ignore unsupported pointer capture
      }

      const onMove = (moveEvent) => {
        if (!dayBlockDragState.active || moveEvent.pointerId !== dayBlockDragState.pointerId) return;
        const deltaX = moveEvent.clientX - dayBlockDragState.originClientX;
        if (!dayBlockDragState.moved && Math.abs(deltaX) < DAY_BLOCK_DRAG_THRESHOLD_PX) {
          return;
        }
        const durationMs = dayBlockDragState.originEndMs - dayBlockDragState.originStartMs;
        const deltaMsRaw = (deltaX / dayBlockDragState.trackWidthPx) * dayBlockDragState.rangeMs;
        const nextInterval = snapAndClampBlockInterval(
          dayBlockDragState.originStartMs + deltaMsRaw,
          durationMs,
          dayBlockDragState.dayStartMs,
          dayBlockDragState.dayEndMs
        );
        applyDayBlockPreview(entry, nextInterval);
        dayBlockDragState.moved =
          Math.abs(dayBlockDragState.previewStartMs - dayBlockDragState.originStartMs) >= 1000 ||
          Math.abs(dayBlockDragState.previewEndMs - dayBlockDragState.originEndMs) >= 1000;
        moveEvent.preventDefault();
      };

      const onUp = (upEvent) => {
        if (!dayBlockDragState.active || upEvent.pointerId !== dayBlockDragState.pointerId) return;
        finishDayBlockDrag(rerender);
      };

      dayBlockDragState.onMove = onMove;
      dayBlockDragState.onUp = onUp;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      pointerEvent.preventDefault();
    });
  });

  appRoot.querySelectorAll("[data-day-view]").forEach((node) => {
    node.addEventListener("click", () => {
      const element = /** @type {HTMLElement} */ (node);
      const mode = element.dataset.dayView;
      if (mode !== "grid" && mode !== "simple") return;
      uiState.dayCalendarViewMode = /** @type {DayCalendarViewMode} */ (mode);
      rerender();
    });
  });
  appRoot.querySelectorAll("[data-day-item-kind][data-day-item-id]").forEach((node) => {
    node.addEventListener("click", () => {
      if (Date.now() < dayBlockDragState.suppressClickUntil) {
        return;
      }
      const element = /** @type {HTMLElement} */ (node);
      const kind = element.dataset.dayItemKind;
      const id = element.dataset.dayItemId;
      if (!id) return;
      if (kind !== "block" && kind !== "event" && kind !== "free") return;
      uiState.dayCalendarSelection = { kind: /** @type {DayItemKind} */ (kind), id };
      rerender();
    });
  });
  appRoot.querySelectorAll("[data-block-title-save]").forEach((node) => {
    node.addEventListener("click", () => {
      const button = /** @type {HTMLElement} */ (node);
      const blockId = button.dataset.blockTitleSave;
      if (!blockId) return;
      const nearestContainer = button.parentElement || appRoot;
      const scopedInput = nearestContainer.querySelector(
        `input[data-block-title-input="${blockId}"]`
      );
      const fallbackInput = appRoot.querySelector(`input[data-block-title-input="${blockId}"]`);
      const input = scopedInput || fallbackInput;
      if (!(input instanceof HTMLInputElement)) return;
      if (!setBlockTitle(blockId, input.value)) return;
      setStatus(input.value.trim() ? "タイトルを保存しました" : "タイトルをクリアしました");
      rerender();
    });
  });
}

function renderDashboard() {
  const fallbackDate = isoDate(new Date());
  const selectedDate = uiState.dashboardDate || fallbackDate;
  const weeklyModel = buildWeeklyPlannerModel(selectedDate, uiState.blocks, uiState.calendarEvents);
  appRoot.innerHTML = `
    <section class="today-layout">
      <aside class="today-left-rail">
        <section class="today-left-section today-left-section--sequences">
          <div class="today-rail-head">
            <h3>Micro Sequences</h3>
            <p class="small">Drag to calendar to schedule</p>
          </div>
          <div class="today-sequence-list">${renderTodaySequenceItems()}</div>
        </section>
        <section class="today-left-section today-left-section--library">
          <h3>Library</h3>
          ${renderTodayLibraryLinks()}
        </section>
        <div class="today-left-spacer" aria-hidden="true"></div>
        <div class="today-left-footer">
          <a class="today-create-sequence" href="#/routines">+ Create Sequence</a>
        </div>
      </aside>

      <section class="today-main-pane">
        <header class="today-main-head">
          <div>
            <h2>Weekly Planner</h2>
            <p>${escapeHtml(weeklyModel.weekLabel)}</p>
          </div>
          <div class="today-main-head-actions">
            <span class="pill">${escapeHtml(selectedDate)}</span>
            <a href="#/details" class="today-manage-btn">Details</a>
          </div>
        </header>
        <section class="panel today-planner-shell">${renderWeeklyPlannerCalendar(weeklyModel)}</section>
      </section>

      <aside class="today-right-rail">
        ${renderTodayStatusCard()}
        ${renderTodayTaskPanel()}
        ${renderTodayNotesPanel()}
        ${renderTodayAmbientPanel()}
      </aside>
    </section>
  `;
  appRoot.querySelectorAll("[data-today-timer-action]").forEach((node) => {
    node.addEventListener("click", async (event) => {
      const action = /** @type {HTMLElement} */ (event.currentTarget)?.dataset.todayTimerAction;
      await executeTimerAction(action || "", renderDashboard);
    });
  });
  bindDailyCalendarInteractions(renderDashboard);
}

function renderTodayDetailsPage() {
  const fallbackDate = isoDate(new Date());
  const selectedDate = uiState.dashboardDate || fallbackDate;
  appRoot.innerHTML = `
    <section class="view-head">
      <div>
        <h2>Details</h2>
        <p>Today の詳細表示と管理操作をこのページで行います。</p>
      </div>
      <a href="#/today" class="today-manage-btn">Back to Today</a>
    </section>
    <section class="panel today-controls-panel">
      <div class="today-controls-grid">
        <label>日付 <input id="dashboard-date" type="date" value="${selectedDate}" /></label>
        <label>Account <input id="dashboard-account-id" value="${normalizeAccountId(uiState.accountId)}" /></label>
      </div>
      <div class="today-controls-actions">
        <button id="dashboard-sync" class="btn-primary">同期</button>
        <button id="dashboard-generate" class="btn-secondary">本日再生成</button>
        <button id="dashboard-reset-blocks" class="btn-warn">ブロックリセット</button>
        <button id="dashboard-refresh" class="btn-secondary">再読込</button>
      </div>
    </section>
    ${renderDailyCalendar(selectedDate, {
      panelClass: "today-advanced-calendar",
      includeDetail: true,
    })}
    <section class="panel today-block-table">
      <h3>今日のブロック</h3>
      <table>
        <thead><tr><th>ID</th><th>開始</th><th>終了</th><th>Firmness</th></tr></thead>
        <tbody>${blockRows(uiState.blocks)}</tbody>
      </table>
    </section>
  `;

  const getSelectedDate = () => {
    const raw = /** @type {HTMLInputElement | null} */ (document.getElementById("dashboard-date"))?.value;
    return raw && raw.trim() ? raw.trim() : uiState.dashboardDate || fallbackDate;
  };
  const getSelectedAccount = () =>
    normalizeAccountId(
      /** @type {HTMLInputElement | null} */ (document.getElementById("dashboard-account-id"))?.value ||
        normalizeAccountId(uiState.accountId)
    );

  document.getElementById("dashboard-date")?.addEventListener("change", async () => {
    await runUiAction(async () => {
      const date = getSelectedDate();
      await refreshCoreData(date);
      renderTodayDetailsPage();
    });
  });
  document.getElementById("dashboard-account-id")?.addEventListener("change", async () => {
    await runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      await refreshCoreData(date);
      renderTodayDetailsPage();
    });
  });

  document.getElementById("dashboard-sync")?.addEventListener("click", async () => {
    await runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      await authenticateAndSyncCalendar(date);
      await refreshCoreData(date);
      renderTodayDetailsPage();
    });
  });
  document.getElementById("dashboard-generate")?.addEventListener("click", async () => {
    await runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      try {
        await invokeCommandWithProgress("generate_today_blocks", withAccount({}));
      } catch (error) {
        if (!isUnknownCommandError(error)) {
          throw error;
        }
        await invokeCommandWithProgress("generate_blocks", withAccount({ date }));
      }
      await refreshCoreData(date);
      renderTodayDetailsPage();
    });
  });
  document.getElementById("dashboard-reset-blocks")?.addEventListener("click", async () => {
    await runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      const deletedCount = await resetBlocksForDate(date);
      await refreshCoreData(date);
      setStatus(`ブロックを削除しました: ${deletedCount}件 (${date})`);
      renderTodayDetailsPage();
    });
  });
  document.getElementById("dashboard-refresh")?.addEventListener("click", async () => {
    await runUiAction(async () => {
      const date = getSelectedDate();
      await refreshCoreData(date);
      renderTodayDetailsPage();
    });
  });
  bindDailyCalendarInteractions(renderTodayDetailsPage);
}

function renderBlocks() {
  const today = uiState.dashboardDate || isoDate(new Date());
  const visibleCount = Math.max(1, Math.floor(uiState.blocksVisibleCount || BLOCKS_INITIAL_VISIBLE));
  const visibleBlocks = uiState.blocks.slice(0, visibleCount);
  const hasMoreBlocks = uiState.blocks.length > visibleBlocks.length;
  appRoot.innerHTML = `
    <section class="view-head">
      <div>
        <h2>ブロック確認 / 承認</h2>
        <p>生成ブロックを承認・削除・時刻調整します。</p>
      </div>
      <label>日付 <input id="block-date" type="date" value="${today}" /></label>
      <label>Account <input id="block-account-id" value="${normalizeAccountId(uiState.accountId)}" /></label>
    </section>
    <div class="panel row">
      <button id="block-load" class="btn-secondary">読込</button>
      <button id="block-generate-partial" class="btn-secondary">一部生成</button>
      <button id="block-generate-bulk" class="btn-primary">一括生成</button>
      <button id="block-reset-all" class="btn-warn">全リセット</button>
    </div>
    ${renderDailyCalendar(today)}
    <div class="grid">
      ${visibleBlocks
        .map(
          (block) => `
          <article class="panel">
            <div class="row spread">
              <h3>${blockDisplayName(block)}</h3>
              <span class="pill">${block.firmness}</span>
            </div>
            <div class="row" style="margin-top:10px">
              <label style="flex:1">
                タイトル
                <input
                  type="text"
                  value="${escapeHtml(blockTitle(block))}"
                  data-block-title-input="${escapeHtml(block.id)}"
                  placeholder="タイトルなし"
                />
              </label>
              <button type="button" class="btn-secondary" data-block-title-save="${escapeHtml(block.id)}">タイトル保存</button>
            </div>
            <p class="small">Start: ${formatTime(block.start_at)} / End: ${formatTime(block.end_at)}</p>
            <div class="grid two" style="margin-top:10px">
              <label>開始 <input id="start-${block.id}" type="datetime-local" value="${toLocalInputValue(block.start_at)}" /></label>
              <label>終了 <input id="end-${block.id}" type="datetime-local" value="${toLocalInputValue(block.end_at)}" /></label>
            </div>
            <div class="row" style="margin-top:10px">
              <button class="btn-primary" data-approve="${block.id}">承認</button>
              <button class="btn-secondary" data-adjust="${block.id}">時刻調整</button>
              <button class="btn-warn" data-relocate="${block.id}">再配置</button>
              <button class="btn-danger" data-delete="${block.id}">削除</button>
            </div>
          </article>`
        )
        .join("")}
    </div>
    <div class="panel row spread">
      <span class="small">表示中 ${visibleBlocks.length} / 全 ${uiState.blocks.length}</span>
      ${
        hasMoreBlocks
          ? '<button id="block-show-more" class="btn-secondary">さらに表示</button>'
          : ""
      }
    </div>
  `;

  const reload = async () => {
    const date = /** @type {HTMLInputElement} */ (document.getElementById("block-date")).value || today;
    const accountInput = /** @type {HTMLInputElement | null} */ (document.getElementById("block-account-id"));
    if (accountInput) {
      uiState.accountId = normalizeAccountId(accountInput.value);
    }
    uiState.dashboardDate = date;
    uiState.blocks = await safeInvoke("list_blocks", { date });
    uiState.calendarEvents = await safeInvoke("list_synced_events", withAccount(toSyncWindowPayload(date)));
    uiState.blocksVisibleCount = BLOCKS_INITIAL_VISIBLE;
    renderBlocks();
  };

  const getSelectedDate = () =>
    /** @type {HTMLInputElement} */ (document.getElementById("block-date")).value || today;
  const getSelectedAccount = () =>
    normalizeAccountId(
      /** @type {HTMLInputElement} */ (document.getElementById("block-account-id")).value
    );

  document.getElementById("block-load")?.addEventListener("click", async () => {
    await runUiAction(reload);
  });
  document.getElementById("block-generate-partial")?.addEventListener("click", async () => {
    await runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      const generated = await safeInvoke("generate_one_block", withAccount({ date }));
      if (generated.length === 0) {
        setStatus("一部生成: 追加可能な枠がありません");
      } else {
        setStatus("一部生成を実行しました（1件生成）");
      }
      await reload();
    });
  });
  document.getElementById("block-generate-bulk")?.addEventListener("click", async () => {
    await runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      const generated = await invokeCommandWithProgress("generate_blocks", withAccount({ date }));
      setStatus(`一括生成を実行しました（${generated.length}件生成）`);
      await reload();
    });
  });
  document.getElementById("block-reset-all")?.addEventListener("click", async () => {
    await runUiAction(async () => {
      const date = getSelectedDate();
      uiState.accountId = getSelectedAccount();
      const deletedCount = await resetBlocksForDate(date);
      await refreshCoreData(date);
      setStatus(`ブロックを削除しました: ${deletedCount}件 (${date})`);
      renderBlocks();
    });
  });
  document.getElementById("block-date")?.addEventListener("change", async () => {
    await runUiAction(reload);
  });
  document.getElementById("block-account-id")?.addEventListener("change", async () => {
    await runUiAction(reload);
  });

  appRoot.querySelectorAll("[data-approve]").forEach((node) => {
    node.addEventListener("click", async () => {
      await runUiAction(async () => {
        const id = /** @type {HTMLElement} */ (node).dataset.approve;
        await safeInvoke("approve_blocks", { block_ids: [id] });
        await reload();
      });
    });
  });
  appRoot.querySelectorAll("[data-delete]").forEach((node) => {
    node.addEventListener("click", async () => {
      await runUiAction(async () => {
        const id = /** @type {HTMLElement} */ (node).dataset.delete;
        await safeInvoke("delete_block", { block_id: id });
        await reload();
      });
    });
  });
  appRoot.querySelectorAll("[data-adjust]").forEach((node) => {
    node.addEventListener("click", async () => {
      await runUiAction(async () => {
        const id = /** @type {HTMLElement} */ (node).dataset.adjust;
        const start = /** @type {HTMLInputElement} */ (document.getElementById(`start-${id}`)).value;
        const end = /** @type {HTMLInputElement} */ (document.getElementById(`end-${id}`)).value;
        await safeInvoke("adjust_block_time", {
          block_id: id,
          start_at: fromLocalInputValue(start),
          end_at: fromLocalInputValue(end),
        });
        await reload();
      });
    });
  });
  appRoot.querySelectorAll("[data-relocate]").forEach((node) => {
    node.addEventListener("click", async () => {
      await runUiAction(async () => {
        const id = /** @type {HTMLElement} */ (node).dataset.relocate;
        await safeInvoke("relocate_if_needed", withAccount({ block_id: id }));
        await reload();
      });
    });
  });
  document.getElementById("block-show-more")?.addEventListener("click", () => {
    uiState.blocksVisibleCount = Math.min(uiState.blocks.length, visibleCount + BLOCKS_INITIAL_VISIBLE);
    renderBlocks();
  });
  bindDailyCalendarInteractions(renderBlocks);
}

function renderPomodoro() {
  const state = normalizePomodoroState(uiState.pomodoro || {});
  if (uiState.nowUi.lastSyncEpochMs === 0) {
    syncNowTimerDisplay(state);
  }

  const nowMs = Date.now();
  const todayBlocks = resolveNowBlocks();
  const orderedTasks = getNowOrderedTasks(true);
  const openTasks = orderedTasks.filter((task) => task.status !== "completed");
  const runningBlock = state.current_block_id
    ? todayBlocks.find(({ block }) => block.id === state.current_block_id)?.block || null
    : null;
  const runningTask = resolveCurrentFocusTask(state);
  const autoStartBlock = resolveNowAutoStartBlock(state);
  const autoStartTask = resolveNowAutoStartTask(state);
  const displayRemainingSeconds = Math.max(0, Math.floor(uiState.nowUi.displayRemainingSeconds || 0));
  const phaseTotalSeconds = Math.max(1, Math.floor(uiState.nowUi.phaseTotalSeconds || displayRemainingSeconds || 1));
  const phaseProgress =
    state.phase === "idle"
      ? 0
      : Math.max(0, Math.min(100, Math.round((displayRemainingSeconds / phaseTotalSeconds) * 100)));
  const phaseLabel = pomodoroPhaseLabel(state.phase);
  const deferredCount = uiState.tasks.filter((task) => task.status === "deferred").length;
  const bufferMinutes = nowBufferAvailableMinutes();
  const reflectionLogs = Array.isArray(uiState.reflection?.logs) ? uiState.reflection.logs : null;
  const focusCompletion =
    reflectionLogs && reflectionLogs.length > 0
      ? Math.round(((uiState.reflection?.completed_count ?? 0) / reflectionLogs.length) * 100)
      : null;
  const objectiveTitle =
    runningTask?.title ||
    (runningBlock ? blockTitle(runningBlock) || runningBlock.id : autoStartTask?.title || (autoStartBlock ? blockTitle(autoStartBlock) || autoStartBlock.id : "Ready"));
  const objectiveBlockId = runningBlock?.id || autoStartBlock?.id || "-";
  const currentStep = state.total_cycles > 0 ? Math.max(1, Math.min(state.current_cycle || 1, state.total_cycles)) : 1;
  const totalSteps = state.total_cycles > 0 ? state.total_cycles : Math.max(1, autoStartBlock?.planned_pomodoros || 1);
  const controls = resolveTimerControlModel(state);

  appRoot.innerHTML = `
    <section class="now-layout">
      <aside class="now-left-rail">
        <header class="now-left-head">
          <h3>Today's Timeline</h3>
          <p class="small">${todayBlocks.length} blocks</p>
        </header>
        <div class="now-timeline-list">
          ${
            todayBlocks.length === 0
              ? '<p class="small now-empty">今日のブロックがありません。</p>'
              : todayBlocks
                  .map(({ block, startMs, endMs }) => {
                    const isActive = state.current_block_id === block.id || (startMs <= nowMs && nowMs < endMs && state.phase === "idle");
                    const title = blockTitle(block) || block.id;
                    return `
                      <article class="now-timeline-item ${isActive ? "is-active" : ""}">
                        <div class="row spread">
                          <p class="now-timeline-title">${escapeHtml(title)}</p>
                          ${isActive ? '<span class="pill now-pill-active">IN PROGRESS</span>' : ""}
                        </div>
                        <p class="small">${escapeHtml(`${formatHHmm(block.start_at)} - ${formatHHmm(block.end_at)}`)}</p>
                        <p class="small">planned ${Math.max(1, Number(block.planned_pomodoros || 0))} pomodoros</p>
                      </article>
                    `;
                  })
                  .join("")
          }
        </div>
      </aside>

      <section class="now-main-pane">
        <p class="now-mode-label">${escapeHtml(phaseLabel)} MODE</p>
        <div class="now-ring" style="--now-progress:${phaseProgress}%;">
          <div class="now-ring-core">
            <p class="now-ring-time">${toTimerText(displayRemainingSeconds)}</p>
            <p class="now-ring-caption">${escapeHtml(objectiveTitle)}</p>
          </div>
        </div>
        <div class="now-controls">
          <button
            id="now-left-action"
            class="now-control now-control--secondary"
            data-now-action="${controls.leftAction}"
            aria-label="${controls.leftLabel}"
            title="${controls.leftLabel}"
            ${controls.leftDisabled ? "disabled" : ""}
          ><span class="now-control-icon" aria-hidden="true">${controls.leftIcon}</span><span class="now-visually-hidden">${controls.leftLabel}</span></button>
          <button
            id="now-primary-action"
            class="now-control now-control--primary"
            data-now-action="${controls.primaryAction}"
            aria-label="${controls.primaryLabel}"
            title="${controls.primaryLabel}"
            ${controls.primaryDisabled ? "disabled" : ""}
          ><span class="now-control-icon" aria-hidden="true">${controls.primaryIcon}</span><span class="now-visually-hidden">${controls.primaryLabel}</span></button>
          <button
            id="now-right-action"
            class="now-control now-control--secondary"
            data-now-action="${controls.rightAction}"
            aria-label="${controls.rightLabel}"
            title="${controls.rightLabel}"
            ${controls.rightDisabled ? "disabled" : ""}
          ><span class="now-control-icon" aria-hidden="true">${controls.rightIcon}</span><span class="now-visually-hidden">${controls.rightLabel}</span></button>
        </div>
        <section class="now-objective-card">
          <div class="row spread">
            <h3>Current Objective</h3>
            <span class="pill">Step ${currentStep} of ${totalSteps}</span>
          </div>
          <p>${escapeHtml(objectiveTitle)}</p>
          <p class="small">Block: ${escapeHtml(objectiveBlockId)}</p>
          ${
            state.phase === "idle" && autoStartBlock
              ? `<p class="small">Start target: ${escapeHtml(blockTitle(autoStartBlock) || autoStartBlock.id)}${
                  autoStartTask ? ` / task: ${escapeHtml(autoStartTask.title)}` : ""
                }</p>`
              : ""
          }
        </section>
      </section>

      <aside class="now-right-rail">
        <header class="row spread">
          <h3>Next Steps</h3>
          <span class="small">${openTasks.length} open</span>
        </header>
        <div class="now-task-list">
          ${
            openTasks.length === 0
              ? '<p class="small now-empty">未完了タスクがありません。</p>'
              : openTasks
                  .map((task, index) => {
                    const upDisabled = index === 0;
                    const downDisabled = index === openTasks.length - 1;
                    return `
                      <article class="now-task-item ${task.status === "in_progress" ? "is-active" : ""}">
                        <div>
                          <p class="now-task-title">${escapeHtml(task.title || "(untitled)")}</p>
                          <p class="small">${escapeHtml(task.status)}${Number.isFinite(task.estimated_pomodoros) ? ` / est ${task.estimated_pomodoros}` : ""}</p>
                        </div>
                        <div class="now-task-actions">
                          <button class="btn-secondary now-order-btn" data-now-task-move="${escapeHtml(task.id)}" data-now-task-dir="up" ${
                            upDisabled ? "disabled" : ""
                          }>↑</button>
                          <button class="btn-secondary now-order-btn" data-now-task-move="${escapeHtml(task.id)}" data-now-task-dir="down" ${
                            downDisabled ? "disabled" : ""
                          }>↓</button>
                          <button class="btn-primary now-complete-btn" data-now-task-complete="${escapeHtml(task.id)}">Done</button>
                        </div>
                      </article>
                    `;
                  })
                  .join("")
          }
        </div>
      </aside>
    </section>
    <section class="now-bottom-bar">
      <div class="now-bottom-item"><span>Buffer Available</span><strong>${bufferMinutes}m</strong></div>
      <div class="now-bottom-item"><span>Deferred Tasks</span><strong>${deferredCount}</strong></div>
      ${
        focusCompletion === null
          ? ""
          : `<div class="now-bottom-item"><span>Focus Completion</span><strong>${focusCompletion}%</strong></div>`
      }
    </section>
  `;

  ["now-left-action", "now-primary-action", "now-right-action"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", async (event) => {
      const action = /** @type {HTMLElement} */ (event.currentTarget)?.dataset.nowAction;
      await executeTimerAction(action || "", renderPomodoro);
    });
  });

  appRoot.querySelectorAll("[data-now-task-complete]").forEach((node) => {
    node.addEventListener("click", async () => {
      const taskId = /** @type {HTMLElement} */ (node).dataset.nowTaskComplete;
      if (!taskId) return;
      await runUiAction(async () => {
        await safeInvoke("update_task", { task_id: taskId, status: "completed" });
        uiState.tasks = await safeInvoke("list_tasks");
        syncNowTaskOrder(uiState.tasks);
        renderPomodoro();
      });
    });
  });

  appRoot.querySelectorAll("[data-now-task-move]").forEach((node) => {
    node.addEventListener("click", () => {
      const element = /** @type {HTMLElement} */ (node);
      const taskId = element.dataset.nowTaskMove;
      const direction = element.dataset.nowTaskDir;
      if (!taskId || (direction !== "up" && direction !== "down")) return;
      const visibleIds = getNowOrderedTasks().map((task) => task.id);
      const visibleIndex = visibleIds.indexOf(taskId);
      if (visibleIndex < 0) return;
      const swapVisibleIndex = direction === "up" ? visibleIndex - 1 : visibleIndex + 1;
      if (swapVisibleIndex < 0 || swapVisibleIndex >= visibleIds.length) return;
      const swapId = visibleIds[swapVisibleIndex];
      const nextOrder = [...uiState.nowUi.taskOrder];
      const sourceIndex = nextOrder.indexOf(taskId);
      const targetIndex = nextOrder.indexOf(swapId);
      if (sourceIndex < 0 || targetIndex < 0) return;
      [nextOrder[sourceIndex], nextOrder[targetIndex]] = [nextOrder[targetIndex], nextOrder[sourceIndex]];
      uiState.nowUi.taskOrder = nextOrder;
      renderPomodoro();
    });
  });
}

function renderRoutines() {
  const recipes = Array.isArray(uiState.recipes) ? uiState.recipes : [];
  if (!uiState.routineStudio || typeof uiState.routineStudio !== "object") {
    uiState.routineStudio = {};
  }
  const studio = uiState.routineStudio;
  const safeStepTypes = new Set(["micro", "pomodoro", "free"]);
  const safeOverrunPolicies = new Set(["wait", "notify_and_next"]);
  const normalizeStepType = (value) => {
    const candidate = String(value || "micro").trim().toLowerCase();
    return safeStepTypes.has(candidate) ? candidate : "micro";
  };
  const normalizeOverrunPolicy = (value) => {
    const candidate = String(value || "wait").trim().toLowerCase();
    return safeOverrunPolicies.has(candidate) ? candidate : "wait";
  };
  const normalizeExecutionHints = (value) => ({
    allowSkip: Boolean(value?.allowSkip ?? value?.allow_skip ?? true),
    mustCompleteChecklist: Boolean(
      value?.mustCompleteChecklist ?? value?.must_complete_checklist ?? false
    ),
    autoAdvance: Boolean(value?.autoAdvance ?? value?.auto_advance ?? true),
  });
  const normalizePomodoro = (value, fallbackMinutes = 25) => ({
    focusSeconds: Math.max(
      60,
      Number(value?.focusSeconds || value?.focus_seconds || Math.max(60, Math.round(fallbackMinutes * 60)))
    ),
    breakSeconds: Math.max(60, Number(value?.breakSeconds || value?.break_seconds || 300)),
    cycles: Math.max(1, Number(value?.cycles || 1)),
    longBreakSeconds: Math.max(0, Number(value?.longBreakSeconds || value?.long_break_seconds || 0)),
    longBreakEvery: Math.max(0, Number(value?.longBreakEvery || value?.long_break_every || 0)),
  });

  studio.assetsLoaded = Boolean(studio.assetsLoaded);
  studio.assetsLoading = Boolean(studio.assetsLoading);
  studio.activeTab = studio.activeTab === "templates" ? "templates" : "modules";
  studio.search = typeof studio.search === "string" ? studio.search : "";
  studio.draftName =
    typeof studio.draftName === "string" && studio.draftName.trim() ? studio.draftName : "Routine Draft";
  studio.templateId =
    typeof studio.templateId === "string" && studio.templateId.trim()
      ? studio.templateId
      : `rcp-${routineStudioSlug(studio.draftName) || "routine-studio"}`;
  studio.triggerTime =
    typeof studio.triggerTime === "string" && /^\d{2}:\d{2}$/.test(studio.triggerTime) ? studio.triggerTime : "09:00";
  studio.context =
    typeof studio.context === "string" && studio.context.trim() ? studio.context : routineStudioContexts[0];
  studio.autoStart = Boolean(studio.autoStart);
  studio.macroTargetMinutes = Number.isFinite(Number(studio.macroTargetMinutes))
    ? Number(studio.macroTargetMinutes)
    : 30;
  studio.modules = Array.isArray(studio.modules) ? studio.modules : [];
  studio.canvasEntries = Array.isArray(studio.canvasEntries) ? studio.canvasEntries : [];
  studio.history = Array.isArray(studio.history) ? studio.history : [];
  studio.historyIndex = Number.isInteger(studio.historyIndex) ? studio.historyIndex : -1;
  studio.dragInsertIndex = Number.isInteger(studio.dragInsertIndex) ? studio.dragInsertIndex : -1;
  studio.selectedEntryId = typeof studio.selectedEntryId === "string" ? studio.selectedEntryId : "";
  studio.hiddenTemplateCount = Number.isFinite(Number(studio.hiddenTemplateCount))
    ? Number(studio.hiddenTemplateCount)
    : 0;
  studio.lastApplyResult = typeof studio.lastApplyResult === "string" ? studio.lastApplyResult : "";
  studio.moduleEditor = studio.moduleEditor && typeof studio.moduleEditor === "object" ? studio.moduleEditor : null;
  studio.editingModuleId = typeof studio.editingModuleId === "string" ? studio.editingModuleId : "";

  const normalizeModule = (module, index) => {
    const id = String(module?.id || `mod-${index + 1}`).trim() || `mod-${index + 1}`;
    const pomodoro = module?.pomodoro && typeof module.pomodoro === "object" ? module.pomodoro : null;
    const executionHints =
      module?.executionHints && typeof module.executionHints === "object"
        ? module.executionHints
        : module?.execution_hints && typeof module.execution_hints === "object"
      ? module.execution_hints
      : null;
    const stepType = normalizeStepType(module?.stepType || module?.step_type || "micro");
    const durationMinutes = Math.max(1, Number(module?.durationMinutes || module?.duration_minutes || 1));
    return {
      id,
      name: String(module?.name || id),
      category: String(module?.category || "General"),
      description: String(module?.description || ""),
      icon: String(module?.icon || "module"),
      durationMinutes,
      stepType,
      checklist: Array.isArray(module?.checklist) ? module.checklist.map(String).filter(Boolean) : [],
      overrunPolicy: normalizeOverrunPolicy(module?.overrunPolicy || module?.overrun_policy || "wait"),
      pomodoro: stepType === "pomodoro" ? normalizePomodoro(pomodoro, durationMinutes) : null,
      executionHints: normalizeExecutionHints(executionHints),
    };
  };
  const normalizeEntry = (entry, index) => {
    const stepType = normalizeStepType(entry?.stepType || entry?.step_type || entry?.type || "micro");
    const durationMinutes = Math.max(
      1,
      Number(entry?.durationMinutes || entry?.duration_minutes || 5)
    );
    return {
      entryId: String(entry?.entryId || nextRoutineStudioEntryId()),
      sourceKind: String(entry?.sourceKind || entry?.source_kind || "module"),
      sourceId: String(entry?.sourceId || entry?.source_id || ""),
      moduleId: String(entry?.moduleId || entry?.module_id || ""),
      title: String(entry?.title || `Step ${index + 1}`),
      subtitle: String(entry?.subtitle || ""),
      durationMinutes,
      stepType,
      checklist: Array.isArray(entry?.checklist) ? entry.checklist.map(String).filter(Boolean) : [],
      note: String(entry?.note || ""),
      overrunPolicy: normalizeOverrunPolicy(entry?.overrunPolicy || entry?.overrun_policy || "wait"),
      executionHints: normalizeExecutionHints(entry?.executionHints || entry?.execution_hints),
      pomodoro: stepType === "pomodoro" ? normalizePomodoro(entry?.pomodoro, durationMinutes) : null,
    };
  };
  const parseChecklistText = (value) =>
    String(value || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  const normalizeModuleEditor = (editor) => {
    const stepType = normalizeStepType(editor?.stepType || editor?.step_type || "micro");
    return {
      id: String(editor?.id || ""),
      name: String(editor?.name || ""),
      category: String(editor?.category || "General"),
      description: String(editor?.description || ""),
      icon: String(editor?.icon || "module"),
      durationMinutes: Math.max(1, Number(editor?.durationMinutes || editor?.duration_minutes || 5)),
      stepType,
      overrunPolicy: normalizeOverrunPolicy(editor?.overrunPolicy || editor?.overrun_policy || "wait"),
      checklistText: String(editor?.checklistText || ""),
      executionHints: normalizeExecutionHints(editor?.executionHints || editor?.execution_hints),
      pomodoro: normalizePomodoro(editor?.pomodoro, Number(editor?.durationMinutes || 25)),
    };
  };
  const createEmptyModuleEditor = () =>
    normalizeModuleEditor({
      id: "",
      name: "",
      category: "General",
      description: "",
      icon: "module",
      durationMinutes: 5,
      stepType: "micro",
      overrunPolicy: "wait",
      checklistText: "",
      executionHints: { allowSkip: true, mustCompleteChecklist: false, autoAdvance: true },
      pomodoro: normalizePomodoro(null, 25),
    });
  studio.modules = studio.modules.map(normalizeModule);
  studio.canvasEntries = studio.canvasEntries.map((entry, index) => normalizeEntry(entry, index));
  studio.moduleEditor = studio.moduleEditor ? normalizeModuleEditor(studio.moduleEditor) : null;

  if (!studio.assetsLoaded) {
    appRoot.innerHTML = `
      <section class="routine-studio-root">
        <header class="routine-studio-toolbar">
          <div>
            <h2>Routine Studio</h2>
            <p>モジュールとテンプレートを読み込み中...</p>
          </div>
        </header>
      </section>
    `;
    if (!studio.assetsLoading) {
      studio.assetsLoading = true;
      runUiAction(async () => {
        const [recipesResult, modulesResult] = await Promise.all([
          safeInvoke("list_recipes", {}),
          safeInvoke("list_modules", {}).catch(() => cloneValue(routineStudioSeedModules)),
        ]);
        uiState.recipes = Array.isArray(recipesResult) ? recipesResult : [];
        studio.modules = Array.isArray(modulesResult) ? modulesResult.map(normalizeModule) : [];
        studio.assetsLoaded = true;
        studio.assetsLoading = false;
        renderRoutines();
      });
    }
    return;
  }

  const moduleToEntry = (module) =>
    normalizeEntry({
      entryId: nextRoutineStudioEntryId(),
      sourceKind: "module",
      sourceId: module.id,
      moduleId: module.id,
      title: module.name,
      subtitle: module.description || module.category || "Module",
      durationMinutes: Math.max(1, Number(module.durationMinutes) || 5),
      stepType: module.stepType || "micro",
      checklist: Array.isArray(module.checklist) ? module.checklist.map(String).filter(Boolean) : [],
      note: "",
      overrunPolicy: module.overrunPolicy || "wait",
      executionHints: normalizeExecutionHints(module.executionHints),
      pomodoro: module.stepType === "pomodoro" ? normalizePomodoro(module.pomodoro, module.durationMinutes) : null,
    });
  const recipeToEntries = (recipe) => {
    const steps = Array.isArray(recipe?.steps) ? recipe.steps : [];
    const autoDriveMode = String(recipe?.auto_drive_mode || recipe?.autoDriveMode || "manual");
    if (steps.length === 0) {
      return [
        {
          entryId: nextRoutineStudioEntryId(),
          sourceKind: "template",
          sourceId: recipe?.id || "",
          moduleId: "",
          title: recipe?.name || recipe?.id || "Template Step",
          subtitle: "Imported template",
          durationMinutes: 5,
          stepType: "micro",
          checklist: [],
          note: "",
          overrunPolicy: "wait",
          executionHints: { allowSkip: true, mustCompleteChecklist: false, autoAdvance: true },
          pomodoro: null,
          autoDriveMode,
        },
      ];
    }
    return steps.map((step, index) => {
      const stepType = String(step?.type || step?.step_type || "micro");
      const pomodoro = step?.pomodoro || {};
      const executionHints = step?.executionHints || step?.execution_hints || {};
      return normalizeEntry({
        entryId: nextRoutineStudioEntryId(),
        sourceKind: "template",
        sourceId: recipe?.id || "",
        moduleId: String(step?.moduleId || step?.module_id || ""),
        title: String(step?.title || `Step ${index + 1}`),
        subtitle: recipe?.name || recipe?.id || "Template",
        durationMinutes: routineStudioStepDurationMinutes(step),
        stepType,
        checklist: Array.isArray(step?.checklist)
          ? step.checklist.map(String).filter(Boolean)
          : [],
        note: String(step?.note || ""),
        overrunPolicy: String(step?.overrunPolicy || step?.overrun_policy || "wait"),
        executionHints: normalizeExecutionHints(executionHints),
        pomodoro: stepType === "pomodoro" ? normalizePomodoro(pomodoro, routineStudioStepDurationMinutes(step)) : null,
        autoDriveMode,
      });
    });
  };
  const syncFromRecipe = (recipe) => {
    if (!recipe) return;
    const autoDriveMode = String(recipe.auto_drive_mode || recipe.autoDriveMode || "manual");
    studio.templateId = String(recipe.id || studio.templateId);
    studio.draftName = String(recipe.name || recipe.id || studio.draftName);
    studio.autoStart = autoDriveMode !== "manual";
  };
  if (!studio.bootstrapped) {
    const studioRecipes = recipes.filter((recipe) => isRoutineStudioRecipe(recipe));
    if (studioRecipes.length > 0) {
      syncFromRecipe(studioRecipes[0]);
      studio.canvasEntries = recipeToEntries(studioRecipes[0]);
    } else {
      studio.canvasEntries = studio.modules.slice(0, 3).map(moduleToEntry);
    }
    studio.bootstrapped = true;
    studio.history = [cloneValue(studio.canvasEntries)];
    studio.historyIndex = 0;
    studio.selectedEntryId = studio.canvasEntries[0]?.entryId || "";
  }
  if (studio.history.length === 0) {
    studio.history = [cloneValue(studio.canvasEntries)];
    studio.historyIndex = 0;
  }
  if (studio.historyIndex < 0 || studio.historyIndex >= studio.history.length) {
    studio.historyIndex = studio.history.length - 1;
  }
  if (!studio.selectedEntryId && studio.canvasEntries.length > 0) {
    studio.selectedEntryId = studio.canvasEntries[0].entryId;
  }
  const addAssetToCanvas = (kind, id, replace = false, insertIndex = studio.canvasEntries.length) => {
    if (!id) return false;
    const clampedInsertIndex = Math.max(
      0,
      Math.min(Number(insertIndex) || 0, studio.canvasEntries.length)
    );
    if (kind === "module") {
      const module = studio.modules.find((candidate) => candidate.id === id);
      if (!module) return false;
      const next = moduleToEntry(module);
      if (replace) {
        applyCanvasEntries([next], true);
      } else {
        const nextEntries = [...studio.canvasEntries];
        nextEntries.splice(clampedInsertIndex, 0, next);
        applyCanvasEntries(nextEntries, true);
      }
      studio.selectedEntryId = next.entryId;
      return true;
    }
    if (kind === "template") {
      const recipe = recipes.find((candidate) => candidate.id === id && isRoutineStudioRecipe(candidate));
      if (!recipe) return false;
      const entries = recipeToEntries(recipe);
      if (replace) {
        applyCanvasEntries(entries, true);
      } else {
        const nextEntries = [...studio.canvasEntries];
        nextEntries.splice(clampedInsertIndex, 0, ...entries);
        applyCanvasEntries(nextEntries, true);
      }
      syncFromRecipe(recipe);
      studio.selectedEntryId = entries[0]?.entryId || studio.selectedEntryId;
      return true;
    }
    return false;
  };
  const pushHistory = () => {
    const snapshot = cloneValue(studio.canvasEntries.map((entry, index) => normalizeEntry(entry, index)));
    const current =
      studio.historyIndex >= 0 && studio.historyIndex < studio.history.length
        ? studio.history[studio.historyIndex]
        : null;
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
  };
  const applyCanvasEntries = (nextEntries, recordHistory = true) => {
    studio.canvasEntries = (Array.isArray(nextEntries) ? nextEntries : []).map((entry, index) =>
      normalizeEntry(entry, index)
    );
    if (studio.canvasEntries.length > 0 && !studio.selectedEntryId) {
      studio.selectedEntryId = studio.canvasEntries[0].entryId;
    }
    if (
      studio.selectedEntryId &&
      studio.canvasEntries.every((entry) => entry.entryId !== studio.selectedEntryId)
    ) {
      studio.selectedEntryId = studio.canvasEntries[0]?.entryId || "";
    }
    if (recordHistory) {
      pushHistory();
    }
  };

  const searchNeedle = studio.search.trim().toLowerCase();
  const moduleAssets = studio.modules.filter((module) => {
    if (!searchNeedle) return true;
    return `${module.name} ${module.description} ${module.category}`.toLowerCase().includes(searchNeedle);
  });
  const allStudioRecipes = recipes.filter((recipe) => isRoutineStudioRecipe(recipe));
  studio.hiddenTemplateCount = Math.max(0, recipes.length - allStudioRecipes.length);
  const templateAssets = allStudioRecipes
    .map((recipe) => {
      const steps = Array.isArray(recipe?.steps) ? recipe.steps : [];
      const totalMinutes = steps.reduce((sum, step) => sum + routineStudioStepDurationMinutes(step), 0);
      return {
        id: String(recipe.id || ""),
        name: String(recipe.name || recipe.id || "Untitled"),
        autoDriveMode: String(recipe.auto_drive_mode || recipe.autoDriveMode || "manual"),
        stepCount: steps.length,
        totalMinutes,
      };
    })
    .filter((template) => {
      if (!searchNeedle) return true;
      return `${template.id} ${template.name} ${template.autoDriveMode}`.toLowerCase().includes(searchNeedle);
    });
  const totalMinutes = studio.canvasEntries.reduce((sum, entry) => sum + (Number(entry.durationMinutes) || 0), 0);
  const targetMinutes = Math.max(15, Number(studio.macroTargetMinutes) || 30);
  const fitPercent = Math.min(100, Math.round((totalMinutes / targetMinutes) * 100));
  const macroFits = totalMinutes > 0 && totalMinutes <= targetMinutes;
  const macroMessage =
    totalMinutes === 0
      ? "キャンバスが空です。"
      : macroFits
      ? `${targetMinutes}分の枠に収まります。`
      : `目標（${targetMinutes}分）を${totalMinutes - targetMinutes}分オーバーしています。`;
  const dateKey = uiState.dashboardDate || isoDate(new Date());
  const triggerStart = new Date(`${dateKey}T${studio.triggerTime || "09:00"}:00`);
  const triggerStartMs = triggerStart.getTime();
  const triggerEndMs = triggerStartMs + totalMinutes * 60000;
  const overlaps = (leftStart, leftEnd, rightStart, rightEnd) => leftStart < rightEnd && rightStart < leftEnd;
  const conflictItems = [];
  if (totalMinutes > 0 && Number.isFinite(triggerStartMs) && Number.isFinite(triggerEndMs)) {
    uiState.blocks
      .filter((block) => String(block?.date || "") === dateKey)
      .forEach((block) => {
        const startMs = new Date(block.start_at).getTime();
        const endMs = new Date(block.end_at).getTime();
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
        if (!overlaps(triggerStartMs, triggerEndMs, startMs, endMs)) return;
        conflictItems.push({
          kind: "block",
          title: blockTitle(block) || "Scheduled Block",
          startMs,
          endMs,
        });
      });
    uiState.calendarEvents.forEach((event) => {
      const startMs = new Date(event.start_at).getTime();
      const endMs = new Date(event.end_at).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
      if (!overlaps(triggerStartMs, triggerEndMs, startMs, endMs)) return;
      conflictItems.push({
        kind: "event",
        title: String(event.title || "Calendar Event"),
        startMs,
        endMs,
      });
    });
    conflictItems.sort((left, right) => left.startMs - right.startMs);
  }
  const conflictCount = conflictItems.length;
  const conflictMessage =
    totalMinutes <= 0
      ? "モジュールを追加すると競合チェックできます。"
      : conflictCount === 0
      ? "競合するスケジュールはありません。"
      : `${conflictCount}件の競合が検出されました。`;

  appRoot.innerHTML = `
    <section class="routine-studio-root">
      <header class="routine-studio-toolbar">
        <div>
          <h2>Routine Studio</h2>
          <p>部品（モジュール）を選んで、組み立てる（キャンバス）、保存する（テンプレート）。</p>
        </div>
        <div class="rs-toolbar-actions">
          <button type="button" id="studio-refresh-recipes" class="rs-btn rs-btn-secondary">アセット更新</button>
          <button type="button" id="studio-new-module" class="rs-btn rs-btn-secondary">モジュールを追加</button>
        </div>
      </header>
      <div class="routine-studio-layout">
        <aside class="rs-library">
          <div class="rs-tabs">
            <button type="button" class="rs-tab ${studio.activeTab === "modules" ? "is-active" : ""}" data-studio-tab="modules">モジュール</button>
            <button type="button" class="rs-tab ${studio.activeTab === "templates" ? "is-active" : ""}" data-studio-tab="templates">テンプレート</button>
          </div>
          <div class="rs-search-wrap">
            <input id="studio-search-input" type="search" placeholder="アセットを検索..." value="${escapeHtml(studio.search)}" />
            ${
              studio.activeTab === "templates" && studio.hiddenTemplateCount > 0
                ? `<p class="small rs-legacy-note">${studio.hiddenTemplateCount}件の旧テンプレートが非表示です。</p>`
                : ""
            }
          </div>
          <div class="rs-assets">
            ${
              studio.activeTab === "modules"
                ? (() => {
                    const grouped = moduleAssets.reduce((accumulator, module) => {
                      const category = String(module.category || "General");
                      if (!accumulator[category]) accumulator[category] = [];
                      accumulator[category].push(module);
                      return accumulator;
                    }, {});
                    const categories = Object.keys(grouped).sort((left, right) => left.localeCompare(right));
                    if (categories.length === 0) {
                      return '<p class="small">モジュールが見つかりません。</p>';
                    }
                    return categories
                      .map(
                        (category) => `
                        <section class="rs-asset-group">
                          <h4 class="rs-asset-group-title">${escapeHtml(category)}</h4>
                          ${grouped[category]
                            .map(
                              (module) => `
                            <article class="rs-asset-card" draggable="true" data-studio-draggable="true" data-studio-asset-kind="module" data-studio-asset-id="${escapeHtml(module.id)}">
                              <div class="rs-asset-head">
                                <p class="rs-asset-title">${escapeHtml(module.name)}</p>
                                <span class="rs-asset-duration">${module.durationMinutes}m</span>
                              </div>
                              <p class="rs-asset-subtitle">${escapeHtml(module.description || "")}</p>
                              <div class="rs-asset-actions">
                                <button type="button" class="rs-btn rs-btn-secondary" data-studio-insert-kind="module" data-studio-insert-id="${escapeHtml(module.id)}">追加</button>
                                <button type="button" class="rs-icon-btn" title="編集" data-studio-module-edit="${escapeHtml(module.id)}">&#9998;</button>
                                <button type="button" class="rs-icon-btn is-danger" title="削除" data-studio-module-delete="${escapeHtml(module.id)}">&#10005;</button>
                              </div>
                            </article>
                          `
                            )
                            .join("")}
                        </section>
                      `
                      )
                      .join("");
                  })()
                : templateAssets
                    .map(
                      (template) => `
                <article class="rs-asset-card" draggable="true" data-studio-draggable="true" data-studio-asset-kind="template" data-studio-asset-id="${escapeHtml(template.id)}">
                  <div class="rs-asset-head">
                    <p class="rs-asset-title">${escapeHtml(template.name)}</p>
                    <span class="rs-asset-duration">${template.totalMinutes}m</span>
                  </div>
                  <p class="rs-asset-subtitle">${template.stepCount} ステップ • ${escapeHtml(template.autoDriveMode)}</p>
                  <div class="rs-asset-actions">
                    <button type="button" class="rs-btn rs-btn-secondary" data-studio-insert-kind="template" data-studio-insert-id="${escapeHtml(template.id)}">挿入</button>
                    <button type="button" class="rs-btn rs-btn-ghost" data-studio-load-template="${escapeHtml(template.id)}">読込</button>
                  </div>
                </article>
              `
                    )
                    .join("")
            }
          </div>
        </aside>
        <section class="rs-canvas">
          <header class="rs-canvas-head">
            <div>
              <h3>ルーティンキャンバス</h3>
              <p>モジュールをドラッグして追加</p>
            </div>
            <div class="rs-history-actions">
              <button type="button" id="studio-undo" class="rs-btn rs-btn-ghost" ${studio.historyIndex <= 0 ? "disabled" : ""}>元に戻す</button>
              <button type="button" id="studio-redo" class="rs-btn rs-btn-ghost" ${studio.historyIndex >= studio.history.length - 1 ? "disabled" : ""}>やり直す</button>
            </div>
          </header>
          <div class="rs-canvas-body">
            <div id="routine-studio-dropzone" class="rs-dropzone">
              ${
                studio.canvasEntries.length === 0
                  ? '<div class="rs-drop-empty"><p class="rs-drop-empty-title">モジュールをドラッグ</p><p class="small">追加ボタンからも追加できます</p></div>'
                  : studio.canvasEntries
                      .map(
                        (entry, index) => `
                  <article class="rs-canvas-card ${studio.selectedEntryId === entry.entryId ? "is-selected" : ""}" data-studio-entry-id="${escapeHtml(entry.entryId)}" draggable="true" data-studio-canvas-entry="${escapeHtml(entry.entryId)}">
                    <header class="rs-canvas-card-head">
                      <span class="rs-drag-handle" aria-hidden="true" title="ドラッグして並び順を変更">&#x2807;</span>
                      <button type="button" class="rs-canvas-index" data-studio-select-entry="${escapeHtml(entry.entryId)}">${index + 1}</button>
                      <div class="rs-canvas-meta">
                        <p class="rs-canvas-title">${escapeHtml(entry.title || `Step ${index + 1}`)}</p>
                        <p class="rs-canvas-subtitle">${escapeHtml(entry.subtitle || "")}</p>
                      </div>
                      <span class="rs-canvas-duration">${Math.max(1, Number(entry.durationMinutes) || 0)}m</span>
                      <div class="rs-canvas-actions">
                        <button type="button" class="rs-icon-btn" data-studio-move="${escapeHtml(entry.entryId)}" data-studio-dir="up" ${index === 0 ? "disabled" : ""}>↑</button>
                        <button type="button" class="rs-icon-btn" data-studio-move="${escapeHtml(entry.entryId)}" data-studio-dir="down" ${index === studio.canvasEntries.length - 1 ? "disabled" : ""}>↓</button>
                        <button type="button" class="rs-icon-btn is-danger" data-studio-remove="${escapeHtml(entry.entryId)}">×</button>
                      </div>
                    </header>
                    <details class="rs-canvas-details" ${studio.selectedEntryId === entry.entryId ? "open" : ""}>
                      <summary>詳細設定</summary>
                      <div class="rs-entry-grid">
                        <label class="rs-field">タイトル<input data-studio-entry-field="title" data-studio-entry-id="${escapeHtml(entry.entryId)}" value="${escapeHtml(entry.title)}" /></label>
                        <label class="rs-field">分<input data-studio-entry-field="durationMinutes" data-studio-entry-id="${escapeHtml(entry.entryId)}" type="number" min="1" value="${Math.max(1, Number(entry.durationMinutes) || 1)}" /></label>
                        <label class="rs-field">タイプ
                          <select data-studio-entry-field="stepType" data-studio-entry-id="${escapeHtml(entry.entryId)}">
                            <option value="micro" ${entry.stepType === "micro" ? "selected" : ""}>micro</option>
                            <option value="pomodoro" ${entry.stepType === "pomodoro" ? "selected" : ""}>pomodoro</option>
                            <option value="free" ${entry.stepType === "free" ? "selected" : ""}>free</option>
                          </select>
                        </label>
                        <label class="rs-field">モジュール
                          <select data-studio-entry-field="moduleId" data-studio-entry-id="${escapeHtml(entry.entryId)}">
                            <option value="">なし</option>
                            ${studio.modules
                              .map(
                                (module) =>
                                  `<option value="${escapeHtml(module.id)}" ${module.id === entry.moduleId ? "selected" : ""}>${escapeHtml(module.name)}</option>`
                              )
                              .join("")}
                          </select>
                        </label>
                        <label class="rs-field">超過時
                          <select data-studio-entry-field="overrunPolicy" data-studio-entry-id="${escapeHtml(entry.entryId)}">
                            <option value="wait" ${entry.overrunPolicy === "wait" ? "selected" : ""}>wait</option>
                            <option value="notify_and_next" ${entry.overrunPolicy === "notify_and_next" ? "selected" : ""}>notify_and_next</option>
                          </select>
                        </label>
                        <label class="rs-field rs-field-full">チェックリスト
                          <textarea class="rs-textarea" data-studio-entry-field="checklist" data-studio-entry-id="${escapeHtml(entry.entryId)}">${escapeHtml((entry.checklist || []).join("\n"))}</textarea>
                        </label>
                        <label class="rs-field rs-field-full">ノート
                          <textarea class="rs-textarea" data-studio-entry-field="note" data-studio-entry-id="${escapeHtml(entry.entryId)}">${escapeHtml(entry.note || "")}</textarea>
                        </label>
                        <fieldset class="rs-entry-checks rs-field-full">
                          <legend>実行ヒント</legend>
                          <label><input type="checkbox" data-studio-entry-hint="allowSkip" data-studio-entry-id="${escapeHtml(entry.entryId)}" ${entry.executionHints?.allowSkip ? "checked" : ""} />スキップ可</label>
                          <label><input type="checkbox" data-studio-entry-hint="mustCompleteChecklist" data-studio-entry-id="${escapeHtml(entry.entryId)}" ${entry.executionHints?.mustCompleteChecklist ? "checked" : ""} />完了必須</label>
                          <label><input type="checkbox" data-studio-entry-hint="autoAdvance" data-studio-entry-id="${escapeHtml(entry.entryId)}" ${entry.executionHints?.autoAdvance ? "checked" : ""} />自動進行</label>
                        </fieldset>
                        ${
                          entry.stepType === "pomodoro"
                            ? `<div class="rs-inline-fields rs-field-full">
                                <label class="rs-field">集中(秒)<input type="number" min="60" data-studio-entry-pomodoro="focusSeconds" data-studio-entry-id="${escapeHtml(entry.entryId)}" value="${Math.max(60, Number(entry.pomodoro?.focusSeconds) || 1500)}" /></label>
                                <label class="rs-field">休憩(秒)<input type="number" min="60" data-studio-entry-pomodoro="breakSeconds" data-studio-entry-id="${escapeHtml(entry.entryId)}" value="${Math.max(60, Number(entry.pomodoro?.breakSeconds) || 300)}" /></label>
                                <label class="rs-field">サイクル<input type="number" min="1" data-studio-entry-pomodoro="cycles" data-studio-entry-id="${escapeHtml(entry.entryId)}" value="${Math.max(1, Number(entry.pomodoro?.cycles) || 1)}" /></label>
                                <label class="rs-field">長休憩(秒)<input type="number" min="0" data-studio-entry-pomodoro="longBreakSeconds" data-studio-entry-id="${escapeHtml(entry.entryId)}" value="${Math.max(0, Number(entry.pomodoro?.longBreakSeconds) || 0)}" /></label>
                                <label class="rs-field">頻度<input type="number" min="0" data-studio-entry-pomodoro="longBreakEvery" data-studio-entry-id="${escapeHtml(entry.entryId)}" value="${Math.max(0, Number(entry.pomodoro?.longBreakEvery) || 0)}" /></label>
                              </div>`
                            : ""
                        }
                      </div>
                    </details>
                  </article>
                `
                      )
                      .join('<div class="rs-canvas-connector" aria-hidden="true"></div>')
              }
            </div>
          </div>
        </section>
        <aside class="rs-intel">
          <header class="rs-intel-head">
            <h3 data-studio-title>${escapeHtml(studio.draftName)}</h3>
            <p class="small">編集済み</p>
            <div class="rs-total">${totalMinutes}<span> min</span></div>
            <div class="bar-track"><div class="bar-fill rs-total-fill" style="width:${fitPercent}%"></div></div>
          </header>
          <div class="rs-intel-body">
            <section class="rs-health">
              <h4>ルーティン診断</h4>
              <article class="rs-health-card ${macroFits ? "is-ok" : "is-warn"}"><p class="rs-health-title">時間フィット</p><p class="small">${escapeHtml(macroMessage)}</p></article>
              <article class="rs-health-card ${conflictCount === 0 ? "is-ok" : "is-warn"}">
                <p class="rs-health-title">スケジュール競合</p>
                <p class="small">${escapeHtml(conflictMessage)}</p>
                ${
                  conflictItems.length > 0
                    ? `<ul class="rs-conflict-list">${conflictItems
                        .slice(0, 4)
                        .map(
                          (item) =>
                            `<li>${escapeHtml(item.title)} (${formatHHmm(new Date(item.startMs).toISOString())}-${formatHHmm(new Date(item.endMs).toISOString())})</li>`
                        )
                        .join("")}</ul>`
                    : ""
                }
              </article>
            </section>
            <details class="rs-properties" open>
              <summary class="rs-properties-summary">プロパティ</summary>
              <label class="rs-field">テンプレートID<input id="studio-template-id" value="${escapeHtml(studio.templateId)}" /></label>
              <label class="rs-field">ルーティン名<input id="studio-draft-name" value="${escapeHtml(studio.draftName)}" /></label>
              <label class="rs-field">コンテキスト<select id="studio-context">${routineStudioContexts
                .map((context) => `<option value="${escapeHtml(context)}" ${context === studio.context ? "selected" : ""}>${escapeHtml(context)}</option>`)
                .join("")}</select></label>
              <label class="rs-field">開始時刻<input id="studio-trigger-time" type="time" value="${escapeHtml(studio.triggerTime)}" /></label>
              <label class="rs-field">目標時間<select id="studio-macro-target">${routineStudioMacroTargets
                .map((minutes) => `<option value="${minutes}" ${minutes === targetMinutes ? "selected" : ""}>${minutes} 分</option>`)
                .join("")}</select></label>
              <label class="rs-field rs-toggle" for="studio-auto-start"><span>次のモジュールを自動開始</span><input id="studio-auto-start" type="checkbox" ${studio.autoStart ? "checked" : ""} /></label>
              ${
                studio.lastApplyResult
                  ? `<p class="small rs-apply-status">${escapeHtml(studio.lastApplyResult)}</p>`
                  : ""
              }
            </details>
          </div>
          <footer class="rs-intel-actions">
            <button type="button" id="studio-save-template" class="rs-btn rs-btn-primary">テンプレートとして保存</button>
            <button type="button" id="studio-apply-today" class="rs-btn rs-btn-secondary">今日に適用</button>
            <button type="button" id="studio-delete-template" class="rs-btn rs-btn-ghost rs-danger-btn" ${studio.templateId ? "" : "disabled"}>テンプレートを削除</button>
            <button type="button" id="studio-clear-canvas" class="rs-btn rs-btn-ghost">キャンバスをリセット</button>
          </footer>
        </aside>
      </div>
      ${studio.moduleEditor ? `
        <div class="rs-modal-overlay" id="module-editor-overlay">
          <div class="rs-modal" role="dialog" aria-modal="true">
            <header class="rs-modal-head">
              <h4 class="rs-modal-title">${studio.editingModuleId ? "モジュールを編集" : "新規モジュール"}</h4>
            </header>
            <div class="rs-inline-fields">
              <label class="rs-field">ID<input id="studio-module-id" value="${escapeHtml(studio.moduleEditor.id)}" ${studio.editingModuleId ? "disabled" : ""} /></label>
              <label class="rs-field">名前<input id="studio-module-name" value="${escapeHtml(studio.moduleEditor.name)}" /></label>
            </div>
            <div class="rs-inline-fields">
              <label class="rs-field">カテゴリ<input id="studio-module-category" value="${escapeHtml(studio.moduleEditor.category)}" /></label>
              <label class="rs-field">分<input id="studio-module-duration" type="number" min="1" value="${Math.max(1, Number(studio.moduleEditor.durationMinutes) || 1)}" /></label>
              <label class="rs-field">タイプ
                <select id="studio-module-step-type">
                  <option value="micro" ${studio.moduleEditor.stepType === "micro" ? "selected" : ""}>micro</option>
                  <option value="pomodoro" ${studio.moduleEditor.stepType === "pomodoro" ? "selected" : ""}>pomodoro</option>
                  <option value="free" ${studio.moduleEditor.stepType === "free" ? "selected" : ""}>free</option>
                </select>
              </label>
            </div>
            <div class="rs-inline-fields">
              <label class="rs-field">超過時
                <select id="studio-module-overrun">
                  <option value="wait" ${studio.moduleEditor.overrunPolicy === "wait" ? "selected" : ""}>wait</option>
                  <option value="notify_and_next" ${studio.moduleEditor.overrunPolicy === "notify_and_next" ? "selected" : ""}>notify_and_next</option>
                </select>
              </label>
              <label class="rs-field">アイコン<input id="studio-module-icon" value="${escapeHtml(studio.moduleEditor.icon)}" /></label>
            </div>
            <label class="rs-field">説明<input id="studio-module-description" value="${escapeHtml(studio.moduleEditor.description)}" /></label>
            <label class="rs-field">チェックリスト<textarea id="studio-module-checklist" class="rs-textarea">${escapeHtml(studio.moduleEditor.checklistText)}</textarea></label>
            ${studio.moduleEditor.stepType === "pomodoro" ? `
              <div class="rs-inline-fields">
                <label class="rs-field">集中(秒)<input id="studio-module-focus" type="number" min="60" value="${Math.max(60, Number(studio.moduleEditor.pomodoro.focusSeconds) || 1500)}" /></label>
                <label class="rs-field">休憩(秒)<input id="studio-module-break" type="number" min="60" value="${Math.max(60, Number(studio.moduleEditor.pomodoro.breakSeconds) || 300)}" /></label>
                <label class="rs-field">サイクル<input id="studio-module-cycles" type="number" min="1" value="${Math.max(1, Number(studio.moduleEditor.pomodoro.cycles) || 1)}" /></label>
                <label class="rs-field">長休憩(秒)<input id="studio-module-long-break" type="number" min="0" value="${Math.max(0, Number(studio.moduleEditor.pomodoro.longBreakSeconds) || 0)}" /></label>
                <label class="rs-field">頻度<input id="studio-module-long-every" type="number" min="0" value="${Math.max(0, Number(studio.moduleEditor.pomodoro.longBreakEvery) || 0)}" /></label>
              </div>` : ""}
            <fieldset class="rs-entry-checks">
              <legend>実行ヒント</legend>
              <label><input id="studio-module-allow-skip" type="checkbox" ${studio.moduleEditor.executionHints.allowSkip ? "checked" : ""} />スキップ可</label>
              <label><input id="studio-module-must-checklist" type="checkbox" ${studio.moduleEditor.executionHints.mustCompleteChecklist ? "checked" : ""} />完了必須</label>
              <label><input id="studio-module-auto-advance" type="checkbox" ${studio.moduleEditor.executionHints.autoAdvance ? "checked" : ""} />自動進行</label>
            </fieldset>
            <div class="rs-modal-actions">
              <button type="button" id="studio-module-save" class="rs-btn rs-btn-primary">保存</button>
              <button type="button" id="studio-module-cancel" class="rs-btn rs-btn-ghost">キャンセル</button>
            </div>
          </div>
        </div>
      ` : ""}
    </section>
  `;

  const rerender = () => renderRoutines();
  const buildRecipePayload = () => {
    if (studio.canvasEntries.length === 0) {
      throw new Error("キャンバスが空です。モジュールを追加してください。");
    }
    const name = studio.draftName.trim() || "Routine Draft";
    const slugBase = routineStudioSlug(studio.templateId || name) || "routine-studio";
    const id = slugBase.startsWith("rcp-") ? slugBase : `rcp-${slugBase}`;
    studio.templateId = id;
    const steps = studio.canvasEntries.map((entry, index) => {
      const stepType = normalizeStepType(entry.stepType || "micro");
      const durationSeconds = Math.max(60, Math.round((Number(entry.durationMinutes) || 1) * 60));
      const step = {
        id: `step-${index + 1}`,
        type: stepType,
        title: String(entry.title || `Step ${index + 1}`),
        durationSeconds,
        overrunPolicy: normalizeOverrunPolicy(entry.overrunPolicy || "wait"),
        checklist: Array.isArray(entry.checklist) ? entry.checklist.map(String).filter(Boolean) : [],
        executionHints: normalizeExecutionHints(entry.executionHints),
      };
      const moduleId = String(entry.moduleId || "").trim();
      if (moduleId) {
        step.moduleId = moduleId;
      }
      const note = String(entry.note || "").trim();
      if (note) {
        step.note = note;
      }
      if (stepType === "pomodoro") {
        step.pomodoro = {
          focusSeconds: Math.max(60, Number(entry.pomodoro?.focusSeconds) || 1500),
          breakSeconds: Math.max(60, Number(entry.pomodoro?.breakSeconds) || 300),
          cycles: Math.max(1, Number(entry.pomodoro?.cycles) || 1),
          longBreakSeconds: Math.max(0, Number(entry.pomodoro?.longBreakSeconds) || 0),
          longBreakEvery: Math.max(0, Number(entry.pomodoro?.longBreakEvery) || 0),
        };
      }
      return step;
    });
    return {
      id,
      name,
      autoDriveMode: studio.autoStart ? "auto" : "manual",
      studioMeta: {
        version: 1,
        kind: "routine_studio",
      },
      steps,
    };
  };
  const persistTemplate = async () => {
    const payload = buildRecipePayload();
    const exists = recipes.some((recipe) => recipe.id === payload.id);
    if (exists) {
      await safeInvoke("update_recipe", { recipe_id: payload.id, payload });
    } else {
      await safeInvoke("create_recipe", { payload });
    }
    uiState.recipes = await safeInvoke("list_recipes", {});
    studio.templateId = payload.id;
    studio.draftName = payload.name;
    return payload.id;
  };
  const readField = (id) =>
    /** @type {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null} */ (
      document.getElementById(id)
    )?.value || "";
  const readChecked = (id) =>
    Boolean(/** @type {HTMLInputElement | null} */ (document.getElementById(id))?.checked);
  const openModuleEditor = (module) => {
    if (!module) {
      studio.editingModuleId = "";
      studio.moduleEditor = createEmptyModuleEditor();
      return;
    }
    studio.editingModuleId = module.id;
    studio.moduleEditor = normalizeModuleEditor({
      ...module,
      checklistText: (Array.isArray(module.checklist) ? module.checklist : []).join("\n"),
    });
  };
  const updateEntry = (entryId, updater) => {
    const index = studio.canvasEntries.findIndex((entry) => entry.entryId === entryId);
    if (index < 0) return false;
    const nextEntries = [...studio.canvasEntries];
    const draft = normalizeEntry(nextEntries[index], index);
    nextEntries[index] = normalizeEntry(updater(draft) || draft, index);
    applyCanvasEntries(nextEntries, true);
    studio.selectedEntryId = entryId;
    return true;
  };
  const resolveDropInsertIndex = (dropzone, clientY) => {
    const cards = Array.from(dropzone.querySelectorAll(".rs-canvas-card"));
    for (let index = 0; index < cards.length; index += 1) {
      const rect = /** @type {HTMLElement} */ (cards[index]).getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return index;
      }
    }
    return cards.length;
  };
  const clearDropIndicator = (dropzone) => {
    dropzone.classList.remove("is-over", "is-insert-end");
    dropzone.querySelectorAll(".is-insert-target").forEach((node) => node.classList.remove("is-insert-target"));
    studio.dragInsertIndex = -1;
  };
  const paintDropIndicator = (dropzone, insertIndex) => {
    clearDropIndicator(dropzone);
    const cards = Array.from(dropzone.querySelectorAll(".rs-canvas-card"));
    dropzone.classList.add("is-over");
    if (cards.length === 0) {
      // 空キャンバス: 末尾挿入として扱う
      studio.dragInsertIndex = 0;
      return;
    }
    if (insertIndex >= cards.length) {
      dropzone.classList.add("is-insert-end");
      studio.dragInsertIndex = cards.length;
      return;
    }
    if (insertIndex >= 0 && insertIndex < cards.length) {
      cards[insertIndex].classList.add("is-insert-target");
      studio.dragInsertIndex = insertIndex;
      return;
    }
    studio.dragInsertIndex = cards.length;
  };

  document.getElementById("studio-refresh-recipes")?.addEventListener("click", async () => {
    await runUiAction(async () => {
      const [recipesResult, modulesResult] = await Promise.all([
        safeInvoke("list_recipes", {}),
        safeInvoke("list_modules", {}).catch(() => cloneValue(routineStudioSeedModules)),
      ]);
      uiState.recipes = Array.isArray(recipesResult) ? recipesResult : [];
      studio.modules = Array.isArray(modulesResult) ? modulesResult.map(normalizeModule) : [];
      rerender();
    });
  });
  document.getElementById("studio-new-module")?.addEventListener("click", () => {
    studio.activeTab = "modules";
    openModuleEditor(null);
    rerender();
  });
  document.getElementById("studio-module-step-type")?.addEventListener("change", (event) => {
    if (!studio.moduleEditor) return;
    studio.moduleEditor = normalizeModuleEditor({
      ...studio.moduleEditor,
      stepType: /** @type {HTMLSelectElement} */ (event.currentTarget).value,
    });
    rerender();
  });
  document.getElementById("studio-module-cancel")?.addEventListener("click", () => {
    studio.moduleEditor = null;
    studio.editingModuleId = "";
    rerender();
  });
  document.getElementById("module-editor-overlay")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      studio.moduleEditor = null;
      studio.editingModuleId = "";
      rerender();
    }
  });
  document.getElementById("studio-module-save")?.addEventListener("click", async () => {
    await runUiAction(async () => {
      const moduleName = readField("studio-module-name").trim();
      const rawId = readField("studio-module-id").trim();
      const moduleId =
        studio.editingModuleId || rawId || `mod-${routineStudioSlug(moduleName || "module") || "module"}`;
      const stepType = normalizeStepType(readField("studio-module-step-type"));
      const payload = {
        id: moduleId,
        name: moduleName || moduleId,
        category: readField("studio-module-category").trim() || "General",
        description: readField("studio-module-description").trim(),
        icon: readField("studio-module-icon").trim() || "module",
        stepType,
        durationMinutes: Math.max(1, Number(readField("studio-module-duration") || "1")),
        checklist: parseChecklistText(readField("studio-module-checklist")),
        overrunPolicy: normalizeOverrunPolicy(readField("studio-module-overrun") || "wait"),
        executionHints: {
          allowSkip: readChecked("studio-module-allow-skip"),
          mustCompleteChecklist: readChecked("studio-module-must-checklist"),
          autoAdvance: readChecked("studio-module-auto-advance"),
        },
        pomodoro:
          stepType === "pomodoro"
            ? normalizePomodoro(
                {
                  focusSeconds: Number(readField("studio-module-focus") || "1500"),
                  breakSeconds: Number(readField("studio-module-break") || "300"),
                  cycles: Number(readField("studio-module-cycles") || "1"),
                  longBreakSeconds: Number(readField("studio-module-long-break") || "0"),
                  longBreakEvery: Number(readField("studio-module-long-every") || "0"),
                },
                Number(readField("studio-module-duration") || "25")
              )
            : null,
      };
      if (studio.editingModuleId) {
        await safeInvoke("update_module", { module_id: studio.editingModuleId, payload });
      } else {
        await safeInvoke("create_module", { payload });
      }
      const modulesResult = await safeInvoke("list_modules", {});
      studio.modules = Array.isArray(modulesResult) ? modulesResult.map(normalizeModule) : [];
      studio.moduleEditor = null;
      studio.editingModuleId = "";
      setStatus(`module saved: ${moduleId}`);
      rerender();
    });
  });
  appRoot.querySelectorAll("[data-studio-tab]").forEach((node) => {
    node.addEventListener("click", () => {
      const tab = /** @type {HTMLElement} */ (node).dataset.studioTab;
      studio.activeTab = tab === "templates" ? "templates" : "modules";
      rerender();
    });
  });
  document.getElementById("studio-search-input")?.addEventListener("input", (event) => {
    studio.search = /** @type {HTMLInputElement} */ (event.currentTarget).value || "";
    rerender();
  });
  appRoot.querySelectorAll("[data-studio-module-edit]").forEach((node) => {
    node.addEventListener("click", () => {
      const moduleId = /** @type {HTMLElement} */ (node).dataset.studioModuleEdit || "";
      const module = studio.modules.find((candidate) => candidate.id === moduleId);
      if (!module) return;
      openModuleEditor(module);
      rerender();
    });
  });
  appRoot.querySelectorAll("[data-studio-module-delete]").forEach((node) => {
    node.addEventListener("click", async () => {
      const moduleId = /** @type {HTMLElement} */ (node).dataset.studioModuleDelete || "";
      if (!moduleId) return;
      await runUiAction(async () => {
        const deleted = await safeInvoke("delete_module", { module_id: moduleId });
        if (!deleted) {
          setStatus(`module not found: ${moduleId}`);
          return;
        }
        const modulesResult = await safeInvoke("list_modules", {});
        studio.modules = Array.isArray(modulesResult) ? modulesResult.map(normalizeModule) : [];
        if (studio.editingModuleId === moduleId) {
          studio.editingModuleId = "";
          studio.moduleEditor = null;
        }
        setStatus(`module deleted: ${moduleId}`);
        rerender();
      });
    });
  });
  appRoot.querySelectorAll("[data-studio-insert-kind]").forEach((node) => {
    node.addEventListener("click", () => {
      const element = /** @type {HTMLElement} */ (node);
      if (addAssetToCanvas(element.dataset.studioInsertKind || "", element.dataset.studioInsertId || "")) {
        rerender();
      }
    });
  });
  appRoot.querySelectorAll("[data-studio-load-template]").forEach((node) => {
    node.addEventListener("click", () => {
      const templateId = /** @type {HTMLElement} */ (node).dataset.studioLoadTemplate || "";
      if (addAssetToCanvas("template", templateId, true)) {
        rerender();
      }
    });
  });
  appRoot.querySelectorAll("[data-studio-remove]").forEach((node) => {
    node.addEventListener("click", () => {
      const entryId = /** @type {HTMLElement} */ (node).dataset.studioRemove || "";
      applyCanvasEntries(studio.canvasEntries.filter((entry) => entry.entryId !== entryId), true);
      rerender();
    });
  });
  appRoot.querySelectorAll("[data-studio-move]").forEach((node) => {
    node.addEventListener("click", () => {
      const element = /** @type {HTMLElement} */ (node);
      const entryId = element.dataset.studioMove || "";
      const direction = element.dataset.studioDir || "";
      const index = studio.canvasEntries.findIndex((entry) => entry.entryId === entryId);
      if (index < 0) return;
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= studio.canvasEntries.length) return;
      const nextEntries = [...studio.canvasEntries];
      [nextEntries[index], nextEntries[nextIndex]] = [nextEntries[nextIndex], nextEntries[index]];
      applyCanvasEntries(nextEntries, true);
      rerender();
    });
  });
  appRoot.querySelectorAll("[data-studio-select-entry]").forEach((node) => {
    node.addEventListener("click", () => {
      const entryId = /** @type {HTMLElement} */ (node).dataset.studioSelectEntry || "";
      if (!entryId) return;
      studio.selectedEntryId = entryId;
      rerender();
    });
  });
  appRoot.querySelectorAll("[data-studio-entry-field]").forEach((node) => {
    node.addEventListener("change", (event) => {
      const element = /** @type {HTMLElement} */ (event.currentTarget);
      const entryId = element.dataset.studioEntryId || "";
      const field = element.dataset.studioEntryField || "";
      const value = /** @type {HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement} */ (
        event.currentTarget
      ).value;
      if (!entryId || !field) return;
      const changed = updateEntry(entryId, (entry) => {
        if (field === "title") {
          entry.title = String(value || "").trim() || entry.title;
        } else if (field === "durationMinutes") {
          entry.durationMinutes = Math.max(1, Number(value || "1"));
          if (entry.stepType === "pomodoro") {
            entry.pomodoro = normalizePomodoro(entry.pomodoro, entry.durationMinutes);
          }
        } else if (field === "stepType") {
          entry.stepType = normalizeStepType(value);
          entry.pomodoro =
            entry.stepType === "pomodoro"
              ? normalizePomodoro(entry.pomodoro, entry.durationMinutes)
              : null;
        } else if (field === "moduleId") {
          entry.moduleId = String(value || "").trim();
        } else if (field === "overrunPolicy") {
          entry.overrunPolicy = normalizeOverrunPolicy(value);
        } else if (field === "checklist") {
          entry.checklist = parseChecklistText(value);
        } else if (field === "note") {
          entry.note = String(value || "");
        }
        return entry;
      });
      if (changed) rerender();
    });
  });
  appRoot.querySelectorAll("[data-studio-entry-hint]").forEach((node) => {
    node.addEventListener("change", (event) => {
      const input = /** @type {HTMLInputElement} */ (event.currentTarget);
      const entryId = input.dataset.studioEntryId || "";
      const hint = input.dataset.studioEntryHint || "";
      if (!entryId || !hint) return;
      const changed = updateEntry(entryId, (entry) => {
        const hints = normalizeExecutionHints(entry.executionHints);
        if (hint === "allowSkip") hints.allowSkip = input.checked;
        if (hint === "mustCompleteChecklist") hints.mustCompleteChecklist = input.checked;
        if (hint === "autoAdvance") hints.autoAdvance = input.checked;
        entry.executionHints = hints;
        return entry;
      });
      if (changed) rerender();
    });
  });
  appRoot.querySelectorAll("[data-studio-entry-pomodoro]").forEach((node) => {
    node.addEventListener("change", (event) => {
      const input = /** @type {HTMLInputElement} */ (event.currentTarget);
      const entryId = input.dataset.studioEntryId || "";
      const field = input.dataset.studioEntryPomodoro || "";
      if (!entryId || !field) return;
      const changed = updateEntry(entryId, (entry) => {
        const pomodoro = normalizePomodoro(entry.pomodoro, entry.durationMinutes);
        const value = Number(input.value || "0");
        if (field === "focusSeconds") pomodoro.focusSeconds = Math.max(60, value || 60);
        if (field === "breakSeconds") pomodoro.breakSeconds = Math.max(60, value || 60);
        if (field === "cycles") pomodoro.cycles = Math.max(1, value || 1);
        if (field === "longBreakSeconds") pomodoro.longBreakSeconds = Math.max(0, value || 0);
        if (field === "longBreakEvery") pomodoro.longBreakEvery = Math.max(0, value || 0);
        entry.pomodoro = pomodoro;
        return entry;
      });
      if (changed) rerender();
    });
  });
  document.getElementById("studio-undo")?.addEventListener("click", () => {
    if (studio.historyIndex <= 0) return;
    studio.historyIndex -= 1;
    studio.canvasEntries = cloneValue(studio.history[studio.historyIndex] || []).map((entry, index) =>
      normalizeEntry(entry, index)
    );
    studio.selectedEntryId = studio.canvasEntries[0]?.entryId || "";
    rerender();
  });
  document.getElementById("studio-redo")?.addEventListener("click", () => {
    if (studio.historyIndex >= studio.history.length - 1) return;
    studio.historyIndex += 1;
    studio.canvasEntries = cloneValue(studio.history[studio.historyIndex] || []).map((entry, index) =>
      normalizeEntry(entry, index)
    );
    studio.selectedEntryId = studio.canvasEntries[0]?.entryId || "";
    rerender();
  });
  // ================================================================
  // Pointer-based DnD （WebView2/Tauri 対応 - HTML5 DnD の代替）
  // ================================================================

  // 前回のレンダリングから安いているドキュメントレベルリスナーを削除
  if (_rsDragHandlers) {
    document.removeEventListener("pointermove", _rsDragHandlers.move);
    document.removeEventListener("pointerup",   _rsDragHandlers.up);
    document.removeEventListener("pointercancel", _rsDragHandlers.up);
    _rsDragHandlers = null;
  }
  // 制御中のドラッグをクリア
  if (_rsDragGhost) { _rsDragGhost.remove(); _rsDragGhost = null; }
  if (_rsDragSource) { _rsDragSource.classList.remove("is-dragging"); _rsDragSource = null; }
  routineStudioActiveDrag = null;

  // ドロップを確定する内部関数
  const commitStudioDrop = (clientX, clientY) => {
    const dz = document.getElementById("routine-studio-dropzone");
    if (!dz) { routineStudioActiveDrag = null; return; }
    const dzRect = dz.getBoundingClientRect();
    const inside =
      clientX >= dzRect.left && clientX <= dzRect.right &&
      clientY >= dzRect.top  && clientY <= dzRect.bottom;
    const insertIndex = studio.dragInsertIndex >= 0 ? studio.dragInsertIndex : studio.canvasEntries.length;
    clearDropIndicator(dz);
    if (!inside || !routineStudioActiveDrag) {
      routineStudioActiveDrag = null;
      return;
    }
    const { kind, id } = routineStudioActiveDrag;
    routineStudioActiveDrag = null;
    if (kind === "entry") {
      const sourceIndex = studio.canvasEntries.findIndex((e) => e.entryId === id);
      if (sourceIndex < 0) return;
      const target = Math.max(0, Math.min(insertIndex, studio.canvasEntries.length));
      const nextEntries = [...studio.canvasEntries];
      const [moved] = nextEntries.splice(sourceIndex, 1);
      const adjusted = target > sourceIndex ? target - 1 : target;
      nextEntries.splice(Math.max(0, adjusted), 0, moved);
      applyCanvasEntries(nextEntries, true);
      studio.selectedEntryId = moved?.entryId || "";
    } else {
      addAssetToCanvas(kind, id, false, insertIndex);
    }
    rerender();
  };

  // pointermove: ゴーストを移動し、挿入インジケータを更新
  const onRsDragMove = (/** @type {PointerEvent} */ event) => {
    if (!_rsDragGhost) return;
    _rsDragGhost.style.left = `${event.clientX - _rsDragOffsetX}px`;
    _rsDragGhost.style.top  = `${event.clientY - _rsDragOffsetY}px`;
    const dz = document.getElementById("routine-studio-dropzone");
    if (!dz) return;
    const dzRect = dz.getBoundingClientRect();
    if (
      event.clientX >= dzRect.left && event.clientX <= dzRect.right &&
      event.clientY >= dzRect.top  && event.clientY <= dzRect.bottom
    ) {
      paintDropIndicator(dz, resolveDropInsertIndex(dz, event.clientY));
    } else {
      clearDropIndicator(dz);
    }
  };

  // pointerup / pointercancel: ドロップを確定またはキャンセル
  const onRsDragUp = (/** @type {PointerEvent} */ event) => {
    document.removeEventListener("pointermove",   onRsDragMove);
    document.removeEventListener("pointerup",     onRsDragUp);
    document.removeEventListener("pointercancel", onRsDragUp);
    _rsDragHandlers = null;
    if (_rsDragGhost)  { _rsDragGhost.remove();  _rsDragGhost = null; }
    if (_rsDragSource) { _rsDragSource.classList.remove("is-dragging"); _rsDragSource = null; }
    commitStudioDrop(event.clientX, event.clientY);
  };

  // ドラッグ開始共通內部関数
  const startStudioDrag = (/** @type {PointerEvent} */ event, /** @type {{ kind: string, id: string }} */ payload, /** @type {HTMLElement} */ sourceEl) => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    routineStudioActiveDrag = payload;
    _rsDragSource = sourceEl;
    sourceEl.classList.add("is-dragging");
    const rect = sourceEl.getBoundingClientRect();
    _rsDragOffsetX = event.clientX - rect.left;
    _rsDragOffsetY = event.clientY - rect.top;
    // ゴースト生成
    _rsDragGhost = document.createElement("div");
    _rsDragGhost.className = "rs-drag-ghost";
    const labelEl = sourceEl.querySelector(".rs-asset-title, .rs-canvas-title");
    _rsDragGhost.textContent = (labelEl ? labelEl.textContent : null) ?? payload.id;
    _rsDragGhost.style.left = `${event.clientX - _rsDragOffsetX}px`;
    _rsDragGhost.style.top  = `${event.clientY - _rsDragOffsetY}px`;
    document.body.appendChild(_rsDragGhost);
    _rsDragHandlers = { move: onRsDragMove, up: onRsDragUp };
    document.addEventListener("pointermove",   onRsDragMove);
    document.addEventListener("pointerup",     onRsDragUp);
    document.addEventListener("pointercancel", onRsDragUp);
  };

  // Library アセットカード: pointerdown でドラッグ開始
  appRoot.querySelectorAll("[data-studio-draggable='true']").forEach((node) => {
    node.addEventListener("pointerdown", (event) => {
      const el = /** @type {HTMLElement} */ (node);
      const kind = el.dataset.studioAssetKind || "";
      const id   = el.dataset.studioAssetId   || "";
      if (!kind || !id) return;
      // ボタンクリックは無視
      if (/** @type {HTMLElement} */ (event.target).closest("button, a")) return;
      startStudioDrag(/** @type {PointerEvent} */ (event), { kind, id }, el);
    });
  });

  // Canvas エントリカード: ハンドルの pointerdown でドラッグ開始
  appRoot.querySelectorAll(".rs-drag-handle").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      const card = /** @type {HTMLElement | null} */ (
        /** @type {HTMLElement} */ (handle).closest("[data-studio-canvas-entry]")
      );
      if (!card) return;
      const id = card.dataset.studioCanvasEntry || "";
      if (!id) return;
      startStudioDrag(/** @type {PointerEvent} */ (event), { kind: "entry", id }, card);
    });
  });

  document.getElementById("studio-template-id")?.addEventListener("input", (event) => {
    studio.templateId = /** @type {HTMLInputElement} */ (event.currentTarget).value || "";
  });
  document.getElementById("studio-draft-name")?.addEventListener("input", (event) => {
    studio.draftName = /** @type {HTMLInputElement} */ (event.currentTarget).value || "Routine Draft";
    const titleNode = appRoot.querySelector("[data-studio-title]");
    if (titleNode) titleNode.textContent = studio.draftName;
  });
  document.getElementById("studio-context")?.addEventListener("change", (event) => {
    studio.context = /** @type {HTMLSelectElement} */ (event.currentTarget).value || routineStudioContexts[0];
  });
  document.getElementById("studio-trigger-time")?.addEventListener("change", (event) => {
    studio.triggerTime = /** @type {HTMLInputElement} */ (event.currentTarget).value || "09:00";
    rerender();
  });
  document.getElementById("studio-macro-target")?.addEventListener("change", (event) => {
    studio.macroTargetMinutes = Number(/** @type {HTMLSelectElement} */ (event.currentTarget).value || "30");
    rerender();
  });
  document.getElementById("studio-auto-start")?.addEventListener("change", (event) => {
    studio.autoStart = /** @type {HTMLInputElement} */ (event.currentTarget).checked;
  });
  document.getElementById("studio-save-template")?.addEventListener("click", async () => {
    await runUiAction(async () => {
      const id = await persistTemplate();
      setStatus(`template saved: ${id}`);
      rerender();
    });
  });
  document.getElementById("studio-apply-today")?.addEventListener("click", async () => {
    await runUiAction(async () => {
      const id = await persistTemplate();
      const targetDate = isoDate(new Date());
      const result = await safeInvoke(
        "apply_studio_template_to_today",
        withAccount({
          template_id: id,
          date: targetDate,
          trigger_time: studio.triggerTime || "09:00",
          conflict_policy: "shift",
        })
      );
      await refreshCoreData(targetDate);
      const requested = formatHHmm(result?.requested_start_at);
      const applied = formatHHmm(result?.applied_start_at);
      studio.lastApplyResult = result?.shifted
        ? `Shifted ${requested} -> ${applied} (${result?.conflict_count || 0} conflicts)`
        : `Applied at ${applied}`;
      setStatus(`applied to today: ${id}`);
      rerender();
    });
  });
  document.getElementById("studio-delete-template")?.addEventListener("click", async () => {
    await runUiAction(async () => {
      const recipeId = String(studio.templateId || "").trim();
      if (!recipeId) {
        setStatus("template id is required");
        return;
      }
      const deleted = await safeInvoke("delete_recipe", { recipe_id: recipeId });
      if (!deleted) {
        setStatus(`template not found: ${recipeId}`);
        return;
      }
      uiState.recipes = await safeInvoke("list_recipes", {});
      studio.lastApplyResult = "";
      setStatus(`template deleted: ${recipeId}`);
      rerender();
    });
  });
  document.getElementById("studio-clear-canvas")?.addEventListener("click", () => {
    applyCanvasEntries([], true);
    studio.selectedEntryId = "";
    rerender();
  });
}

function renderTasks() {
  appRoot.innerHTML = `
    <section class="view-head">
      <div>
        <h2>タスク管理</h2>
        <p>タスクの作成・更新・削除。</p>
      </div>
    </section>
    <div class="panel grid">
      <label>タイトル <input id="task-title" /></label>
      <label>説明 <input id="task-description" /></label>
      <label>見積ポモドーロ <input id="task-estimate" type="number" min="0" value="1" /></label>
      <button id="task-create" class="btn-primary">タスク作成</button>
    </div>
    <div class="panel" style="margin-top:14px">
      <h3>一覧</h3>
      <table>
        <thead><tr><th>Title</th><th>Status</th><th>Estimate</th><th>操作</th></tr></thead>
        <tbody>
          ${uiState.tasks
            .map(
              (task) => `
              <tr>
                <td><input id="title-${task.id}" value="${task.title}" /></td>
                <td>
                  <select id="status-${task.id}">
                    ${["pending", "in_progress", "completed", "deferred"]
                      .map((status) => `<option value="${status}" ${task.status === status ? "selected" : ""}>${status}</option>`)
                      .join("")}
                  </select>
                </td>
                <td><input id="estimate-${task.id}" type="number" min="0" value="${task.estimated_pomodoros ?? 0}" /></td>
                <td>
                  <button class="btn-secondary" data-save-task="${task.id}">保存</button>
                  <input id="split-parts-${task.id}" type="number" min="2" value="2" style="width:68px" />
                  <button class="btn-warn" data-split-task="${task.id}">分割</button>
                  <button class="btn-danger" data-delete-task="${task.id}">削除</button>
                </td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <div class="panel" style="margin-top:14px">
      <h3>繰り越し</h3>
      <div class="grid three">
        <label>Task
          <select id="carry-task-id">
            <option value="">(task)</option>
            ${uiState.tasks
              .filter((task) => task.status !== "completed")
              .map((task) => `<option value="${task.id}">${task.title}</option>`)
              .join("")}
          </select>
        </label>
        <label>From Block
          <select id="carry-from-block-id">
            <option value="">(from)</option>
            ${uiState.blocks
              .map((block) => `<option value="${block.id}">${blockDisplayName(block)}</option>`)
              .join("")}
          </select>
        </label>
        <label>To Block
          <select id="carry-to-block-id">
            <option value="">(to)</option>
            ${uiState.blocks
              .map((block) => `<option value="${block.id}">${blockDisplayName(block)}</option>`)
              .join("")}
          </select>
        </label>
      </div>
      <div class="row" style="margin-top:10px">
        <button id="task-carry-over" class="btn-warn">選択ブロックへ繰り越し</button>
      </div>
    </div>
  `;

  document.getElementById("task-create")?.addEventListener("click", async () => {
    const title = /** @type {HTMLInputElement} */ (document.getElementById("task-title")).value.trim();
    const description = /** @type {HTMLInputElement} */ (document.getElementById("task-description")).value.trim();
    const estimate = Number(/** @type {HTMLInputElement} */ (document.getElementById("task-estimate")).value || "0");
    await safeInvoke("create_task", {
      title,
      description: description || null,
      estimated_pomodoros: Number.isFinite(estimate) ? estimate : null,
    });
    uiState.tasks = await safeInvoke("list_tasks");
    renderTasks();
  });

  appRoot.querySelectorAll("[data-save-task]").forEach((node) => {
    node.addEventListener("click", async () => {
      const id = /** @type {HTMLElement} */ (node).dataset.saveTask;
      const title = /** @type {HTMLInputElement} */ (document.getElementById(`title-${id}`)).value;
      const status = /** @type {HTMLSelectElement} */ (document.getElementById(`status-${id}`)).value;
      const estimate = Number(/** @type {HTMLInputElement} */ (document.getElementById(`estimate-${id}`)).value || "0");
      await safeInvoke("update_task", {
        task_id: id,
        title,
        estimated_pomodoros: Number.isFinite(estimate) ? estimate : null,
        status,
      });
      uiState.tasks = await safeInvoke("list_tasks");
      renderTasks();
    });
  });

  appRoot.querySelectorAll("[data-delete-task]").forEach((node) => {
    node.addEventListener("click", async () => {
      const id = /** @type {HTMLElement} */ (node).dataset.deleteTask;
      await safeInvoke("delete_task", { task_id: id });
      uiState.tasks = await safeInvoke("list_tasks");
      renderTasks();
    });
  });

  appRoot.querySelectorAll("[data-split-task]").forEach((node) => {
    node.addEventListener("click", async () => {
      const id = /** @type {HTMLElement} */ (node).dataset.splitTask;
      const partsRaw = /** @type {HTMLInputElement} */ (document.getElementById(`split-parts-${id}`)).value;
      const parts = Number(partsRaw || "0");
      await safeInvoke("split_task", { task_id: id, parts: Number.isFinite(parts) ? parts : 0 });
      uiState.tasks = await safeInvoke("list_tasks");
      renderTasks();
    });
  });

  document.getElementById("task-carry-over")?.addEventListener("click", async () => {
    const taskId = /** @type {HTMLSelectElement} */ (document.getElementById("carry-task-id")).value;
    const fromBlockId = /** @type {HTMLSelectElement} */ (document.getElementById("carry-from-block-id")).value;
    const toBlockId = /** @type {HTMLSelectElement} */ (document.getElementById("carry-to-block-id")).value;
    if (!taskId || !fromBlockId || !toBlockId) {
      setStatus("task / from / to を選択してください");
      return;
    }
    const result = await safeInvoke("carry_over_task", {
      task_id: taskId,
      from_block_id: fromBlockId,
      candidate_block_ids: [toBlockId],
    });
    setStatus(`task carry-over: ${result.task_id} -> ${result.to_block_id}`);
    uiState.tasks = await safeInvoke("list_tasks");
    renderTasks();
  });
}

function renderReflection() {
  const end = isoDate(new Date());
  const start = isoDate(new Date(Date.now() - 6 * 24 * 3600 * 1000));
  const summary = uiState.reflection;
  const focusPercent = summary ? Math.min(100, Math.round((summary.total_focus_minutes / 240) * 100)) : 0;
  const totalLogs = Array.isArray(summary?.logs) ? summary.logs.length : 0;
  const completionRate = totalLogs > 0 ? Math.round(((summary?.completed_count ?? 0) / totalLogs) * 100) : 0;

  appRoot.innerHTML = `
    <section class="view-head">
      <div>
        <h2>Insights</h2>
        <p>日次・週次の実行傾向を確認して、次のルーチン改善に繋げます。</p>
      </div>
    </section>
    <div class="panel row">
      <label>開始 <input id="reflection-start" type="date" value="${start}" /></label>
      <label>終了 <input id="reflection-end" type="date" value="${end}" /></label>
      <button id="reflection-load" class="btn-primary">集計</button>
    </div>
    <div class="grid three" style="margin-top:14px">
      <div class="panel metric"><span class="small">完了数</span><b>${summary?.completed_count ?? 0}</b></div>
      <div class="panel metric"><span class="small">中断数</span><b>${summary?.interrupted_count ?? 0}</b></div>
      <div class="panel metric"><span class="small">完了率</span><b>${completionRate}%</b></div>
    </div>
    <div class="panel metric" style="margin-top:14px"><span class="small">集中分</span><b>${summary?.total_focus_minutes ?? 0}m</b></div>
    <div class="panel" style="margin-top:14px">
      <p class="small">目標 240m に対する進捗</p>
      <div class="bar-track"><div class="bar-fill" style="width:${focusPercent}%"></div></div>
    </div>
    <div class="panel" style="margin-top:14px">
      <h3>ログ</h3>
      <div class="log-list">
        ${(summary?.logs ?? [])
          .map(
            (log) => `
            <div class="panel">
              <p><b>${log.phase}</b> / ${log.block_id}</p>
              <p class="small">${formatTime(log.start_time)} - ${formatTime(log.end_time)}</p>
              <p class="small">reason: ${log.interruption_reason ?? "-"}</p>
            </div>`
          )
          .join("")}
      </div>
    </div>
  `;

  document.getElementById("reflection-load")?.addEventListener("click", async () => {
    const startDate = /** @type {HTMLInputElement} */ (document.getElementById("reflection-start")).value;
    const endDate = /** @type {HTMLInputElement} */ (document.getElementById("reflection-end")).value;
    uiState.reflection = await safeInvoke("get_reflection_summary", {
      start: `${startDate}T00:00:00Z`,
      end: `${endDate}T23:59:59Z`,
    });
    renderReflection();
  });
}

function renderSettings() {
  const activePage = settingsPages.includes(uiState.settings.page) ? uiState.settings.page : "blocks";
  uiState.settings.page = activePage;

  let pageContent = "";
  switch (activePage) {
    case "blocks":
      pageContent = `
        <div class="grid two">
          <div class="panel grid">
            <h3>ブロック構成</h3>
            <label>勤務開始 <input id="set-work-start" type="time" value="${uiState.settings.workStart}" /></label>
            <label>勤務終了 <input id="set-work-end" type="time" value="${uiState.settings.workEnd}" /></label>
            <label>ブロック分数 <input id="set-block-duration" type="number" min="1" value="${uiState.settings.blockDuration}" /></label>
            <label>休憩分数 <input id="set-break-duration" type="number" min="1" value="${uiState.settings.breakDuration}" /></label>
            <button id="set-save-policy" class="btn-primary">セッション保存</button>
          </div>
          <div class="panel grid">
            <h3>ルーティーン / テンプレート</h3>
            <label>Routine JSON<textarea id="set-routine-json" placeholder='{"routines":[]}'></textarea></label>
            <label>Template JSON<textarea id="set-template-json" placeholder='{"templates":[]}'></textarea></label>
          </div>
        </div>
      `;
      break;
    case "git":
      pageContent = `
        <div class="grid two">
          <div class="panel grid">
            <h3>同期用 Git</h3>
            <p class="small">同期先のリモート設定を管理します。</p>
            <label>Git Remote <input id="set-git-remote" value="${uiState.settings.gitRemote}" placeholder="https://..." /></label>
            <button id="set-git-check" class="btn-secondary">Git設定確認</button>
          </div>
          <div class="panel grid">
            <h3>現在の同期先</h3>
            <pre class="small">${uiState.settings.gitRemote || "not configured"}</pre>
          </div>
        </div>
      `;
      break;
    default:
      pageContent = `
        <div class="grid two">
          <div class="panel grid">
            <h3>Google OAuth 認証</h3>
            <p class="small">推奨: 1クリックでSSO認証してカレンダー同期します。必要時のみ認可コードを手動交換します。</p>
            <label>Account ID
              <input id="auth-account-id" value="${normalizeAccountId(uiState.accountId)}" placeholder="default or email label" />
            </label>
            <label>Authorization Code
              <input id="auth-code" placeholder="paste authorization code" />
            </label>
            <div class="row">
              <button id="auth-sso" class="btn-primary">SSOログインして同期</button>
              <button id="auth-check" class="btn-secondary">セッション確認</button>
              <button id="auth-exchange" class="btn-secondary">コード交換</button>
            </div>
          </div>
          <div class="panel">
            <h3>認証結果</h3>
            <pre id="auth-result" class="small">${uiState.auth ? JSON.stringify(uiState.auth, null, 2) : "not executed"}</pre>
          </div>
        </div>
      `;
      break;
  }

  appRoot.innerHTML = `
    <section class="view-head">
      <div>
        <h2>設定</h2>
        <p>設定カテゴリをページ分割して管理します。</p>
      </div>
    </section>
    <nav class="settings-page-nav" aria-label="設定内ページ">
      ${settingsPages
        .map(
          (page) => `
        <a href="#/settings/${page}" data-settings-page="${page}" ${
            page === activePage ? 'aria-current="page"' : ""
          }>${settingsPageLabels[page]}</a>
      `
        )
        .join("")}
    </nav>
    ${pageContent}
  `;

  if (activePage === "blocks") {
    document.getElementById("set-save-policy")?.addEventListener("click", () => {
      uiState.settings.workStart = /** @type {HTMLInputElement} */ (document.getElementById("set-work-start")).value;
      uiState.settings.workEnd = /** @type {HTMLInputElement} */ (document.getElementById("set-work-end")).value;
      uiState.settings.blockDuration = Number(
        /** @type {HTMLInputElement} */ (document.getElementById("set-block-duration")).value
      );
      uiState.settings.breakDuration = Number(
        /** @type {HTMLInputElement} */ (document.getElementById("set-break-duration")).value
      );
      setStatus("settings saved in session");
    });
  } else if (activePage === "git") {
    document.getElementById("set-git-check")?.addEventListener("click", () => {
      uiState.settings.gitRemote = /** @type {HTMLInputElement} */ (document.getElementById("set-git-remote")).value;
      setStatus(uiState.settings.gitRemote ? "git remote configured" : "git remote is empty");
      renderSettings();
    });
  } else {
    document.getElementById("auth-sso")?.addEventListener("click", async () => {
      await runUiAction(async () => {
        uiState.accountId = normalizeAccountId(
          /** @type {HTMLInputElement} */ (document.getElementById("auth-account-id")).value
        );
        const targetDate = uiState.dashboardDate || isoDate(new Date());
        await authenticateAndSyncCalendar(targetDate, { forceReauth: true });
        await refreshCoreData(targetDate);
        renderSettings();
      });
    });

    document.getElementById("auth-check")?.addEventListener("click", async () => {
      uiState.accountId = normalizeAccountId(
        /** @type {HTMLInputElement} */ (document.getElementById("auth-account-id")).value
      );
      uiState.auth = await safeInvoke("authenticate_google", withAccount({}));
      renderSettings();
    });

    document.getElementById("auth-exchange")?.addEventListener("click", async () => {
      uiState.accountId = normalizeAccountId(
        /** @type {HTMLInputElement} */ (document.getElementById("auth-account-id")).value
      );
      const code = /** @type {HTMLInputElement} */ (document.getElementById("auth-code")).value.trim();
      uiState.auth = await safeInvoke("authenticate_google", withAccount({ authorization_code: code }));
      renderSettings();
    });
  }
}

window.addEventListener("hashchange", () => {
  render();
});

setInterval(async () => {
  const route = getRoute();
  if (route !== "now" && route !== "today") {
    return;
  }
  try {
    const [pomodoroResult, tasksResult] = await Promise.allSettled([
      invokeCommand("get_pomodoro_state", {}),
      invokeCommand("list_tasks", {}),
    ]);
    if (pomodoroResult.status === "fulfilled") {
      uiState.pomodoro = pomodoroResult.value;
      syncNowTimerDisplay(uiState.pomodoro);
    }
    if (tasksResult.status === "fulfilled") {
      uiState.tasks = tasksResult.value;
      syncNowTaskOrder(uiState.tasks);
    }
    if (route === "now") {
      renderPomodoro();
    } else {
      renderDashboard();
    }
  } catch {
    // handled in safeInvoke
  }
}, 5000);

setInterval(() => {
  const route = getRoute();
  if (route !== "now" && route !== "today") {
    return;
  }
  const state = normalizePomodoroState(uiState.pomodoro || {});
  if (state.phase !== "focus" && state.phase !== "break") {
    return;
  }
  if (uiState.nowUi.displayRemainingSeconds <= 0) {
    return;
  }
  uiState.nowUi.displayRemainingSeconds = Math.max(0, uiState.nowUi.displayRemainingSeconds - 1);
  if (route === "now") {
    renderPomodoro();
  } else {
    refreshTodayStatusTimerDisplay();
  }
}, 1000);

(async () => {
  if (!isTauriRuntimeAvailable()) {
    setStatus("mock mode: SSO requires `cd src-tauri && cargo tauri dev`");
  }

  try {
    await safeInvoke("bootstrap", {});
    const today = isoDate(new Date());
    try {
      await invokeCommandWithProgress("generate_today_blocks", withAccount({}));
    } catch (error) {
      if (!isUnknownCommandError(error)) {
        throw error;
      }
      await invokeCommandWithProgress("generate_blocks", withAccount({ date: today }));
    }
    await refreshCoreData();
    uiState.reflection = await safeInvoke("get_reflection_summary", {});
    uiState.nowUi.lastReflectionSyncEpochMs = Date.now();
  } catch {
    // handled in safeInvoke
  }

  if (!window.location.hash) {
    window.location.hash = "#/today";
  }
  render();
})();

