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
const longRunningCommands = new Set(["sync_calendar", "generate_blocks"]);
const longRunningLabels = {
  sync_calendar: "カレンダー同期",
  generate_blocks: "ブロック生成",
};
const progressTargetPercent = 92;
const progressUpdateIntervalMs = 180;

/** @typedef {{id:string,date:string,start_at:string,end_at:string,firmness:string,instance:string,planned_pomodoros:number,source:string,source_id:string|null}} Block */
/** @typedef {{account_id:string,id:string,title:string,start_at:string,end_at:string}} SyncedEvent */
/** @typedef {{id:string,title:string,description:string|null,estimated_pomodoros:number|null,status:string,completed_pomodoros:number}} Task */
/** @typedef {{current_block_id:string|null,current_task_id:string|null,phase:string,remaining_seconds:number,start_time:string|null,total_cycles:number,completed_cycles:number,current_cycle:number}} PomodoroState */

/** @type {{auth: any, accountId: string, dashboardDate: string, blocks: Block[], calendarEvents: SyncedEvent[], tasks: Task[], pomodoro: PomodoroState|null, reflection: any|null, settings: any}} */
const uiState = {
  auth: null,
  accountId: "default",
  dashboardDate: isoDate(new Date()),
  blocks: [],
  calendarEvents: [],
  tasks: [],
  pomodoro: null,
  reflection: null,
  settings: {
    page: "blocks",
    workStart: "09:00",
    workEnd: "18:00",
    blockDuration: 50,
    breakDuration: 10,
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
  return Math.max(1, Math.round(duration / 25));
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

function toClockText(milliseconds) {
  return new Date(milliseconds).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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

function renderSlotList(intervals, emptyText) {
  if (!intervals.length) {
    return `<p class="small">${emptyText}</p>`;
  }
  return `
    <ul class="slot-list">
      ${intervals
        .map(
          (interval) => `
            <li>
              <span>${intervalRangeLabel(interval)}</span>
              <span class="small">${toDurationLabel(minutesBetween(interval.startMs, interval.endMs))}</span>
            </li>
          `
        )
        .join("")}
    </ul>
  `;
}

function renderTimelineScale() {
  return [0, 6, 12, 18, 24]
    .map(
      (hour) => `
        <span style="left:${(hour / 24) * 100}%">${String(hour).padStart(2, "0")}:00</span>
      `
    )
    .join("");
}

function renderTimelineLane(label, kind, intervals, dayStartMs, dayEndMs) {
  const totalRange = Math.max(1, dayEndMs - dayStartMs);
  const segments = intervals
    .map((interval) => {
      const left = ((interval.startMs - dayStartMs) / totalRange) * 100;
      const width = Math.max(0.9, ((interval.endMs - interval.startMs) / totalRange) * 100);
      const title = `${intervalRangeLabel(interval)} (${toDurationLabel(
        minutesBetween(interval.startMs, interval.endMs)
      )})`;
      return `<span class="timeline-segment ${kind}" style="left:${left}%;width:${width}%" title="${title}"></span>`;
    })
    .join("");

  return `
    <div class="timeline-lane">
      <span class="lane-label">${label}</span>
      <div class="timeline-track">${segments || '<span class="timeline-empty">none</span>'}</div>
    </div>
  `;
}

function buildDailyCalendarModel(dateValue, blocks, events) {
  const { dayStart, dayEnd } = resolveDayBounds(dateValue);
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();
  const blockIntervals = toTimelineIntervals(blocks, dayStartMs, dayEndMs);
  const eventIntervals = toTimelineIntervals(events, dayStartMs, dayEndMs);
  const busyIntervals = mergeTimelineIntervals([...blockIntervals, ...eventIntervals]);
  const freeIntervals = invertTimelineIntervals(dayStartMs, dayEndMs, busyIntervals);

  return {
    dayStartMs,
    dayEndMs,
    blockIntervals,
    eventIntervals,
    freeIntervals,
    totals: {
      blockMinutes: sumIntervalMinutes(blockIntervals),
      eventMinutes: sumIntervalMinutes(eventIntervals),
      freeMinutes: sumIntervalMinutes(freeIntervals),
    },
  };
}

function renderDailyCalendar(dateValue) {
  const model = buildDailyCalendarModel(dateValue, uiState.blocks, uiState.calendarEvents);
  return `
    <div class="panel day-calendar">
      <div class="row spread">
        <h3>1日の時間カレンダー</h3>
        <span class="small">${dateValue}</span>
      </div>
      <div class="calendar-metrics">
        <span class="pill calendar-pill block">ブロック ${toDurationLabel(model.totals.blockMinutes)}</span>
        <span class="pill calendar-pill event">予定 ${toDurationLabel(model.totals.eventMinutes)}</span>
        <span class="pill calendar-pill free">空き ${toDurationLabel(model.totals.freeMinutes)}</span>
      </div>
      <div class="timeline-wrap">
        <div class="timeline-scale">${renderTimelineScale()}</div>
        ${renderTimelineLane("ブロック", "block", model.blockIntervals, model.dayStartMs, model.dayEndMs)}
        ${renderTimelineLane("予定", "event", model.eventIntervals, model.dayStartMs, model.dayEndMs)}
      </div>
      <div class="day-slot-grid">
        <section>
          <h4>ブロック時間</h4>
          ${renderSlotList(model.blockIntervals, "ブロックはありません")}
        </section>
        <section>
          <h4>予定時間</h4>
          ${renderSlotList(model.eventIntervals, "予定はありません")}
        </section>
        <section>
          <h4>空き時間</h4>
          ${renderSlotList(model.freeIntervals, "空き時間はありません")}
        </section>
      </div>
    </div>
  `;
}

function setStatus(message) {
  statusChip.textContent = message;
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
  const tauriInvoke = window.__TAURI__?.core?.invoke ?? window.__TAURI__?.invoke;
  if (tauriInvoke) {
    return tauriInvoke(name, payload);
  }
  return mockInvoke(name, payload);
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
  const totalCycles = blockPomodoroTarget(block);
  const breakSeconds = Math.max(60, Math.floor((uiState.settings.breakDuration || 5) * 60));
  const blockSeconds = Math.max(blockDurationMinutes(block) * 60, totalCycles * 300);
  const breakSlots = Math.max(0, totalCycles - 1);
  const maxBreakSeconds = breakSlots > 0 ? Math.floor((blockSeconds - totalCycles * 300) / breakSlots) : 0;
  const effectiveBreakSeconds = breakSlots > 0 ? Math.max(0, Math.min(breakSeconds, maxBreakSeconds)) : 0;
  const focusSeconds = Math.max(300, Math.floor((blockSeconds - effectiveBreakSeconds * breakSlots) / totalCycles));
  return {
    totalCycles,
    focusSeconds,
    breakSeconds: effectiveBreakSeconds,
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
    case "generate_blocks": {
      const date = payload.date || isoDate(new Date());
      const startAt = new Date(`${date}T09:00:00.000Z`);
      const endAt = new Date(startAt.getTime() + 50 * 60000);
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
      return [block];
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
      mockState.pomodoro = {
        current_block_id: payload.block_id,
        current_task_id: payload.task_id ?? null,
        phase: "focus",
        remaining_seconds: 1500,
        start_time: nowIso(),
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
  uiState.tasks = await safeInvoke("list_tasks");
  uiState.blocks = await safeInvoke("list_blocks", { date: normalizedDate });
  uiState.calendarEvents = await safeInvoke("list_synced_events", withAccount(syncWindow));
  uiState.pomodoro = await safeInvoke("get_pomodoro_state");
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
        <td>${block.id}</td>
        <td>${formatTime(block.start_at)}</td>
        <td>${formatTime(block.end_at)}</td>
        <td><span class="pill">${block.firmness}</span></td>
      </tr>`
    )
    .join("");
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
    const date = getSelectedDate();
    await refreshCoreData(date);
    renderDashboard();
  });
  document.getElementById("dashboard-account-id")?.addEventListener("change", async () => {
    uiState.accountId = getSelectedAccount();
    const date = getSelectedDate();
    await refreshCoreData(date);
    renderDashboard();
  });

  document.getElementById("dashboard-sync")?.addEventListener("click", async () => {
    uiState.accountId = getSelectedAccount();
    const date = getSelectedDate();
    await invokeCommandWithProgress("sync_calendar", withAccount(toSyncWindowPayload(date)));
    await refreshCoreData(date);
    renderDashboard();
  });
  document.getElementById("dashboard-generate")?.addEventListener("click", async () => {
    uiState.accountId = getSelectedAccount();
    const date = getSelectedDate();
    await invokeCommandWithProgress("generate_blocks", withAccount({ date }));
    await refreshCoreData(date);
    renderDashboard();
  });
  document.getElementById("dashboard-refresh")?.addEventListener("click", async () => {
    const date = getSelectedDate();
    await refreshCoreData(date);
    renderDashboard();
  });
}

function renderBlocks() {
  const today = isoDate(new Date());
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
      <button id="block-generate" class="btn-primary">生成</button>
    </div>
    <div class="grid">
      ${uiState.blocks
        .map(
          (block) => `
          <article class="panel">
            <div class="row spread">
              <h3>${block.id}</h3>
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
  `;

  const reload = async () => {
    const date = /** @type {HTMLInputElement} */ (document.getElementById("block-date")).value || today;
    uiState.blocks = await safeInvoke("list_blocks", { date });
    renderBlocks();
  };

  document.getElementById("block-load")?.addEventListener("click", reload);
  document.getElementById("block-generate")?.addEventListener("click", async () => {
    uiState.accountId = normalizeAccountId(
      /** @type {HTMLInputElement} */ (document.getElementById("block-account-id")).value
    );
    const date = /** @type {HTMLInputElement} */ (document.getElementById("block-date")).value || today;
    await invokeCommandWithProgress("generate_blocks", withAccount({ date }));
    await reload();
  });

  appRoot.querySelectorAll("[data-approve]").forEach((node) => {
    node.addEventListener("click", async () => {
      const id = /** @type {HTMLElement} */ (node).dataset.approve;
      await safeInvoke("approve_blocks", { block_ids: [id] });
      await reload();
    });
  });
  appRoot.querySelectorAll("[data-delete]").forEach((node) => {
    node.addEventListener("click", async () => {
      const id = /** @type {HTMLElement} */ (node).dataset.delete;
      await safeInvoke("delete_block", { block_id: id });
      await reload();
    });
  });
  appRoot.querySelectorAll("[data-adjust]").forEach((node) => {
    node.addEventListener("click", async () => {
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
  appRoot.querySelectorAll("[data-relocate]").forEach((node) => {
    node.addEventListener("click", async () => {
      const id = /** @type {HTMLElement} */ (node).dataset.relocate;
      await safeInvoke("relocate_if_needed", withAccount({ block_id: id }));
      await reload();
    });
  });
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
              .map((block) => `<option value="${block.id}">${block.id} ${formatTime(block.start_at)}</option>`)
              .join("")}
          </select>
        </label>
        <label>To Block
          <select id="carry-to-block-id">
            <option value="">(to)</option>
            ${uiState.blocks
              .map((block) => `<option value="${block.id}">${block.id} ${formatTime(block.start_at)}</option>`)
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
            <p class="small">認証状態を確認し、認可コードを交換します。</p>
            <label>Account ID
              <input id="auth-account-id" value="${normalizeAccountId(uiState.accountId)}" placeholder="default or email label" />
            </label>
            <label>Authorization Code
              <input id="auth-code" placeholder="paste authorization code" />
            </label>
            <div class="row">
              <button id="auth-check" class="btn-secondary">セッション確認</button>
              <button id="auth-exchange" class="btn-primary">コード交換</button>
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
  uiState.pomodoro = await safeInvoke("get_pomodoro_state");
  renderPomodoro();
}, 5000);

(async () => {
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

