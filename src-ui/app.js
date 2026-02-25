// @ts-check

const appRoot = /** @type {HTMLElement} */ (document.getElementById("app"));
const statusChip = /** @type {HTMLElement} */ (document.getElementById("global-status"));
const progressChip = /** @type {HTMLElement | null} */ (document.getElementById("global-progress"));
const progressLabel = /** @type {HTMLElement | null} */ (document.getElementById("global-progress-label"));
const progressFill = /** @type {HTMLElement | null} */ (document.getElementById("global-progress-fill"));
const progressValue = /** @type {HTMLElement | null} */ (document.getElementById("global-progress-value"));

const routes = ["dashboard", "blocks", "pomodoro", "tasks", "reflection", "settings"];
const settingsPages = ["blocks", "git", "auth"];
const settingsPageLabels = {
  blocks: "ブロック構成",
  git: "Git同期",
  auth: "Google Auth",
};
const longRunningCommands = new Set(["sync_calendar", "generate_blocks", "authenticate_google_sso"]);
const longRunningLabels = {
  sync_calendar: "カレンダー同期",
  generate_blocks: "ブロック生成",
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

/** @typedef {{id:string,date:string,start_at:string,end_at:string,firmness:string,instance:string,planned_pomodoros:number,source:string,source_id:string|null}} Block */
/** @typedef {{account_id:string,id:string,title:string,start_at:string,end_at:string}} SyncedEvent */
/** @typedef {{id:string,title:string,description:string|null,estimated_pomodoros:number|null,status:string,completed_pomodoros:number}} Task */
/** @typedef {{current_block_id:string|null,current_task_id:string|null,phase:string,remaining_seconds:number,start_time:string|null,total_cycles:number,completed_cycles:number,current_cycle:number}} PomodoroState */
/** @typedef {"block" | "event" | "free"} DayItemKind */
/** @typedef {{kind: DayItemKind, id: string} | null} DayItemSelection */
/** @typedef {"grid" | "simple"} DayCalendarViewMode */

/** @type {{auth: any, accountId: string, dashboardDate: string, blocks: Block[], blocksVisibleCount: number, calendarEvents: SyncedEvent[], tasks: Task[], pomodoro: PomodoroState|null, reflection: any|null, dayCalendarSelection: DayItemSelection, dayCalendarViewMode: DayCalendarViewMode, settings: any}} */
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
  dayCalendarSelection: null,
  dayCalendarViewMode: "grid",
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
  originClientY: 0,
  originStartMs: 0,
  originEndMs: 0,
  previewStartMs: 0,
  previewEndMs: 0,
  suppressClickUntil: 0,
  originalTopCss: "",
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
  const date =
    typeof block?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(block.date)
      ? block.date
      : isoDate(new Date(block?.start_at || Date.now()));
  return `${formatHHmm(block?.start_at)}-${formatHHmm(block?.end_at)}_${date}`;
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

function resolveDayBounds(dateValue) {
  const parsed = new Date(`${dateValue}T00:00:00`);
  const dayStart = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
}

function toSyncWindowPayload(dateValue) {
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

function withAccount(payload = {}) {
  return {
    ...payload,
    account_id: normalizeAccountId(uiState.accountId),
  };
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
    dayBlockDragState.entry.style.removeProperty("z-index");
    dayBlockDragState.entry.title = dayBlockDragState.originalTitle;
    if (dayBlockDragState.timeLabel) {
      dayBlockDragState.timeLabel.textContent = dayBlockDragState.originalTimeLabelText;
    }
  }
}

async function commitDayBlockMove(rerender) {
  const blockId = dayBlockDragState.blockId;
  if (!blockId) return;
  const finalStartMs = dayBlockDragState.previewStartMs;
  const finalEndMs = dayBlockDragState.previewEndMs;
  const unchanged =
    Math.abs(finalStartMs - dayBlockDragState.originStartMs) < 1000 &&
    Math.abs(finalEndMs - dayBlockDragState.originEndMs) < 1000;
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
  dayBlockDragState.originClientY = 0;
  dayBlockDragState.originStartMs = 0;
  dayBlockDragState.originEndMs = 0;
  dayBlockDragState.previewStartMs = 0;
  dayBlockDragState.previewEndMs = 0;
  dayBlockDragState.originalTopCss = "";
  dayBlockDragState.originalTimeLabelText = "";
  dayBlockDragState.originalTitle = "";
  dayBlockDragState.hoveredFreeEntry = null;
  dayBlockDragState.entry = null;
  dayBlockDragState.timeLabel = null;

  if (shouldCommit) {
    void commitDayBlockMove(rerender);
  }
}

function applyDayBlockPreview(entry, interval) {
  if (!dayBlockDragState.rangeMs || dayBlockDragState.rangeMs <= 0) return;
  dayBlockDragState.previewStartMs = interval.startMs;
  dayBlockDragState.previewEndMs = interval.endMs;
  const topPercent = ((interval.startMs - dayBlockDragState.dayStartMs) / dayBlockDragState.rangeMs) * 100;
  entry.style.top = `${topPercent}%`;
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

function buildDailyCalendarModel(dateValue, blocks, events) {
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
  const selectedByState = uiState.dayCalendarSelection
    ? itemMap.get(dayItemKey(uiState.dayCalendarSelection.kind, uiState.dayCalendarSelection.id))
    : null;
  const selectedItem = selectedByState || blockItems[0] || eventItems[0] || freeItems[0] || null;
  uiState.dayCalendarSelection = selectedItem
    ? {
        kind: selectedItem.kind,
        id: selectedItem.id,
      }
    : null;

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

function renderDayLane(label, kind, items, dayStartMs, dayEndMs, selectedItem) {
  const entries = renderDayLaneItems(kind, items, dayStartMs, dayEndMs, selectedItem);
  const hint = kind === "block" ? " / ドラッグで移動（勤務時間外も可）" : "";
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
      return `
        <button
          type="button"
          class="day-simple-segment day-simple-segment-${kind} ${selectedClass}"
          style="left:${left}%;width:${width}%"
          data-day-item-kind="${kind}"
          data-day-item-id="${escapeHtml(item.id)}"
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

function renderSimpleDailyCalendar(model) {
  return `
    <div class="day-view-simple">
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
      ${renderDailyDetail(model.selectedItem)}
    </div>
  `;
}

function renderGridDailyCalendar(model) {
  return `
    <div class="day-view-grid">
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
      ${renderDailyDetail(model.selectedItem)}
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
    return `
      <div class="day-detail panel">
        <h4>ブロック詳細</h4>
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

function renderDailyCalendar(dateValue) {
  const model = buildDailyCalendarModel(dateValue, uiState.blocks, uiState.calendarEvents);
  const mode = uiState.dayCalendarViewMode === "simple" ? "simple" : "grid";
  return `
    <div class="panel day-calendar">
      <div class="row spread">
        <h3>1日の時間ビュー</h3>
        <span class="small">${escapeHtml(dateValue)} / ${timezoneOffsetLabel()}</span>
      </div>
      <div class="calendar-metrics">
        <span class="pill calendar-pill block">ブロック ${toDurationLabel(model.totals.blockMinutes)}</span>
        <span class="pill calendar-pill event">予定 ${toDurationLabel(model.totals.eventMinutes)}</span>
        <span class="pill calendar-pill free">空き ${toDurationLabel(model.totals.freeMinutes)}</span>
      </div>
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
      ${mode === "simple" ? renderSimpleDailyCalendar(model) : renderGridDailyCalendar(model)}
    </div>
  `;
}

function setStatus(message) {
  statusChip.textContent = message;
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

  return routes.includes(root) ? root : "dashboard";
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
  const focusSeconds = 25 * 60;
  const breakSeconds = Math.max(60, Math.floor((uiState.settings.breakDuration || 5) * 60));
  const cycleSeconds = Math.max(1, focusSeconds + breakSeconds);
  const blockSeconds = Math.max(0, blockDurationMinutes(block) * 60);
  const maxCyclesByDuration = Math.max(1, Math.floor(blockSeconds / cycleSeconds));
  const totalCycles = Math.max(1, Math.min(requestedCycles, maxCyclesByDuration));
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
    case "generate_blocks":
    case "generate_one_block": {
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
          block_type: "deep",
          firmness: "draft",
          planned_pomodoros: 2,
          source: "routine",
          source_id: "mock",
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
    case "resume_pomodoro":
      mockState.pomodoro = { ...mockState.pomodoro, phase: "focus" };
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
  const syncWindow = toSyncWindowPayload(normalizedDate);
  uiState.dashboardDate = normalizedDate;
  const [tasksResult, blocksResult, calendarEventsResult, pomodoroResult] = await Promise.allSettled([
    safeInvoke("list_tasks"),
    safeInvoke("list_blocks", { date: normalizedDate }),
    safeInvoke("list_synced_events", withAccount(syncWindow)),
    safeInvoke("get_pomodoro_state"),
  ]);
  const refreshErrors = [];
  if (tasksResult.status === "fulfilled") {
    uiState.tasks = tasksResult.value;
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
  } else {
    const message = pomodoroResult.reason instanceof Error ? pomodoroResult.reason.message : String(pomodoroResult.reason);
    refreshErrors.push(`get_pomodoro_state: ${message}`);
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

function render() {
  const route = getRoute();
  markActiveRoute(route);

  switch (route) {
    case "dashboard":
      renderDashboard();
      break;
    case "blocks":
      renderBlocks();
      break;
    case "pomodoro":
      renderPomodoro();
      break;
    case "tasks":
      renderTasks();
      break;
    case "reflection":
      renderReflection();
      break;
    case "settings":
      renderSettings();
      break;
    default:
      renderDashboard();
  }
}

function dashboardMetrics() {
  const draft = uiState.blocks.filter((block) => block.firmness === "draft").length;
  const soft = uiState.blocks.filter((block) => block.firmness === "soft").length;
  return `
    <div class="panel metric"><span class="small">Today Blocks</span><b>${uiState.blocks.length}</b></div>
    <div class="panel metric"><span class="small">Draft</span><b>${draft}</b></div>
    <div class="panel metric"><span class="small">Approved</span><b>${soft}</b></div>
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
      dayBlockDragState.originClientY = pointerEvent.clientY;
      dayBlockDragState.originStartMs = itemStartMs;
      dayBlockDragState.originEndMs = itemEndMs;
      dayBlockDragState.previewStartMs = itemStartMs;
      dayBlockDragState.previewEndMs = itemEndMs;
      dayBlockDragState.entry = entry;
      dayBlockDragState.timeLabel = entry.querySelector(".day-entry-time");
      dayBlockDragState.originalTopCss = entry.style.top || "0%";
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
            const nextInterval = clampBlockIntervalToDay(
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
          const snappedDeltaMs = snapToMinutes(deltaMsRaw, DAY_BLOCK_DRAG_SNAP_MINUTES);
          const nextInterval = clampBlockIntervalToDay(
            dayBlockDragState.originStartMs + snappedDeltaMs,
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
}

function renderDashboard() {
  const fallbackDate = isoDate(new Date());
  const selectedDate = uiState.dashboardDate || fallbackDate;
  appRoot.innerHTML = `
    <section class="view-head">
      <div>
        <h2>ダッシュボード</h2>
        <p>同期状況・日次ブロック生成・本日の状況を確認します。</p>
      </div>
      <label>日付 <input id="dashboard-date" type="date" value="${selectedDate}" /></label>
      <label>Account <input id="dashboard-account-id" value="${normalizeAccountId(uiState.accountId)}" /></label>
    </section>
    <div class="grid three">${dashboardMetrics()}</div>
    <div class="panel row">
      <button id="dashboard-sync" class="btn-primary">同期</button>
      <button id="dashboard-generate" class="btn-secondary">ブロック生成</button>
      <button id="dashboard-refresh" class="btn-secondary">再読込</button>
    </div>
    ${renderDailyCalendar(selectedDate)}
    <div class="panel">
      <h3>今日のブロック</h3>
      <table>
        <thead><tr><th>ID</th><th>開始</th><th>終了</th><th>Firmness</th></tr></thead>
        <tbody>${blockRows(uiState.blocks)}</tbody>
      </table>
    </div>
  `;

  const getSelectedDate = () => {
    const raw = /** @type {HTMLInputElement | null} */ (document.getElementById("dashboard-date"))?.value;
    return raw && raw.trim() ? raw.trim() : fallbackDate;
  };
  const getSelectedAccount = () =>
    normalizeAccountId(
      /** @type {HTMLInputElement | null} */ (document.getElementById("dashboard-account-id"))?.value
    );

  document.getElementById("dashboard-date")?.addEventListener("change", async () => {
    await runUiAction(async () => {
      const date = getSelectedDate();
      await refreshCoreData(date);
      renderDashboard();
    });
  });
  document.getElementById("dashboard-account-id")?.addEventListener("change", async () => {
    await runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      await refreshCoreData(date);
      renderDashboard();
    });
  });

  document.getElementById("dashboard-sync")?.addEventListener("click", async () => {
    await runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      await authenticateAndSyncCalendar(date);
      await refreshCoreData(date);
      renderDashboard();
    });
  });
  document.getElementById("dashboard-generate")?.addEventListener("click", async () => {
    await runUiAction(async () => {
      uiState.accountId = getSelectedAccount();
      const date = getSelectedDate();
      await invokeCommandWithProgress("generate_blocks", withAccount({ date }));
      await refreshCoreData(date);
      renderDashboard();
    });
  });
  document.getElementById("dashboard-refresh")?.addEventListener("click", async () => {
    await runUiAction(async () => {
      const date = getSelectedDate();
      await refreshCoreData(date);
      renderDashboard();
    });
  });
  bindDailyCalendarInteractions(renderDashboard);
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
  const state = uiState.pomodoro ?? { phase: "idle", remaining_seconds: 0, current_block_id: null, current_task_id: null };
  appRoot.innerHTML = `
    <section class="view-head">
      <div>
        <h2>ポモドーロ実行</h2>
        <p>開始・中断・再開・完了を操作します。</p>
      </div>
    </section>
    <div class="grid two">
      <div class="panel grid">
        <label>Block
          <select id="pom-block">${uiState.blocks.map((b) => `<option value="${b.id}">${b.id}</option>`).join("")}</select>
        </label>
        <label>Task
          <select id="pom-task"><option value="">(none)</option>${uiState.tasks
            .map((task) => `<option value="${task.id}">${task.title}</option>`)
            .join("")}</select>
        </label>
        <div class="row">
          <button id="pom-start" class="btn-primary">開始</button>
          <button id="pom-pause" class="btn-warn">一時停止</button>
          <button id="pom-resume" class="btn-secondary">再開</button>
          <button id="pom-complete" class="btn-danger">完了</button>
        </div>
      </div>
      <div class="panel metric">
        <span class="small">Phase</span>
        <b>${state.phase}</b>
        <span class="small">Remaining</span>
        <b>${toTimerText(state.remaining_seconds)}</b>
        <span class="small">Block: ${state.current_block_id ?? "-"}</span>
      </div>
    </div>
  `;

  document.getElementById("pom-start")?.addEventListener("click", async () => {
    const blockId = /** @type {HTMLSelectElement} */ (document.getElementById("pom-block")).value;
    const taskId = /** @type {HTMLSelectElement} */ (document.getElementById("pom-task")).value || null;
    uiState.pomodoro = await safeInvoke("start_pomodoro", { block_id: blockId, task_id: taskId });
    renderPomodoro();
  });
  document.getElementById("pom-pause")?.addEventListener("click", async () => {
    uiState.pomodoro = await safeInvoke("pause_pomodoro", { reason: "manual_pause" });
    renderPomodoro();
  });
  document.getElementById("pom-resume")?.addEventListener("click", async () => {
    uiState.pomodoro = await safeInvoke("resume_pomodoro", {});
    renderPomodoro();
  });
  document.getElementById("pom-complete")?.addEventListener("click", async () => {
    uiState.pomodoro = await safeInvoke("complete_pomodoro", {});
    renderPomodoro();
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

  appRoot.innerHTML = `
    <section class="view-head">
      <div>
        <h2>振り返り</h2>
        <p>期間集計（完了数・中断数・総作業時間）を確認します。</p>
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
      <div class="panel metric"><span class="small">集中分</span><b>${summary?.total_focus_minutes ?? 0}m</b></div>
    </div>
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
  if (getRoute() !== "pomodoro") {
    return;
  }
  try {
    uiState.pomodoro = await safeInvoke("get_pomodoro_state");
    renderPomodoro();
  } catch {
    // handled in safeInvoke
  }
}, 5000);

(async () => {
  if (!isTauriRuntimeAvailable()) {
    setStatus("mock mode: SSO requires `cd src-tauri && cargo tauri dev`");
  }

  try {
    await safeInvoke("bootstrap", {});
    await refreshCoreData();
    uiState.reflection = await safeInvoke("get_reflection_summary", {});
  } catch {
    // handled in safeInvoke
  }

  if (!window.location.hash) {
    window.location.hash = "#/dashboard";
  }
  render();
})();

