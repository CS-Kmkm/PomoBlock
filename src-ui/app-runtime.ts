import { createCommandService, isUnknownCommandError as isUnknownCommandErrorValue } from "./services/command-service.js";
import { buildDailyCalendarModel as buildDailyCalendarModelValue, buildWeeklyPlannerModel as buildWeeklyPlannerModelValue, dayItemKey as dayItemKeyValue, invertTimelineIntervals as invertTimelineIntervalsValue, mergeTimelineIntervals as mergeTimelineIntervalsValue, minutesBetween as minutesBetweenValue, sumIntervalMinutes as sumIntervalMinutesValue, toClippedInterval as toClippedIntervalValue, toTimelineIntervals as toTimelineIntervalsValue, } from "./calendar-model.js";
import { renderDailyCalendar as renderDailyCalendarValue, renderDailyDetail as renderDailyDetailValue, renderGridDailyCalendar as renderGridDailyCalendarValue, renderSimpleDailyCalendar as renderSimpleDailyCalendarValue, renderWeeklyPlannerCalendar as renderWeeklyPlannerCalendarValue, } from "./calendar-render.js";
import type { DayCalendarModel } from "./calendar-render.js";
import { getById } from "./dom.js";
import { blockDurationMinutes as blockDurationMinutesValue, blockPomodoroTarget as blockPomodoroTargetValue, getNowOrderedTasks as getNowOrderedTasksValue, normalizePomodoroState as normalizePomodoroStateValue, nowBufferAvailableMinutes as nowBufferAvailableMinutesValue, pomodoroPhaseLabel as pomodoroPhaseLabelValue, pomodoroProgressPercent as pomodoroProgressPercentValue, resolveCurrentFocusTask as resolveCurrentFocusTaskValue, resolveNowAutoStartBlock as resolveNowAutoStartBlockValue, resolveNowAutoStartTask as resolveNowAutoStartTaskValue, resolveNowBlocks as resolveNowBlocksValue, resolveNowDayBounds as resolveNowDayBoundsValue, syncNowTaskOrder as syncNowTaskOrderValue, syncNowTimerDisplay as syncNowTimerDisplayValue, } from "./now.js";
import { formatHHmm as formatHHmmValue, formatTime as formatTimeValue, fromLocalInputValue as fromLocalInputValueValue, isoDate as isoDateValue, nowIso as nowIsoValue, resolveDayBounds as resolveDayBoundsValue, resolveWeekBounds as resolveWeekBoundsValue, resolveWeekDateKeys as resolveWeekDateKeysValue, toLocalInputValue as toLocalInputValueValue, toSyncWindowPayload as toSyncWindowPayloadValue, toTimerText as toTimerTextValue, } from "./time.js";
import { renderBlocksPage } from "./pages/blocks-page.js";
import { renderDetailsPage } from "./pages/details-page.js";
import { renderInsightsPage } from "./pages/insights-page.js";
import { renderNowPage } from "./pages/now-page.js";
import { renderRoutinesPage } from "./pages/routines-page.js";
import { renderSettingsPage } from "./pages/settings-page.js";
import { renderTodayPage } from "./pages/today-page.js";
import { intervalRangeLabel as intervalRangeLabelValue, toClockText as toClockTextValue, toDurationLabel as toDurationLabelValue } from "./calendar-view-helpers.js";
import { bindDailyCalendarInteractions as bindDailyCalendarInteractionsValue, blockRows as blockRowsValue } from "./day-calendar-bindings.js";
import { renderTodayAmbientPanel as renderTodayAmbientPanelView, renderTodayLibraryLinks as renderTodayLibraryLinksView, renderTodayNotesPanel as renderTodayNotesPanelView, renderTodaySequenceItems as renderTodaySequenceItemsView, renderTodayStatusCard as renderTodayStatusCardView, renderTodayTaskPanel as renderTodayTaskPanelView, renderTodayTimelinePanel as renderTodayTimelinePanelView, } from "./today-renderers.js";
import type { Block, DayBlockDragState, JsonObject, MockState, Module, PageRenderDeps, PomodoroState, ProgressState, Recipe, Task, UiState, } from "./types.js";
const appRoot = getById<HTMLElement>("app") as HTMLElement;
const statusChip = getById<HTMLElement>("global-status");
const progressChip = getById<HTMLElement>("global-progress");
const progressLabel = getById<HTMLElement>("global-progress-label");
const progressFill = getById<HTMLElement>("global-progress-fill");
const progressValue = getById<HTMLElement>("global-progress-value");
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
const progressTargetPercent = 92;
const progressUpdateIntervalMs = 180;
const BLOCKS_INITIAL_VISIBLE = 50;
const BLOCK_TITLE_STORAGE_KEY = "pomo_block_titles_v1";
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
const routineStudioContexts = ["Work - Deep Focus", "Admin", "Planning", "Learning", "Personal"];
const routineStudioMacroTargets = [30, 45, 60, 90];
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
    if (mockState.modules.length > 0)
        return;
    mockState.modules = routineStudioSeedModules.map((module) => ({
        ...module,
        checklist: Array.isArray(module.checklist) ? [...module.checklist] : [],
        pomodoro: module.pomodoro ? { ...module.pomodoro } : null,
        executionHints: module.executionHints ? { ...module.executionHints } : null,
    }));
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
function renderWeeklyPlannerCalendar(model: unknown) {
    return renderWeeklyPlannerCalendarValue(model as Parameters<typeof renderWeeklyPlannerCalendarValue>[0] & {
        days: Array<{
            isCurrent: boolean;
            dayNumber: string;
            weekdayLabel: string;
            combinedItems: Array<Record<string, unknown> & { kind: string; }>;
            dayStartMs: number;
            dayEndMs: number;
        }>;
        selectedItem: { key?: string; } | null;
    }, {
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
        renderSimpleDailyCalendar: (calendarModel, renderOptions) => renderSimpleDailyCalendarValue(calendarModel, renderOptions, {
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
    const routeAlias = {
        dashboard: "today",
        manage: "details",
        detail: "details",
        blocks: "today",
        tasks: "today",
        pomodoro: "now",
        reflection: "insights",
    };
    const safeRoot = root ?? "";
    const normalized = routeAlias[safeRoot as keyof typeof routeAlias] || safeRoot;
    return routes.includes(normalized) ? normalized : "today";
}
function markActiveRoute(route: string) {
    document.querySelectorAll("a[data-route]").forEach((node) => {
        const anchor = node as HTMLAnchorElement;
        if (anchor.dataset.route === route) {
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
async function mockInvoke(name: string, payload: Record<string, unknown>) {
    const args = toRecord(payload);
    switch (name) {
        case "bootstrap":
            return { workspace_root: "mock", database_path: "mock.sqlite" };
        case "authenticate_google": {
            const accountId = normalizeAccountId(args.account_id);
            return {
                account_id: accountId,
                status: args.authorization_code ? "authenticated" : "reauthentication_required",
                authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
                expires_at: new Date(Date.now() + 3600000).toISOString(),
            };
        }
        case "authenticate_google_sso": {
            throw new Error("Google SSO is unavailable in mock mode. Run the desktop app with `cargo tauri dev`.");
        }
        case "sync_calendar": {
            const accountId = normalizeAccountId(args.account_id);
            const seed = typeof args.time_min === "string" ? args.time_min : nowIso();
            const parsed = new Date(seed);
            const dayStart = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
            dayStart.setHours(0, 0, 0, 0);
            const morningStart = new Date(dayStart.getTime() + 10 * 60 * 60 * 1000);
            const morningEnd = new Date(morningStart.getTime() + 30 * 60 * 1000);
            const afternoonStart = new Date(dayStart.getTime() + 14 * 60 * 60 * 1000);
            const afternoonEnd = new Date(afternoonStart.getTime() + 60 * 60 * 1000);
            mockState.syncedEventsByAccount[accountId] = [
                {
                    account_id: accountId,
                    id: nextMockId("evt"),
                    title: "Mock Event A",
                    start_at: morningStart.toISOString(),
                    end_at: morningEnd.toISOString(),
                },
                {
                    account_id: accountId,
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
            const payloadRecipe = readNestedPayload(args);
            if (!payloadRecipe?.id) {
                throw new Error("recipe id is required");
            }
            if (mockState.recipes.some((recipe) => recipe.id === payloadRecipe.id)) {
                throw new Error("recipe already exists");
            }
            const recipe: Recipe = {
                id: String(payloadRecipe.id),
                name: String(payloadRecipe.name || payloadRecipe.id),
                auto_drive_mode: String(payloadRecipe.autoDriveMode || payloadRecipe.auto_drive_mode || "manual"),
                steps: Array.isArray(payloadRecipe.steps) ? payloadRecipe.steps : [],
            };
            const studioMeta = toJsonObject(payloadRecipe.studioMeta || payloadRecipe.studio_meta || null);
            if (studioMeta) {
                recipe.studioMeta = studioMeta;
            }
            mockState.recipes.push(recipe);
            return recipe;
        }
        case "update_recipe": {
            ensureMockRecipesSeeded();
            const payloadRecipe = readNestedPayload(args);
            const recipeId = readString(args, "recipe_id").trim();
            if (!recipeId)
                throw new Error("recipe_id is required");
            const index = mockState.recipes.findIndex((recipe) => recipe.id === recipeId);
            if (index < 0)
                throw new Error("recipe not found");
            const baseRecipe = mockState.recipes[index]!;
            const updated: Recipe = {
                ...baseRecipe,
                id: recipeId,
                name: baseRecipe.name,
                steps: baseRecipe.steps,
            };
            if (typeof payloadRecipe.name === "string") {
                updated.name = payloadRecipe.name;
            }
            if (typeof payloadRecipe.auto_drive_mode === "string") {
                updated.auto_drive_mode = payloadRecipe.auto_drive_mode;
            }
            else if (typeof payloadRecipe.autoDriveMode === "string") {
                updated.auto_drive_mode = payloadRecipe.autoDriveMode;
            }
            if (Array.isArray(payloadRecipe.steps)) {
                updated.steps = payloadRecipe.steps as Recipe["steps"];
            }
            const studioMeta = toJsonObject(payloadRecipe.studioMeta || payloadRecipe.studio_meta || null);
            if (studioMeta) {
                updated.studioMeta = studioMeta;
            }
            mockState.recipes[index] = updated;
            return updated;
        }
        case "delete_recipe": {
            ensureMockRecipesSeeded();
            const recipeId = readString(args, "recipe_id").trim();
            const before = mockState.recipes.length;
            mockState.recipes = mockState.recipes.filter((recipe) => recipe.id !== recipeId);
            return before !== mockState.recipes.length;
        }
        case "list_modules":
            ensureMockModulesSeeded();
            return [...mockState.modules];
        case "create_module": {
            ensureMockModulesSeeded();
            const payloadModule = readNestedPayload(args);
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
            const moduleId = readString(args, "module_id").trim();
            if (!moduleId)
                throw new Error("module_id is required");
            const payloadModule = readNestedPayload(args);
            const index = mockState.modules.findIndex((module) => module.id === moduleId);
            if (index < 0)
                throw new Error("module not found");
            const baseModule = mockState.modules[index]!;
            const updated: Module = {
                ...baseModule,
                id: moduleId,
                name: baseModule.name,
            };
            if (typeof payloadModule.name === "string") {
                updated.name = payloadModule.name;
            }
            if (typeof payloadModule.category === "string") {
                updated.category = payloadModule.category;
            }
            if (typeof payloadModule.description === "string") {
                updated.description = payloadModule.description;
            }
            if (typeof payloadModule.icon === "string") {
                updated.icon = payloadModule.icon;
            }
            if (typeof payloadModule.stepType === "string") {
                updated.stepType = payloadModule.stepType;
            }
            else if (typeof payloadModule.step_type === "string") {
                updated.stepType = payloadModule.step_type;
            }
            if (Array.isArray(payloadModule.checklist)) {
                updated.checklist = payloadModule.checklist.map(String).filter(Boolean);
            }
            if (payloadModule.pomodoro === null) {
                updated.pomodoro = null;
            }
            else if (toJsonObject(payloadModule.pomodoro)) {
                updated.pomodoro = { ...toJsonObject(payloadModule.pomodoro) };
            }
            if (typeof payloadModule.overrunPolicy === "string") {
                updated.overrunPolicy = payloadModule.overrunPolicy;
            }
            else if (typeof payloadModule.overrun_policy === "string") {
                updated.overrunPolicy = payloadModule.overrun_policy;
            }
            if (payloadModule.executionHints === null) {
                updated.executionHints = null;
            }
            else if (toJsonObject(payloadModule.executionHints)) {
                updated.executionHints = { ...toJsonObject(payloadModule.executionHints) };
            }
            const durationMinutesSnake = payloadModule["duration_minutes"];
            const rawDuration = typeof updated.durationMinutes === "number"
                ? updated.durationMinutes
                : typeof durationMinutesSnake === "number"
                    ? durationMinutesSnake
                    : 1;
            updated.durationMinutes = Math.max(1, Number(rawDuration));
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
            const moduleId = readString(args, "module_id").trim();
            const before = mockState.modules.length;
            mockState.modules = mockState.modules.filter((module) => module.id !== moduleId);
            return before !== mockState.modules.length;
        }
        case "apply_studio_template_to_today": {
            ensureMockRecipesSeeded();
            const templateId = readString(args, "template_id").trim();
            const date = readString(args, "date", isoDate(new Date()));
            const triggerTime = readString(args, "trigger_time", "09:00");
            const recipe = mockState.recipes.find((entry) => entry.id === templateId);
            if (!recipe)
                throw new Error("template not found");
            const meta = (recipe.studioMeta || recipe.studio_meta || null) as Record<string, unknown> | null;
            if (!meta || Number(meta.version) !== 1 || String(meta.kind || "").toLowerCase() !== "routine_studio") {
                throw new Error("template is not a routine studio template");
            }
            const totalSeconds = (Array.isArray(recipe.steps) ? recipe.steps : []).reduce((sum, step) => sum + Math.max(60, Number((step as Record<string, unknown>)?.durationSeconds || (step as Record<string, unknown>)?.duration_seconds || 0)), 0);
            if (totalSeconds <= 0)
                throw new Error("template has no duration");
            const [hhRaw, mmRaw] = triggerTime.split(":").map((entry) => Number(entry || 0));
            const hh = Number.isFinite(hhRaw) ? Number(hhRaw) : 9;
            const mm = Number.isFinite(mmRaw) ? Number(mmRaw) : 0;
            const requestedStart = new Date(`${date}T00:00:00`);
            requestedStart.setHours(hh, mm, 0, 0);
            const requestedEnd = new Date(requestedStart.getTime() + totalSeconds * 1000);
            const busyIntervals: Array<{ startMs: number; endMs: number }> = [];
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
            const overlaps = (leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) => leftStart < rightEnd && rightStart < leftEnd;
            const requestedStartMs = requestedStart.getTime();
            const requestedEndMs = requestedEnd.getTime();
            const conflictCount = busyIntervals.filter((interval) => overlaps(requestedStartMs, requestedEndMs, interval.startMs, interval.endMs)).length;
            let appliedStartMs = requestedStartMs;
            let appliedEndMs = requestedEndMs;
            let shifted = false;
            if (conflictCount > 0) {
                const sorted = busyIntervals
                    .filter((interval) => Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs) && interval.endMs > interval.startMs)
                    .sort((left, right) => left.startMs - right.startMs);
                let cursor = requestedStartMs;
                for (const interval of sorted) {
                    if (cursor + totalSeconds * 1000 <= interval.startMs)
                        break;
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
                title: readString(args, "title", "New Task"),
                description: typeof args.description === "string" ? args.description : null,
                estimated_pomodoros: typeof args.estimated_pomodoros === "number" ? args.estimated_pomodoros : null,
                completed_pomodoros: 0,
                status: "pending",
                created_at: nowIso(),
            };
            mockState.tasks.push(task);
            return task;
        }
        case "update_task": {
            const taskId = readString(args, "task_id");
            const task = mockState.tasks.find((item) => item.id === taskId);
            if (!task)
                throw new Error("task not found");
            if (typeof args.title === "string")
                task.title = args.title;
            if (typeof args.description === "string")
                task.description = args.description || null;
            if (typeof args.status === "string")
                task.status = args.status;
            if (typeof args.estimated_pomodoros === "number")
                task.estimated_pomodoros = args.estimated_pomodoros;
            return { ...task };
        }
        case "delete_task":
            unassignMockTask(readString(args, "task_id"));
            mockState.tasks = mockState.tasks.filter((item) => item.id !== readString(args, "task_id"));
            return true;
        case "split_task": {
            const parts = Number(args.parts ?? 0);
            if (!Number.isInteger(parts) || parts < 2) {
                throw new Error("parts must be >= 2");
            }
            const parent = mockState.tasks.find((item) => item.id === readString(args, "task_id"));
            if (!parent)
                throw new Error("task not found");
            const estimated = parent.estimated_pomodoros;
            const childEstimate = typeof estimated === "number" ? Math.max(1, Math.ceil(estimated / parts)) : null;
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
            const taskId = readString(args, "task_id").trim();
            const fromBlockId = readString(args, "from_block_id").trim();
            if (!taskId || !fromBlockId) {
                throw new Error("task_id and from_block_id are required");
            }
            const task = mockState.tasks.find((item) => item.id === taskId);
            if (!task)
                throw new Error("task not found");
            const fromBlock = mockState.blocks.find((item) => item.id === fromBlockId);
            if (!fromBlock)
                throw new Error("block not found");
            const requested = readStringArray(args, "candidate_block_ids");
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
            const date = readString(args, "date") || null;
            const blocks = date
                ? mockState.blocks.filter((block) => block.date === date)
                : mockState.blocks;
            return [...blocks];
        }
        case "list_synced_events": {
            const accountId = normalizeAccountId(args.account_id);
            const timeMin = new Date(readString(args, "time_min", "1970-01-01T00:00:00.000Z")).getTime();
            const timeMax = new Date(readString(args, "time_max", "2999-12-31T23:59:59.000Z")).getTime();
            const entries = args.account_id == null
                ? Object.entries(mockState.syncedEventsByAccount).flatMap(([entryAccountId, events]) => events.map((event) => ({ ...event, account_id: entryAccountId })))
                : (mockState.syncedEventsByAccount[accountId] || []).map((event) => ({
                    ...event,
                    account_id: accountId,
                }));
            return entries
                .filter((event) => {
                const startMs = new Date(event.start_at).getTime();
                const endMs = new Date(event.end_at).getTime();
                if (!Number.isFinite(startMs) || !Number.isFinite(endMs))
                    return false;
                return endMs > timeMin && startMs < timeMax;
            })
                .sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime());
        }
        case "generate_today_blocks":
            return mockInvoke("generate_blocks", { ...args, date: readString(args, "date", isoDate(new Date())) });
        case "generate_blocks":
        case "generate_one_block": {
            ensureMockRecipesSeeded();
            const date = readString(args, "date", isoDate(new Date()));
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
            mockState.blocks = mockState.blocks.map((block) => readStringArray(args, "block_ids").includes(block.id) ? { ...block, firmness: "soft" } : block);
            return mockState.blocks.filter((block) => readStringArray(args, "block_ids").includes(block.id));
        case "delete_block":
            if (mockState.taskAssignmentsByBlock[readString(args, "block_id")]) {
                const taskId = mockState.taskAssignmentsByBlock[readString(args, "block_id")];
                delete mockState.taskAssignmentsByBlock[readString(args, "block_id")];
                if (taskId) {
                    delete mockState.taskAssignmentsByTask[taskId];
                }
            }
            mockState.blocks = mockState.blocks.filter((block) => block.id !== readString(args, "block_id"));
            return true;
        case "adjust_block_time":
            mockState.blocks = mockState.blocks.map((block) => block.id === readString(args, "block_id")
                ? { ...block, start_at: readString(args, "start_at"), end_at: readString(args, "end_at") }
                : block);
            return mockState.blocks.find((block) => block.id === readString(args, "block_id"));
        case "start_block_timer":
        case "start_pomodoro":
            if (typeof args.task_id === "string" && args.task_id) {
                assignMockTask(args.task_id, readString(args, "block_id"));
                const task = mockState.tasks.find((item) => item.id === args.task_id);
                if (task && task.status !== "completed") {
                    task.status = "in_progress";
                }
            }
            const targetBlock = mockState.blocks.find((block) => block.id === readString(args, "block_id"));
            const plan = targetBlock
                ? mockSessionPlan(targetBlock)
                : { totalCycles: 1, focusSeconds: 25 * 60, breakSeconds: 5 * 60 };
            mockState.pomodoro = {
                current_block_id: readString(args, "block_id"),
                current_task_id: typeof args.task_id === "string" ? args.task_id : null,
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
            }
            else if (mockState.pomodoro.phase === "break") {
                if ((mockState.pomodoro.completed_cycles || 0) >= totalCycles) {
                    mockState.pomodoro = {
                        ...emptyMockPomodoroState(),
                    };
                }
                else {
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
                block_id: mockState.pomodoro.current_block_id ?? "-",
                task_id: mockState.pomodoro.current_task_id,
                phase: "focus",
                start_time: nowIso(),
                end_time: nowIso(),
                interruption_reason: readString(args, "reason", "paused"),
            });
            return { ...mockState.pomodoro };
        case "resume_timer":
        case "resume_pomodoro":
            mockState.pomodoro = { ...mockState.pomodoro, phase: "focus" };
            return { ...mockState.pomodoro };
        case "interrupt_timer":
            appendMockPomodoroLog(mockState.pomodoro.phase || "focus", readString(args, "reason", "interrupted"));
            mockState.pomodoro = {
                ...emptyMockPomodoroState(),
            };
            return { ...mockState.pomodoro };
        case "complete_pomodoro":
            mockState.pomodoro = {
                ...emptyMockPomodoroState(),
            };
            return { ...mockState.pomodoro };
        case "get_pomodoro_state":
            return { ...mockState.pomodoro };
        case "relocate_if_needed": {
            const accountId = normalizeAccountId(args.account_id);
            const block = mockState.blocks.find((item) => item.id === readString(args, "block_id"));
            if (!block)
                throw new Error("block not found");
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
                start: readString(args, "start", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()),
                end: readString(args, "end", nowIso()),
                completed_count: 1,
                interrupted_count: mockState.logs.length,
                total_focus_minutes: 42,
                logs: [...mockState.logs],
            };
        default:
            throw new Error(`mock command not implemented: ${name}`);
    }
}
async function refreshCoreData(date: string = isoDate(new Date())) {
    const normalizedDate = typeof date === "string" && date.trim() ? date.trim() : isoDate(new Date());
    const syncWindow = toSyncWindowPayload(normalizedDate, "week");
    const weekDateKeys = resolveWeekDateKeys(normalizedDate);
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
    const syncResult = await invokeCommandWithProgress("sync_calendar", withAccount(toSyncWindowPayload(normalizedDate)));
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
            renderWeeklyPlannerCalendar,
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
        },
        routineHelpers: {
            renderTodaySequenceItems,
            renderTodayLibraryLinks,
            renderTodayStatusCard,
            renderTodayNotesPanel,
            renderTodayAmbientPanel,
        },
        taskHelpers: {
            renderTodayTaskPanel,
        },
        renderers: {
            renderDashboard: () => renderTodayPage(buildPageRenderDeps()),
            renderTodayDetailsPage: () => renderDetailsPage(buildPageRenderDeps()),
            renderPomodoro: () => renderNowPage(buildPageRenderDeps()),
            renderRoutines: () => renderRoutinesPage(buildPageRenderDeps()),
            renderReflection: () => renderInsightsPage(buildPageRenderDeps()),
            renderSettings: () => renderSettingsPage(buildPageRenderDeps()),
            renderBlocks: () => renderBlocksPage(buildPageRenderDeps()),
        },
    };
}
function render() {
    const route = getRoute();
    const pageDeps = buildPageRenderDeps();
    markActiveRoute(route);
    document.body.classList.toggle("route-today", route === "today");
    document.body.classList.toggle("route-now", route === "now");
    document.body.classList.toggle("route-routines", route === "routines");
    appRoot.classList.toggle("view-root--today", route === "today");
    appRoot.classList.toggle("view-root--now", route === "now");
    appRoot.classList.toggle("view-root--routines", route === "routines");
    switch (route) {
        case "today":
            renderTodayPage(pageDeps);
            break;
        case "details":
            renderDetailsPage(pageDeps);
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
            renderTodayPage(pageDeps);
    }
}
function renderTodaySequenceItems() {
    return renderTodaySequenceItemsView({ uiState, escapeHtml });
}
function renderTodayLibraryLinks() {
    return renderTodayLibraryLinksView();
}
function renderTodayStatusCard() {
    return renderTodayStatusCardView({
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
function refreshTodayStatusTimerDisplay() {
    if (getRoute() !== "today") {
        return;
    }
    const statusTime = appRoot.querySelector("[data-today-status-time]");
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
function renderTodayTaskPanel() {
    return renderTodayTaskPanelView({
        uiState,
        normalizePomodoroState,
        resolveCurrentFocusTask,
        escapeHtml,
    });
}
function renderTodayTimelinePanel() {
    return renderTodayTimelinePanelView({
        uiState,
        blockTitle,
        formatHHmm,
        escapeHtml,
    });
}
function renderTodayNotesPanel() {
    return renderTodayNotesPanelView({
        uiState,
        normalizePomodoroState,
        resolveCurrentFocusTask,
        escapeHtml,
    });
}
function renderTodayAmbientPanel() {
    return renderTodayAmbientPanelView();
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
                renderTodayPage(buildPageRenderDeps());
            }
        }
        catch {
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
            renderNowPage(buildPageRenderDeps());
        }
        else {
            refreshTodayStatusTimerDisplay();
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
            window.location.hash = "#/today";
        }
        render();
    })();
}









