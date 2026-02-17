// @ts-check

const appRoot = /** @type {HTMLElement} */ (document.getElementById("app"));
const navRoot = /** @type {HTMLElement} */ (document.getElementById("route-nav"));
const statusChip = /** @type {HTMLElement} */ (document.getElementById("global-status"));

const routes = ["auth", "dashboard", "blocks", "pomodoro", "tasks", "reflection", "settings"];

/** @typedef {{id:string,date:string,start_at:string,end_at:string,firmness:string,instance:string,planned_pomodoros:number,source:string,source_id:string|null}} Block */
/** @typedef {{id:string,title:string,description:string|null,estimated_pomodoros:number|null,status:string,completed_pomodoros:number}} Task */
/** @typedef {{current_block_id:string|null,current_task_id:string|null,phase:string,remaining_seconds:number,start_time:string|null}} PomodoroState */

/** @type {{auth: any, blocks: Block[], tasks: Task[], pomodoro: PomodoroState|null, reflection: any|null, settings: any}} */
const uiState = {
  auth: null,
  blocks: [],
  tasks: [],
  pomodoro: null,
  reflection: null,
  settings: {
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
  pomodoro: {
    current_block_id: null,
    current_task_id: null,
    phase: "idle",
    remaining_seconds: 0,
    start_time: null,
  },
  logs: [],
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

function setStatus(message) {
  statusChip.textContent = message;
}

function getRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return routes.includes(hash) ? hash : "dashboard";
}

function markActiveRoute(route) {
  navRoot.querySelectorAll("a[data-route]").forEach((node) => {
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

async function mockInvoke(name, payload) {
  switch (name) {
    case "bootstrap":
      return { workspace_root: "mock", database_path: "mock.sqlite" };
    case "authenticate_google":
      return {
        status: payload.authorization_code ? "authenticated" : "reauthentication_required",
        authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      };
    case "sync_calendar":
      return { added: 0, updated: 0, deleted: 0, next_sync_token: "mock-token", calendar_id: "primary" };
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
      mockState.tasks = mockState.tasks.filter((item) => item.id !== payload.task_id);
      return true;
    case "list_blocks": {
      const date = payload.date || null;
      const blocks = date
        ? mockState.blocks.filter((block) => block.date === date)
        : mockState.blocks;
      return [...blocks];
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
  uiState.tasks = await safeInvoke("list_tasks");
  uiState.blocks = await safeInvoke("list_blocks", { date });
  uiState.pomodoro = await safeInvoke("get_pomodoro_state");
}

function render() {
  const route = getRoute();
  markActiveRoute(route);

  switch (route) {
    case "auth":
      renderAuth();
      break;
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

function renderAuth() {
  appRoot.innerHTML = `
    <section class="view-head">
      <div>
        <h2>認証</h2>
        <p>Google OAuth 認証状態を確認し、認可コードを交換します。</p>
      </div>
    </section>
    <div class="grid two">
      <div class="panel grid">
        <label>Authorization Code
          <input id="auth-code" placeholder="paste authorization code" />
        </label>
        <div class="row">
          <button id="auth-check" class="btn-secondary">セッション確認</button>
          <button id="auth-exchange" class="btn-primary">コード交換</button>
        </div>
      </div>
      <div class="panel">
        <h3>結果</h3>
        <pre id="auth-result" class="small">${uiState.auth ? JSON.stringify(uiState.auth, null, 2) : "not executed"}</pre>
      </div>
    </div>
  `;

  document.getElementById("auth-check")?.addEventListener("click", async () => {
    uiState.auth = await safeInvoke("authenticate_google", {});
    renderAuth();
  });

  document.getElementById("auth-exchange")?.addEventListener("click", async () => {
    const code = /** @type {HTMLInputElement} */ (document.getElementById("auth-code")).value.trim();
    uiState.auth = await safeInvoke("authenticate_google", { authorization_code: code });
    renderAuth();
  });
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
  const today = isoDate(new Date());
  appRoot.innerHTML = `
    <section class="view-head">
      <div>
        <h2>ダッシュボード</h2>
        <p>同期・日次ブロック生成・本日の状態確認。</p>
      </div>
      <label>日付 <input id="dashboard-date" type="date" value="${today}" /></label>
    </section>
    <div class="grid three">${dashboardMetrics()}</div>
    <div class="panel row">
      <button id="dashboard-sync" class="btn-primary">同期</button>
      <button id="dashboard-generate" class="btn-secondary">ブロック生成</button>
      <button id="dashboard-refresh" class="btn-secondary">再読込</button>
    </div>
    <div class="panel">
      <h3>今日のブロック</h3>
      <table>
        <thead><tr><th>ID</th><th>開始</th><th>終了</th><th>Firmness</th></tr></thead>
        <tbody>${blockRows(uiState.blocks)}</tbody>
      </table>
    </div>
  `;

  document.getElementById("dashboard-sync")?.addEventListener("click", async () => {
    await safeInvoke("sync_calendar", {});
    await refreshCoreData(today);
    renderDashboard();
  });
  document.getElementById("dashboard-generate")?.addEventListener("click", async () => {
    const date = /** @type {HTMLInputElement} */ (document.getElementById("dashboard-date")).value || today;
    await safeInvoke("generate_blocks", { date });
    await refreshCoreData(date);
    renderDashboard();
  });
  document.getElementById("dashboard-refresh")?.addEventListener("click", async () => {
    const date = /** @type {HTMLInputElement} */ (document.getElementById("dashboard-date")).value || today;
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
    const date = /** @type {HTMLInputElement} */ (document.getElementById("block-date")).value || today;
    await safeInvoke("generate_blocks", { date });
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
                  <button class="btn-danger" data-delete-task="${task.id}">削除</button>
                </td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
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
  appRoot.innerHTML = `
    <section class="view-head">
      <div>
        <h2>設定</h2>
        <p>ポリシー、テンプレート、Git同期のUI。</p>
      </div>
    </section>
    <div class="grid two">
      <div class="panel grid">
        <h3>ポリシー</h3>
        <label>勤務開始 <input id="set-work-start" type="time" value="${uiState.settings.workStart}" /></label>
        <label>勤務終了 <input id="set-work-end" type="time" value="${uiState.settings.workEnd}" /></label>
        <label>ブロック分数 <input id="set-block-duration" type="number" min="1" value="${uiState.settings.blockDuration}" /></label>
        <label>休憩分数 <input id="set-break-duration" type="number" min="1" value="${uiState.settings.breakDuration}" /></label>
        <button id="set-save-policy" class="btn-primary">セッション保存</button>
      </div>
      <div class="panel grid">
        <h3>ルーティーン / テンプレート / Git</h3>
        <label>Routine JSON<textarea id="set-routine-json" placeholder='{"routines":[]}'></textarea></label>
        <label>Template JSON<textarea id="set-template-json" placeholder='{"templates":[]}'></textarea></label>
        <label>Git Remote <input id="set-git-remote" value="${uiState.settings.gitRemote}" placeholder="https://..." /></label>
        <button id="set-git-check" class="btn-secondary">Git設定確認</button>
      </div>
    </div>
  `;

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

  document.getElementById("set-git-check")?.addEventListener("click", () => {
    uiState.settings.gitRemote = /** @type {HTMLInputElement} */ (document.getElementById("set-git-remote")).value;
    setStatus(uiState.settings.gitRemote ? "git remote configured" : "git remote is empty");
  });
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
