import { createCommandService, isUnknownCommandError as isUnknownCommandErrorValue } from "./services/command-service.js";
import { createMockInvoke } from "./mock/mock-invoke.js";
import { buildDailyCalendarModel as buildDailyCalendarModelValue, buildPlannerStripModel as buildPlannerStripModelValue, buildWeeklyPlannerModel as buildWeeklyPlannerModelValue, dayItemKey as dayItemKeyValue, invertTimelineIntervals as invertTimelineIntervalsValue, mergeTimelineIntervals as mergeTimelineIntervalsValue, minutesBetween as minutesBetweenValue, sumIntervalMinutes as sumIntervalMinutesValue, toClippedInterval as toClippedIntervalValue, toTimelineIntervals as toTimelineIntervalsValue, } from "./calendar-model.js";
import { renderDailyCalendar as renderDailyCalendarValue, renderDailyDetail as renderDailyDetailValue, renderGridDailyCalendar as renderGridDailyCalendarValue, renderSimpleDailyCalendar as renderSimpleDailyCalendarValue, renderSingleDayPlannerCalendar as renderSingleDayPlannerCalendarValue, renderWeeklyPlannerCalendar as renderWeeklyPlannerCalendarValue, } from "./calendar-render.js";
import type { DayCalendarModel, PlannerStripRenderModel } from "./calendar-render.js";
import { getById } from "./dom.js";
import { blockDurationMinutes as blockDurationMinutesValue, blockPomodoroTarget as blockPomodoroTargetValue, getNowOrderedTasks as getNowOrderedTasksValue, normalizePomodoroState as normalizePomodoroStateValue, nowBufferAvailableMinutes as nowBufferAvailableMinutesValue, pomodoroPhaseLabel as pomodoroPhaseLabelValue, pomodoroProgressPercent as pomodoroProgressPercentValue, resolveCurrentFocusTask as resolveCurrentFocusTaskValue, resolveNowAutoStartBlock as resolveNowAutoStartBlockValue, resolveNowAutoStartTask as resolveNowAutoStartTaskValue, resolveNowBlocks as resolveNowBlocksValue, resolveNowDayBounds as resolveNowDayBoundsValue, syncNowTaskOrder as syncNowTaskOrderValue, syncNowTimerDisplay as syncNowTimerDisplayValue, } from "./now.js";
import { formatHHmm as formatHHmmValue, formatTime as formatTimeValue, fromLocalInputValue as fromLocalInputValueValue, isoDate as isoDateValue, nowIso as nowIsoValue, resolveDayBounds as resolveDayBoundsValue, resolveWeekBounds as resolveWeekBoundsValue, resolveWeekBufferDateKeys as resolveWeekBufferDateKeysValue, resolveWeekDateKeys as resolveWeekDateKeysValue, toLocalInputValue as toLocalInputValueValue, toSyncWindowPayload as toSyncWindowPayloadValue, toTimerText as toTimerTextValue, } from "./time.js";
import { renderBlocksPage } from "./pages/blocks/page.js";
import { renderWeekDetailsPage } from "./pages/week/details-page.js";
import { renderInsightsPage } from "./pages/insights/page.js";
import { renderNowPage } from "./pages/now/page.js";
import { renderRoutinesPage } from "./pages/routines/page.js";
import { renderSettingsPage } from "./pages/settings/page.js";
import { renderWeekPage } from "./pages/week/page.js";
import { intervalRangeLabel as intervalRangeLabelValue, toClockText as toClockTextValue, toDurationLabel as toDurationLabelValue } from "./calendar-view-helpers.js";
import { bindDailyCalendarInteractions as bindDailyCalendarInteractionsValue, blockRows as blockRowsValue } from "./day-calendar-bindings.js";
import { renderNowNotesPanel as renderNowNotesPanelView } from "./pages/now/renderers.js";
import { renderWeekStatusCard as renderWeekStatusCardView, renderWeekTaskPanel as renderWeekTaskPanelView, renderWeekTimelinePanel as renderWeekTimelinePanelView, } from "./pages/week/renderers.js";
import type { Block, DayBlockDragState, JsonObject, MockState, Module, PageRenderDeps, PomodoroState, ProgressState, Recipe, Task, UiState, } from "./types.js";
const appRoot = getById<HTMLElement>("app") as HTMLElement;
const statusChip = getById<HTMLElement>("global-status");
const progressChip = getById<HTMLElement>("global-progress");
const progressLabel = getById<HTMLElement>("global-progress-label");
const progressFill = getById<HTMLElement>("global-progress-fill");
const progressValue = getById<HTMLElement>("global-progress-value");
const routes = ["week", "week-details", "now", "routines", "insights", "settings"];
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
const progressTargetPercent = 92;
const progressUpdateIntervalMs = 180;
const BLOCKS_INITIAL_VISIBLE = 50;
const BLOCK_TITLE_STORAGE_KEY = "pomo_block_titles_v1";
const WEEK_RESIZE_RENDER_MS = 120;
// Routine Studio のドラッグデータを保持するモジュール変数
let routineStudioActiveDrag: {
    kind: string;
    id: string;
} | null = null;
let _rsDragHandlers: {
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
} | null = null;
let _rsDragGhost: HTMLElement | null = null;
let _rsDragSource: HTMLElement | null = null;
let _rsDragOffsetX = 0;
let _rsDragOffsetY = 0;
let weekResizeRenderTimer = 0 as ReturnType<typeof setTimeout> | 0;
const routineStudioSeedModules: Module[] = [
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
const routineStudioSeedFolders = routineStudioSeedModules.reduce<Array<{ id: string; name: string }>>((folders, module) => {
    const category = String(module.category || "").trim();
    if (!category || folders.some((folder) => folder.id === category)) {
        return folders;
    }
    folders.push({
        id: category,
        name: category,
    });
    return folders;
}, []);
const routineStudioContexts = ["Work - Deep Focus", "Admin", "Planning", "Learning", "Personal"];
let routineStudioSequence = 1;
type DayItemKind = "block" | "event" | "free";
type DayItemSelection = {
    kind: DayItemKind;
    id: string;
} | null;
type DayCalendarViewMode = "grid" | "simple";
type RoutineStudioModuleView = {
    id: string;
    name: string;
    category: string;
    description: string;
    icon: string;
    durationMinutes: number;
};
type RoutineStudioEntryView = {
    entryId: string;
    sourceKind: string;
    sourceId: string;
    moduleId: string;
    title: string;
    subtitle: string;
    durationMinutes: number;
    note: string;
};
const uiState: UiState = {
    auth: null,
    accountId: "default",
    dashboardDate: isoDate(new Date()),
    weekView: {
        bufferAnchorDate: isoDate(new Date()),
        isInteracting: false,
        isPrefetching: false,
        scrollLeftSnapshot: 0,
    },
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
        subPage: "editor",
        search: "",
        draftName: "Morning Deep Work",
        templateId: "rcp-routine-studio",
        applyTemplateId: "",
        triggerTime: "09:00",
        context: "Work - Deep Focus",
        autoStart: true,
        macroTargetMinutes: 30,
        modules: [],
        moduleFolders: [],
        hiddenTemplateCount: 0,
        canvasEntries: [],
        history: [],
        historyIndex: -1,
        dragInsertIndex: -1,
        selectedEntryId: "",
        entryEditorEntryId: "",
        editingModuleId: "",
        lastApplyResult: "",
        bootstrapped: false,
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
const mockState: MockState = {
    sequence: 1,
    tasks: [],
    blocks: [],
    recipes: [],
    modules: [],
    moduleFolders: [],
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
const progressState: ProgressState = {
    active: false,
    command: "",
    label: "",
    percent: 0,
    timerId: 0,
    hideTimerId: 0,
};
const dayBlockDragState: DayBlockDragState = {
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
    hoveredFreeEntry: null,
    entry: null,
    timeLabel: null,
    onMove: null,
    onUp: null,
};
const mockInvoke = createMockInvoke({
    mockState,
    nextMockId,
    ensureMockRecipesSeeded,
    ensureMockModulesSeeded,
    normalizeAccountId,
    nowIso,
    isoDate,
    emptyMockPomodoroState,
    mockSessionPlan,
    appendMockPomodoroLog,
    unassignMockTask,
    assignMockTask,
    toRecord,
    readString,
    readStringArray,
    readNestedPayload,
    toJsonObject,
});
const commandService = createCommandService({
    setStatus,
    mockInvoke,
    isLongRunning: (name: string) => longRunningCommands.has(name),
    onBegin: async (targetName: string) => {
        beginLongRunningProgress(targetName);
        await waitForNextFrame();
    },
    onFinish: finishLongRunningProgress,
    runUiAction,
});
function nextMockId(prefix: string) {
    const id = `${prefix}-${Date.now()}-${mockState.sequence}`;
    mockState.sequence += 1;
    return id;
}
function ensureMockRecipesSeeded() {
    if (mockState.recipes.length > 0)
        return;
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
    if (mockState.modules.length === 0) {
        mockState.modules = routineStudioSeedModules.map((module) => ({
            ...module,
            checklist: Array.isArray(module.checklist) ? [...module.checklist] : [],
            pomodoro: module.pomodoro ? { ...module.pomodoro } : null,
            executionHints: module.executionHints ? { ...module.executionHints } : null,
        }));
    }
    if (mockState.moduleFolders.length === 0) {
        mockState.moduleFolders = routineStudioSeedFolders.map((folder) => ({
            ...folder,
        }));
    }
}
function isoDate(value: Date) {
    return isoDateValue(value);
}
function nowIso() {
    return nowIsoValue();
}
function formatTime(value: string | null | undefined) {
    return formatTimeValue(value);
}
function formatHHmm(value: string | null | undefined) {
    return formatHHmmValue(value);
}
function blockDisplayName(block: Pick<Block, "start_at" | "end_at"> & Partial<Block>) {
    const timeRange = `${formatHHmm(block?.start_at)}-${formatHHmm(block?.end_at)}`;
    const title = blockTitle(block);
    return title ? `${title} (${timeRange})` : timeRange;
}
function toLocalInputValue(rfc3339: string | null | undefined) {
    return toLocalInputValueValue(rfc3339);
}
function fromLocalInputValue(value: string | null | undefined) {
    return fromLocalInputValueValue(value);
}
function toTimerText(seconds: number | null | undefined) {
    return toTimerTextValue(seconds);
}
function normalizePomodoroState(state: unknown): PomodoroState {
    return normalizePomodoroStateValue(state);
}
function pomodoroPhaseLabel(phase: unknown) {
    return pomodoroPhaseLabelValue(phase);
}
function blockDurationMinutes(block: Block) {
    return blockDurationMinutesValue(block);
}
function blockPomodoroTarget(block: Block) {
    return blockPomodoroTargetValue(block, Number(uiState.settings.breakDuration || 5));
}
function pomodoroProgressPercent(state: unknown) {
    return pomodoroProgressPercentValue(state);
}
function syncNowTaskOrder(tasksInput: Task[] = uiState.tasks as Task[]) {
    syncNowTaskOrderValue(uiState.nowUi as UiState["nowUi"], tasksInput);
}
function getNowOrderedTasks(includeCompleted = false): Task[] {
    return getNowOrderedTasksValue(uiState.nowUi as UiState["nowUi"], uiState.tasks, includeCompleted);
}
function resolveNowDayBounds(reference: Date = new Date()) {
    return resolveNowDayBoundsValue(reference);
}
function resolveNowBlocks(reference: Date = new Date()): Array<{ block: Block; startMs: number; endMs: number }> {
    return resolveNowBlocksValue(uiState.blocks, reference);
}
function resolveNowAutoStartBlock(state: PomodoroState): Block | null {
    return resolveNowAutoStartBlockValue(uiState.blocks, state);
}
function resolveNowAutoStartTask(state: PomodoroState): Task | null {
    return resolveNowAutoStartTaskValue(uiState.nowUi as UiState["nowUi"], uiState.tasks, state);
}
function syncNowTimerDisplay(stateInput: unknown) {
    syncNowTimerDisplayValue(uiState.nowUi as UiState["nowUi"], stateInput, uiState.pomodoro);
}
function nowBufferAvailableMinutes(reference: Date = new Date()) {
    return nowBufferAvailableMinutesValue(uiState.blocks, reference);
}
function resolveCurrentFocusTask(stateInput: PomodoroState = uiState.pomodoro as PomodoroState): Task | null {
    return resolveCurrentFocusTaskValue(uiState.tasks, stateInput);
}
function resolveDayBounds(dateValue: string) {
    return resolveDayBoundsValue(String(dateValue ?? ""));
}
function resolveWeekBounds(dateValue: string) {
    return resolveWeekBoundsValue(String(dateValue ?? ""));
}
function resolveWeekDateKeys(dateValue: string) {
    return resolveWeekDateKeysValue(String(dateValue ?? ""));
}
function resolveWeekBufferDateKeys(dateValue: string) {
    return resolveWeekBufferDateKeysValue(String(dateValue ?? ""));
}
function toSyncWindowPayload(dateValue: string, scope: "day" | "week" = "day") {
    const targetScope = scope === "week" ? "week" : "day";
    return toSyncWindowPayloadValue(String(dateValue ?? ""), targetScope);
}
function normalizeAccountId(value: unknown) {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized || "default";
}
function loadBlockTitles(): Record<string, string> {
    if (typeof localStorage === "undefined")
        return {};
    try {
        const raw = localStorage.getItem(BLOCK_TITLE_STORAGE_KEY);
        if (!raw)
            return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object")
            return {};
        return Object.fromEntries(Object.entries(parsed).filter(([key, value]: [string, unknown]) => typeof key === "string" && typeof value === "string")) as Record<string, string>;
    }
    catch {
        return {};
    }
}
function persistBlockTitles() {
    if (typeof localStorage === "undefined")
        return;
    try {
        localStorage.setItem(BLOCK_TITLE_STORAGE_KEY, JSON.stringify(uiState.blockTitles));
    }
    catch {
        // ignore storage errors
    }
}
function blockTitle(block: { id?: string } | null | undefined) {
    const blockId = typeof block?.id === "string" ? block.id.trim() : "";
    if (!blockId)
        return "";
    return uiState.blockTitles[blockId] || "";
}
function setBlockTitle(blockId: string, title: string) {
    const normalizedId = typeof blockId === "string" ? blockId.trim() : "";
    if (!normalizedId)
        return false;
    const normalizedTitle = typeof title === "string" ? title.trim() : "";
    if (normalizedTitle) {
        uiState.blockTitles[normalizedId] = normalizedTitle;
    }
    else {
        delete uiState.blockTitles[normalizedId];
    }
    persistBlockTitles();
    return true;
}
function withAccount(payload: Record<string, unknown> = {}) {
    return {
        ...payload,
        account_id: normalizeAccountId(uiState.accountId),
    };
}
async function resetBlocksForDate(date: string) {
    const targetDate = typeof date === "string" && date.trim() ? date.trim() : uiState.dashboardDate;
    const existingBlocks = await safeInvoke("list_blocks", { date: targetDate });
    const blocks = Array.isArray(existingBlocks) ? existingBlocks as Array<{ id?: string }> : [];
    if (blocks.length > 0) {
        await Promise.all(blocks.map((block) => safeInvoke("delete_block", {
            block_id: String(block.id || ""),
        })));
    }
    return blocks.length;
}
function toClockText(milliseconds: number, options: Intl.DateTimeFormatOptions = {}) {
    return toClockTextValue(milliseconds, options);
}
function timezoneOffsetLabel() {
    const offsetMinutes = -new Date().getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absoluteMinutes = Math.abs(offsetMinutes);
    const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
    const minutes = String(absoluteMinutes % 60).padStart(2, "0");
    return `GMT${sign}${hours}${minutes === "00" ? "" : `:${minutes}`}`;
}
function escapeHtml(value: unknown) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function dayItemKey(kind: string, id: string) {
    return dayItemKeyValue(kind, id);
}
function minutesBetween(startMs: number, endMs: number) {
    return minutesBetweenValue(startMs, endMs);
}
function toDurationLabel(totalMinutes: number) {
    return toDurationLabelValue(totalMinutes);
}
function nextRoutineStudioEntryId() {
    const id = `studio-entry-${routineStudioSequence}`;
    routineStudioSequence += 1;
    return id;
}
function routineStudioStepDurationMinutes(step: unknown) {
    const source = (step ?? {}) as Record<string, unknown>;
    const durationSeconds = Number(source.durationSeconds ?? source.duration_seconds ?? 300);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
        return 5;
    return Math.max(1, Math.round(durationSeconds / 60));
}
function routineStudioSlug(value: string) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
}
function isRoutineStudioRecipe(recipe: unknown) {
    const source = (recipe ?? {}) as Record<string, unknown>;
    const meta = (source.studioMeta || source.studio_meta || null) as Record<string, unknown> | null;
    return Number(meta?.version) === 1 && String(meta?.kind || "").toLowerCase() === "routine_studio";
}
function cloneValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}
function toClippedInterval(startAt: string, endAt: string, dayStartMs: number, dayEndMs: number) {
    return toClippedIntervalValue(startAt, endAt, dayStartMs, dayEndMs);
}
function toTimelineIntervals(items: Array<{ start_at: string; end_at: string }>, dayStartMs: number, dayEndMs: number) {
    return toTimelineIntervalsValue(items, dayStartMs, dayEndMs);
}
function mergeTimelineIntervals(intervals: Array<{ startMs: number; endMs: number }>) {
    return mergeTimelineIntervalsValue(intervals);
}
function invertTimelineIntervals(dayStartMs: number, dayEndMs: number, busyIntervals: Array<{ startMs: number; endMs: number }>) {
    return invertTimelineIntervalsValue(dayStartMs, dayEndMs, busyIntervals);
}
function sumIntervalMinutes(intervals: Array<{ startMs: number; endMs: number }>) {
    return sumIntervalMinutesValue(intervals);
}
function intervalRangeLabel(interval: unknown) {
    return intervalRangeLabelValue(interval);
}
function buildDailyCalendarModel(dateValue: unknown, blocks: unknown, events: unknown, options: { syncSelection?: boolean; preferredSelection?: DayItemSelection; } = {}) {
    const model = buildDailyCalendarModelValue(dateValue, (Array.isArray(blocks) ? blocks : []) as unknown[], (Array.isArray(events) ? events : []) as unknown[], {
        ...options,
        currentSelection: uiState.dayCalendarSelection,
        blockDisplayName: (block: unknown) => blockDisplayName(block as Pick<Block, "start_at" | "end_at"> & Partial<Block>),
    });
    if (options.syncSelection !== false) {
        uiState.dayCalendarSelection = model.selection;
    }
    return model;
}
function buildWeeklyPlannerModel(dateValue: unknown, blocks: unknown, events: unknown) {
    const model = buildWeeklyPlannerModelValue(dateValue, {
        currentSelection: uiState.dayCalendarSelection,
        buildDaily: (dayKey: string, buildOptions: { syncSelection: boolean; preferredSelection?: unknown; }) => buildDailyCalendarModel(dayKey, blocks, events, {
            syncSelection: buildOptions.syncSelection,
            preferredSelection: buildOptions.preferredSelection as DayItemSelection,
        }),
    });
    uiState.dayCalendarSelection = model.selection;
    return model;
}
function buildPlannerStripModel(dateKeys: string[], currentDateKey: string, blocks: unknown, events: unknown) {
    const model = buildPlannerStripModelValue(dateKeys, currentDateKey, {
        currentSelection: uiState.dayCalendarSelection,
        buildDaily: (dayKey: string, buildOptions: { syncSelection: boolean; preferredSelection?: unknown; }) => buildDailyCalendarModel(dayKey, blocks, events, {
            syncSelection: buildOptions.syncSelection,
            preferredSelection: buildOptions.preferredSelection as DayItemSelection,
        }),
    });
    uiState.dayCalendarSelection = model.selection;
    return model;
}
function renderWeeklyPlannerCalendar(model: unknown) {
    return renderWeeklyPlannerCalendarValue(model as PlannerStripRenderModel, {
        escapeHtml,
        intervalRangeLabel,
        toDurationLabel: (minutes: number) => toDurationLabel(minutes),
        toClockText: (milliseconds: number) => toClockText(milliseconds),
    });
}
function renderSingleDayPlannerCalendar(model: unknown) {
    return renderSingleDayPlannerCalendarValue(model as PlannerStripRenderModel, {
        escapeHtml,
        intervalRangeLabel,
        toDurationLabel: (minutes: number) => toDurationLabel(minutes),
        toClockText: (milliseconds: number) => toClockText(milliseconds),
    });
}
function renderDailyCalendar(dateValue: unknown, options: unknown = {}) {
    const optionsRecord = (options ?? {}) as Record<string, unknown>;
    const dailyOptions: { syncSelection?: boolean; preferredSelection?: DayItemSelection; } = {};
    if (typeof optionsRecord.syncSelection === "boolean") {
        dailyOptions.syncSelection = optionsRecord.syncSelection;
    }
    if ("preferredSelection" in optionsRecord) {
        dailyOptions.preferredSelection = optionsRecord.preferredSelection as DayItemSelection;
    }
    const model = buildDailyCalendarModel(dateValue, uiState.blocks, uiState.calendarEvents, dailyOptions);
    const mode = optionsRecord.forceMode === "grid" || optionsRecord.forceMode === "simple"
        ? optionsRecord.forceMode
        : uiState.dayCalendarViewMode === "simple"
            ? "simple"
            : "grid";
    const panelClass = typeof optionsRecord.panelClass === "string" && optionsRecord.panelClass.trim() ? ` ${optionsRecord.panelClass}` : "";
    const showHeader = optionsRecord.showHeader !== false;
    const showMetrics = optionsRecord.showMetrics !== false;
    const showViewToggle = optionsRecord.showViewToggle !== false;
    const includeDetail = optionsRecord.includeDetail !== false;
    const includeBoard = optionsRecord.includeBoard !== false;
    const includeTimeline = optionsRecord.includeTimeline !== false;
    const compactSummary = optionsRecord.compactSummary === true;
    const typedModel = model as DayCalendarModel & { totals: { blockMinutes: number; eventMinutes: number; freeMinutes: number; }; };
    const renderDailyDetail = (selected: unknown) => renderDailyDetailValue(selected, {
        escapeHtml,
        intervalRangeLabel,
        toDurationLabel: (minutes: number) => toDurationLabel(minutes),
        blockTitle: (block: unknown) => blockTitle(block as { id?: string } | null | undefined),
    });
    return renderDailyCalendarValue({
        dateValue: String(dateValue),
        model: typedModel,
        mode,
        panelClass,
        showHeader,
        showMetrics,
        showViewToggle,
        includeDetail,
        includeBoard,
        includeTimeline,
    }, {
        escapeHtml,
        intervalRangeLabel,
        toDurationLabel: (minutes: number) => toDurationLabel(minutes),
        timezoneOffsetLabel,
        renderSimpleDailyCalendar: (calendarModel, renderOptions) => renderSimpleDailyCalendarValue(calendarModel, { ...renderOptions, compactSummary }, {
            escapeHtml,
            intervalRangeLabel,
            toDurationLabel: (minutes: number) => toDurationLabel(minutes),
            minutesBetween: (startMs: number, endMs: number) => minutesBetween(startMs, endMs),
            renderDailyDetail,
        }),
        renderGridDailyCalendar: (calendarModel, renderOptions) => renderGridDailyCalendarValue(calendarModel, renderOptions, {
            escapeHtml,
            intervalRangeLabel,
            toDurationLabel: (minutes: number) => toDurationLabel(minutes),
            toClockText: (milliseconds: number) => toClockText(milliseconds),
            renderDailyDetail,
        }),
    });
}
function setStatus(message: unknown) {
    if (statusChip) {
        statusChip.textContent = String(message ?? "");
    }
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
    if (!progressChip || !progressLabel || !progressFill || !progressValue)
        return;
    progressChip.hidden = !progressState.active;
    if (!progressState.active)
        return;
    progressLabel.textContent = progressState.label;
    progressValue.textContent = `${progressState.percent}%`;
    progressFill.style.width = `${progressState.percent}%`;
}
function setProgressPercent(percent: number) {
    progressState.percent = Math.max(0, Math.min(100, Math.round(percent)));
    renderGlobalProgress();
}
function beginLongRunningProgress(command: string) {
    const label = longRunningLabels[command as keyof typeof longRunningLabels] ?? command;
    clearProgressTimers();
    progressState.active = true;
    progressState.command = command;
    progressState.label = `${label} 実行中`;
    setProgressPercent(5);
    progressState.timerId = setInterval(() => {
        if (!progressState.active || progressState.percent >= progressTargetPercent)
            return;
        const remaining = progressTargetPercent - progressState.percent;
        const step = Math.max(1, Math.round(remaining / 6));
        setProgressPercent(progressState.percent + step);
    }, progressUpdateIntervalMs);
}
function finishLongRunningProgress(success: boolean) {
    if (!progressState.active)
        return;
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
        return new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => setTimeout(resolve, 0));
        });
    }
    return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
function getRoute(): string {
    const hash = window.location.hash.replace(/^#\/?/, "");
    const [root, detail] = hash.split("/");
    if (root === "auth") {
        uiState.settings.page = "auth";
        return "settings";
    }
    if (root === "settings") {
        if (detail && settingsPages.includes(detail)) {
            uiState.settings.page = detail;
        }
        else if (!settingsPages.includes(uiState.settings.page)) {
            uiState.settings.page = "blocks";
        }
        return "settings";
    }
    if (root === "week" && detail === "details") {
        return "week-details";
    }
    return routes.includes(root || "") ? String(root) : "week";
}
function markActiveRoute(route: string) {
    const activeRoute = route === "week-details" ? "week" : route;
    document.querySelectorAll("a[data-route]").forEach((node) => {
        const anchor = node as HTMLAnchorElement;
        if (anchor.dataset.route === activeRoute) {
            anchor.setAttribute("aria-current", "page");
        }
        else {
            anchor.removeAttribute("aria-current");
        }
    });
}
async function invokeCommand(name: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    return await commandService.invokeCommand(name, payload);
}
function isTauriRuntimeAvailable() {
    return commandService.isTauriRuntimeAvailable();
}
async function safeInvoke(name: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    return await commandService.safeInvoke(name, payload);
}
async function safeInvokeWithFallback(primaryName: string, payload: Record<string, unknown>, fallbackName: string, fallbackPayload: Record<string, unknown> = payload): Promise<unknown> {
    return await commandService.safeInvokeWithFallback(primaryName, payload, fallbackName, fallbackPayload);
}
async function runUiAction(action: () => Promise<void>): Promise<void> {
    try {
        await action();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`operation failed: ${message}`);
        console.error(error);
    }
}
async function invokeCommandWithProgress(name: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    return await commandService.invokeCommandWithProgress(name, payload);
}
function isUnknownCommandError(error: unknown): boolean {
    return isUnknownCommandErrorValue(error);
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
function mockSessionPlan(block: Block) {
    const requestedCycles = blockPomodoroTarget(block);
    const recipe = mockState.recipes.find((item) => item.id === block.recipe_id);
    const step = Array.isArray(recipe?.steps) ? recipe.steps[0] : null;
    const pomodoro = step?.pomodoro || null;
    const focusSeconds = Number(pomodoro?.focusSeconds || pomodoro?.focus_seconds || 25 * 60);
    const breakSeconds = Math.max(60, Number(pomodoro?.breakSeconds || pomodoro?.break_seconds || Math.floor((uiState.settings.breakDuration || 5) * 60)));
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
function appendMockPomodoroLog(phase: string, interruptionReason: string | null = null) {
    mockState.logs.push({
        id: nextMockId("pom"),
        block_id: mockState.pomodoro.current_block_id ?? "-",
        task_id: mockState.pomodoro.current_task_id,
        phase,
        start_time: mockState.pomodoro.start_time ?? nowIso(),
        end_time: nowIso(),
        interruption_reason: interruptionReason,
    });
}
function unassignMockTask(taskId: string) {
    const previousBlockId = mockState.taskAssignmentsByTask[taskId];
    if (previousBlockId) {
        delete mockState.taskAssignmentsByTask[taskId];
        delete mockState.taskAssignmentsByBlock[previousBlockId];
    }
}
function assignMockTask(taskId: string, blockId: string) {
    const previousTaskId = mockState.taskAssignmentsByBlock[blockId];
    if (previousTaskId) {
        delete mockState.taskAssignmentsByTask[previousTaskId];
    }
    unassignMockTask(taskId);
    mockState.taskAssignmentsByTask[taskId] = blockId;
    mockState.taskAssignmentsByBlock[blockId] = taskId;
}
function toRecord(value: unknown): Record<string, unknown> {
    return value != null && typeof value === "object" ? value as Record<string, unknown> : {};
}
function readString(payload: Record<string, unknown>, key: string, fallback = ""): string {
    const value = payload[key];
    return typeof value === "string" ? value : fallback;
}
function readStringArray(payload: Record<string, unknown>, key: string): string[] {
    const value = payload[key];
    if (!Array.isArray(value))
        return [];
    return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}
function readNestedPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const nested = payload.payload;
    return nested != null && typeof nested === "object" ? nested as Record<string, unknown> : payload;
}
function toJsonObject(value: unknown): JsonObject | null {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as JsonObject;
}
async function refreshCoreData(date: string = isoDate(new Date())) {
    const normalizedDate = typeof date === "string" && date.trim() ? date.trim() : isoDate(new Date());
    const syncWindow = toSyncWindowPayload(normalizedDate, "week");
    const weekDateKeys = resolveWeekBufferDateKeys(normalizedDate);
    const weeklyBlocksPromise = Promise.all(weekDateKeys.map((dateKey: string) => safeInvoke("list_blocks", { date: dateKey }))).then((dailyBlocks: unknown[]) => {
        const merged = dailyBlocks.flat() as Array<{ id?: string } & Block>;
        const seen = new Set();
        return merged.filter((block) => {
            if (!block?.id || seen.has(block.id))
                return false;
            seen.add(block.id);
            return true;
        });
    });
    uiState.dashboardDate = normalizedDate;
    uiState.weekView.bufferAnchorDate = normalizedDate;
    const [tasksResult, blocksResult, calendarEventsResult, pomodoroResult, recipesResult] = await Promise.allSettled([
        safeInvoke("list_tasks"),
        weeklyBlocksPromise,
        safeInvoke("list_synced_events", withAccount(syncWindow)),
        safeInvoke("get_pomodoro_state"),
        safeInvoke("list_recipes"),
    ]);
    const refreshErrors = [];
    if (tasksResult.status === "fulfilled") {
        uiState.tasks = tasksResult.value as Task[];
        syncNowTaskOrder(uiState.tasks);
    }
    else {
        const message = tasksResult.reason instanceof Error ? tasksResult.reason.message : String(tasksResult.reason);
        refreshErrors.push(`list_tasks: ${message}`);
    }
    if (blocksResult.status === "fulfilled") {
        uiState.blocks = blocksResult.value as Block[];
    }
    else {
        const message = blocksResult.reason instanceof Error ? blocksResult.reason.message : String(blocksResult.reason);
        refreshErrors.push(`list_blocks: ${message}`);
    }
    if (calendarEventsResult.status === "fulfilled") {
        uiState.calendarEvents = calendarEventsResult.value as typeof uiState.calendarEvents;
    }
    else {
        const message = calendarEventsResult.reason instanceof Error
            ? calendarEventsResult.reason.message
            : String(calendarEventsResult.reason);
        refreshErrors.push(`list_synced_events: ${message}`);
    }
    if (pomodoroResult.status === "fulfilled") {
        uiState.pomodoro = pomodoroResult.value as PomodoroState;
        syncNowTimerDisplay(uiState.pomodoro);
    }
    else {
        const message = pomodoroResult.reason instanceof Error ? pomodoroResult.reason.message : String(pomodoroResult.reason);
        refreshErrors.push(`get_pomodoro_state: ${message}`);
    }
    if (recipesResult.status === "fulfilled") {
        uiState.recipes = recipesResult.value as typeof uiState.recipes;
    }
    else {
        const message = recipesResult.reason instanceof Error ? recipesResult.reason.message : String(recipesResult.reason);
        refreshErrors.push(`list_recipes: ${message}`);
    }
    uiState.blocksVisibleCount = BLOCKS_INITIAL_VISIBLE;
    if (refreshErrors.length > 0) {
        setStatus(`refresh partially failed: ${refreshErrors.join(" | ")}`);
    }
}
async function authenticateAndSyncCalendar(date: string = uiState.dashboardDate || isoDate(new Date()), options: { forceReauth?: boolean; [key: string]: unknown; } = {}) {
    if (options.forceReauth && !isTauriRuntimeAvailable()) {
        throw new Error("SSO login requires the Tauri desktop runtime. Start it with `cd src-tauri && cargo tauri dev`.");
    }
    const normalizedDate = typeof date === "string" && date.trim() ? date.trim() : isoDate(new Date());
    uiState.dashboardDate = normalizedDate;
    uiState.auth = await invokeCommandWithProgress("authenticate_google_sso", withAccount({ force_reauth: Boolean(options.forceReauth) })) as UiState["auth"];
    const syncResult = await invokeCommandWithProgress("sync_calendar", withAccount(toSyncWindowPayload(normalizedDate, "week")));
    uiState.auth = {
        ...uiState.auth,
        synced_at: nowIso(),
        sync_result: syncResult as never,
    } as UiState["auth"];
    return { normalizedDate, syncResult };
}
async function refreshNowPanelState(includeReflection: boolean = false) {
    const operations = [safeInvoke("get_pomodoro_state"), safeInvoke("list_tasks")];
    if (includeReflection) {
        operations.push(safeInvoke("get_reflection_summary", {}));
    }
    const [pomodoroResult, tasksResult, reflectionResult] = (await Promise.allSettled(operations)) as PromiseSettledResult<unknown>[];
    if (pomodoroResult && pomodoroResult.status === "fulfilled") {
        uiState.pomodoro = pomodoroResult.value as PomodoroState;
        syncNowTimerDisplay(uiState.pomodoro);
    }
    if (tasksResult && tasksResult.status === "fulfilled") {
        uiState.tasks = tasksResult.value as Task[];
        syncNowTaskOrder(uiState.tasks);
    }
    if (includeReflection && reflectionResult?.status === "fulfilled") {
        uiState.reflection = reflectionResult.value as typeof uiState.reflection;
        uiState.nowUi.lastReflectionSyncEpochMs = Date.now();
    }
}
function buildPageRenderDeps(): PageRenderDeps {
    return {
        uiState,
        appRoot,
        services: commandService,
        setStatus,
        refreshCoreData,
        authenticateAndSyncCalendar,
        settingsPages,
        settingsPageLabels,
        commonHelpers: {
            normalizeAccountId,
            withAccount,
            isoDate,
            formatTime,
            formatHHmm,
            escapeHtml,
            blockDisplayName,
            blockTitle,
            toLocalInputValue,
            fromLocalInputValue,
            toSyncWindowPayload,
            isUnknownCommandError,
            toTimerText,
        },
        calendarHelpers: {
            renderDailyCalendar,
            bindDailyCalendarInteractions,
            blockRows,
            resetBlocksForDate,
            buildWeeklyPlannerModel,
            buildPlannerStripModel,
            renderWeeklyPlannerCalendar,
            renderSingleDayPlannerCalendar,
        },
        nowHelpers: {
            normalizePomodoroState,
            syncNowTimerDisplay,
            resolveNowBlocks,
            getNowOrderedTasks,
            resolveCurrentFocusTask,
            resolveNowAutoStartBlock,
            resolveNowAutoStartTask,
            pomodoroPhaseLabel,
            nowBufferAvailableMinutes,
            resolveTimerControlModel,
            executeTimerAction,
            syncNowTaskOrder,
            renderNowNotesPanel,
        },
        routineHelpers: {
            renderWeekStatusCard,
        },
        taskHelpers: {
            renderWeekTaskPanel,
        },
        renderers: {
            renderWeekPage: () => renderWeekPage(buildPageRenderDeps()),
            renderWeekDetailsPage: () => renderWeekDetailsPage(buildPageRenderDeps()),
            renderPomodoro: () => renderNowPage(buildPageRenderDeps()),
            renderRoutines: () => renderRoutinesPage(buildPageRenderDeps()),
            renderReflection: () => renderInsightsPage(buildPageRenderDeps()),
            renderSettings: () => renderSettingsPage(buildPageRenderDeps()),
            renderBlocks: () => renderBlocksPage(buildPageRenderDeps()),
        },
    };
}
const COMPACT_TOPBAR_BREAKPOINT_PX = 980;
function shouldUseNowHalfLayout() {
    return window.innerWidth <= COMPACT_TOPBAR_BREAKPOINT_PX;
}
function syncResponsiveRouteClasses(route: string) {
    document.body.classList.toggle("route-now-half", route === "now" && shouldUseNowHalfLayout());
}
function render() {
    const route = getRoute();
    const pageDeps = buildPageRenderDeps();
    const isWeekRoute = route === "week" || route === "week-details";
    markActiveRoute(route);
    document.body.classList.toggle("route-week", isWeekRoute);
    document.body.classList.toggle("route-now", route === "now");
    document.body.classList.toggle("route-routines", route === "routines");
    syncResponsiveRouteClasses(route);
    appRoot.classList.toggle("view-root--week", isWeekRoute);
    appRoot.classList.toggle("view-root--now", route === "now");
    appRoot.classList.toggle("view-root--routines", route === "routines");
    switch (route) {
        case "week":
            renderWeekPage(pageDeps);
            break;
        case "week-details":
            renderWeekDetailsPage(pageDeps);
            break;
        case "now":
            renderNowPage(pageDeps);
            break;
        case "routines":
            renderRoutinesPage(pageDeps);
            break;
        case "insights":
            renderInsightsPage(pageDeps);
            break;
        case "settings":
            renderSettingsPage(pageDeps);
            break;
        default:
            renderWeekPage(pageDeps);
    }
}
function renderWeekStatusCard() {
    return renderWeekStatusCardView({
        uiState,
        escapeHtml,
        blockTitle,
        formatHHmm,
        normalizePomodoroState,
        pomodoroPhaseLabel,
        pomodoroProgressPercent,
        resolveCurrentFocusTask,
        resolveTimerControlModel,
        toTimerText,
    });
}
function bindWeekTimerActions() {
    appRoot.querySelectorAll("[data-week-timer-action]").forEach((node) => {
        node.addEventListener("click", async (event: Event) => {
            const action = (event.currentTarget as HTMLElement | null)?.dataset.weekTimerAction;
            await executeTimerAction(action || "", () => renderWeekPage(buildPageRenderDeps()));
        });
    });
}
function refreshWeekSidebarPanels() {
    if (getRoute() !== "week") {
        return;
    }
    const statusPanel = appRoot.querySelector("[data-week-status-panel]");
    if (statusPanel instanceof HTMLElement) {
        statusPanel.innerHTML = renderWeekStatusCard();
    }
    const taskPanel = appRoot.querySelector("[data-week-task-panel]");
    if (taskPanel instanceof HTMLElement) {
        taskPanel.innerHTML = renderWeekTaskPanel();
    }
    bindWeekTimerActions();
}
function refreshWeekStatusTimerDisplay() {
    if (getRoute() !== "week") {
        return;
    }
    const statusTime = appRoot.querySelector("[data-week-status-time]");
    if (!(statusTime instanceof HTMLElement)) {
        return;
    }
    const state = normalizePomodoroState(uiState.pomodoro || {});
    const displayRemainingSeconds = uiState.nowUi.lastSyncEpochMs > 0
        ? Math.max(0, Math.floor(uiState.nowUi.displayRemainingSeconds || 0))
        : Math.max(0, Math.floor(state.remaining_seconds || 0));
    statusTime.textContent = toTimerText(displayRemainingSeconds);
}
function resolveTimerControlModel(stateInput: unknown = uiState.pomodoro) {
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
        leftIcon: "?",
        leftDisabled: controlsDisabled || !leftAction,
        rightAction,
        rightLabel: "Next",
        rightIcon: "?",
        rightDisabled: controlsDisabled || !rightAction,
        primaryAction,
        primaryLabel: primaryAction === "start" ? "開始" : primaryAction === "pause" ? "中断" : "再開",
        primaryIcon: primaryAction === "pause" ? "?" : "?",
        primaryDisabled: controlsDisabled ||
            !primaryAction ||
            (primaryAction === "start" && !canStart) ||
            (primaryAction === "pause" && !canPause) ||
            (primaryAction === "resume" && !canResume),
    };
}
async function executeTimerAction(action: string, rerender: () => void) {
    if (!action || uiState.nowUi.actionInFlight)
        return;
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
        }
        else if (action === "pause") {
            await safeInvokeWithFallback("pause_timer", { reason: "manual_pause" }, "pause_pomodoro", {
                reason: "manual_pause",
            });
        }
        else if (action === "resume") {
            await safeInvokeWithFallback("resume_timer", {}, "resume_pomodoro", {});
        }
        else if (action === "next") {
            await safeInvokeWithFallback("next_step", {}, "advance_pomodoro", {});
        }
        else if (action === "stop") {
            await safeInvokeWithFallback("pause_timer", { reason: "manual_stop" }, "pause_pomodoro", {
                reason: "manual_stop",
            });
        }
        else {
            shouldRefresh = false;
        }
        if (shouldRefresh) {
            await refreshNowPanelState(true);
        }
    });
    uiState.nowUi.actionInFlight = false;
    rerender();
}
function renderWeekTaskPanel() {
    return renderWeekTaskPanelView({
        uiState,
        normalizePomodoroState,
        resolveCurrentFocusTask,
        escapeHtml,
    });
}
function renderWeekTimelinePanel() {
    return renderWeekTimelinePanelView({
        uiState,
        blockTitle,
        formatHHmm,
        escapeHtml,
    });
}
function renderNowNotesPanel() {
    return renderNowNotesPanelView({
        uiState,
        normalizePomodoroState,
        resolveCurrentFocusTask,
        escapeHtml,
    });
}
function blockRows(blocks: Block[]) {
    return blockRowsValue(blocks, { blockDisplayName, formatTime });
}
function bindDailyCalendarInteractions(rerender: () => void) {
    bindDailyCalendarInteractionsValue({
        appRoot,
        rerender,
        dayBlockDragState,
        intervalRangeLabel: (interval) => intervalRangeLabel(interval),
        blockDisplayName,
        toClockText,
        getDashboardDate: () => uiState.dashboardDate,
        setStatus,
        setSelectedBlock: (blockId) => {
            uiState.dayCalendarSelection = { kind: "block", id: blockId };
        },
        setDayCalendarViewMode: (mode) => {
            uiState.dayCalendarViewMode = mode;
        },
        setDayCalendarSelection: (selection) => {
            uiState.dayCalendarSelection = selection;
        },
        setBlockTitle,
        runUiAction,
        safeInvoke,
        refreshCoreData,
    });
}
let appStarted = false;
export function startApp(): void {
    if (appStarted) {
        return;
    }
    appStarted = true;
    window.addEventListener("hashchange", () => {
        render();
    });
    window.addEventListener("resize", () => {
        const route = getRoute();
        syncResponsiveRouteClasses(route);
        if (route !== "week") {
            if (weekResizeRenderTimer) {
                clearTimeout(weekResizeRenderTimer);
                weekResizeRenderTimer = 0;
            }
            return;
        }
        if (weekResizeRenderTimer) {
            clearTimeout(weekResizeRenderTimer);
        }
        weekResizeRenderTimer = setTimeout(() => {
            weekResizeRenderTimer = 0;
            if (getRoute() === "week") {
                render();
            }
        }, WEEK_RESIZE_RENDER_MS);
    });
    setInterval(async () => {
        const route = getRoute();
        if (route !== "now" && route !== "week") {
            return;
        }
        try {
            const [pomodoroResult, tasksResult] = await Promise.allSettled([
                invokeCommand("get_pomodoro_state", {}),
                invokeCommand("list_tasks", {}),
            ]);
            if (pomodoroResult.status === "fulfilled") {
                uiState.pomodoro = pomodoroResult.value as PomodoroState;
                syncNowTimerDisplay(uiState.pomodoro);
            }
            if (tasksResult.status === "fulfilled") {
                uiState.tasks = tasksResult.value as Task[];
                syncNowTaskOrder(uiState.tasks);
            }
            if (route === "now") {
                renderNowPage(buildPageRenderDeps());
            }
            else {
                refreshWeekSidebarPanels();
            }
        }
        catch {
            // handled in safeInvoke
        }
    }, 5000);
    setInterval(() => {
        const route = getRoute();
        if (route !== "now" && route !== "week") {
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
            renderNowPage(buildPageRenderDeps());
        }
        else {
            refreshWeekStatusTimerDisplay();
        }
    }, 1000);
    void (async () => {
        if (!isTauriRuntimeAvailable()) {
            setStatus("mock mode: SSO requires `cd src-tauri && cargo tauri dev`");
        }
        try {
            await safeInvoke("bootstrap", {});
            const today = isoDate(new Date());
            try {
                await invokeCommandWithProgress("generate_today_blocks", withAccount({}));
            }
            catch (error) {
                if (!isUnknownCommandError(error)) {
                    throw error;
                }
                await invokeCommandWithProgress("generate_blocks", withAccount({ date: today }));
            }
            await refreshCoreData();
            uiState.reflection = await safeInvoke("get_reflection_summary", {}) as typeof uiState.reflection;
            uiState.nowUi.lastReflectionSyncEpochMs = Date.now();
        }
        catch {
            // handled in safeInvoke
        }
        if (!window.location.hash) {
            window.location.hash = "#/week";
        }
        render();
    })();
}











