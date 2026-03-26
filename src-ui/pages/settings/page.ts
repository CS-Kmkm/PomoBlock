import type { JsonObject, PageRenderDeps } from "../../types.js";

export function renderSettingsPage(deps: PageRenderDeps): void {
  const { uiState, appRoot, setStatus, settingsPages, settingsPageLabels } = deps;
  const helpers = {
    ...deps.commonHelpers,
    ...deps.calendarHelpers,
    ...deps.nowHelpers,
    ...deps.routineHelpers,
    ...deps.taskHelpers,
  };
  const activePage = settingsPages.includes(uiState.settings.page) ? uiState.settings.page : "blocks";
  uiState.settings.page = activePage;

  let pageContent = "";
  switch (activePage) {
    case "blocks":
      pageContent = `
        <section class="settings-admin-grid">
          <article class="settings-admin-card settings-admin-card--primary">
            <div class="settings-admin-card-head">
              <div>
                <p class="settings-admin-kicker">Execution Policy</p>
                <h3>Block Composition</h3>
              </div>
              <span class="settings-admin-badge">Live</span>
            </div>
            <div class="settings-admin-form">
              <label class="settings-admin-field">勤務開始 <input id="set-work-start" type="time" value="${uiState.settings.workStart}" /></label>
              <label class="settings-admin-field">勤務終了 <input id="set-work-end" type="time" value="${uiState.settings.workEnd}" /></label>
              <label class="settings-admin-field">ブロック分数 <input id="set-block-duration" type="number" min="1" value="${uiState.settings.blockDuration}" /></label>
              <label class="settings-admin-field">休憩分数 <input id="set-break-duration" type="number" min="1" value="${uiState.settings.breakDuration}" /></label>
            </div>
            <button id="set-save-policy" class="btn-primary">ポリシーを保存</button>
          </article>
          <article class="settings-admin-card">
            <div class="settings-admin-card-head">
              <div>
                <p class="settings-admin-kicker">Data</p>
                <h3>Routines / Templates</h3>
              </div>
            </div>
            <div class="settings-admin-stack">
              <label class="settings-admin-field">ルーティン JSON<textarea id="set-routine-json" placeholder='{"routines":[]}'></textarea></label>
              <label class="settings-admin-field">テンプレート JSON<textarea id="set-template-json" placeholder='{"templates":[]}'></textarea></label>
            </div>
          </article>
        </section>
      `;
      break;
    case "git":
      pageContent = `
        <section class="settings-admin-grid">
          <article class="settings-admin-card settings-admin-card--primary">
            <div class="settings-admin-card-head">
              <div>
                <p class="settings-admin-kicker">Versioned Sync</p>
                <h3>Git Remote</h3>
              </div>
              <span class="settings-admin-badge">${uiState.settings.gitRemote ? "Configured" : "Empty"}</span>
            </div>
            <p class="small">同期先のリモート設定を管理します。</p>
            <label class="settings-admin-field">Git リモート <input id="set-git-remote" value="${uiState.settings.gitRemote}" placeholder="https://..." /></label>
            <button id="set-git-check" class="btn-secondary">Git 設定確認</button>
          </article>
          <article class="settings-admin-card">
            <div class="settings-admin-card-head">
              <div>
                <p class="settings-admin-kicker">Current Target</p>
                <h3>Remote Snapshot</h3>
              </div>
            </div>
            <pre class="settings-admin-pre">${uiState.settings.gitRemote || "未設定"}</pre>
          </article>
        </section>
      `;
      break;
    default:
      pageContent = `
        <section class="settings-admin-grid">
          <article class="settings-admin-card settings-admin-card--primary">
            <div class="settings-admin-card-head">
              <div>
                <p class="settings-admin-kicker">Calendar Access</p>
                <h3>Google OAuth</h3>
              </div>
              <span class="settings-admin-badge">${uiState.auth ? "Connected" : "Pending"}</span>
            </div>
            <p class="small">推奨: 1クリックでSSO認証してカレンダー同期します。必要時のみ認可コードを手動交換します。</p>
            <label class="settings-admin-field">アカウント ID
              <input id="auth-account-id" value="${helpers.normalizeAccountId(uiState.accountId)}" placeholder="default または email ラベル" />
            </label>
            <label class="settings-admin-field">認可コード
              <input id="auth-code" placeholder="認可コードを貼り付け" />
            </label>
            <div class="row settings-admin-actions">
              <button id="auth-sso" class="btn-primary">SSOログインして同期</button>
              <button id="auth-check" class="btn-secondary">セッション確認</button>
              <button id="auth-exchange" class="btn-secondary">コード交換</button>
            </div>
          </article>
          <article class="settings-admin-card">
            <div class="settings-admin-card-head">
              <div>
                <p class="settings-admin-kicker">Session State</p>
                <h3>Auth Result</h3>
              </div>
            </div>
            <pre id="auth-result" class="settings-admin-pre">${uiState.auth ? JSON.stringify(uiState.auth, null, 2) : "未実行"}</pre>
          </article>
        </section>
      `;
      break;
  }

  appRoot.innerHTML = `
    <section class="settings-admin-page">
      <header class="settings-admin-hero">
        <div>
          <p class="settings-admin-kicker">Management Console</p>
          <h2>Settings</h2>
          <p>設定カテゴリをページ分割して管理します。</p>
        </div>
        <div class="settings-admin-metrics">
          <article>
            <span>Focus Window</span>
            <strong>${helpers.escapeHtml(uiState.settings.workStart)} - ${helpers.escapeHtml(uiState.settings.workEnd)}</strong>
          </article>
          <article>
            <span>Block Size</span>
            <strong>${uiState.settings.blockDuration}m / break ${uiState.settings.breakDuration}m</strong>
          </article>
        </div>
      </header>
      <nav class="settings-page-nav" aria-label="設定内ページ">
        ${settingsPages
          .map(
            (page) => `
          <a href="#/settings/${page}" data-settings-page="${page}" ${page === activePage ? 'aria-current="page"' : ""}>${settingsPageLabels[page] || page}</a>
        `
          )
          .join("")}
      </nav>
      ${pageContent}
    </section>
  `;

  if (activePage === "blocks") {
    document.getElementById("set-save-policy")?.addEventListener("click", () => {
      uiState.settings.workStart = (document.getElementById("set-work-start") as HTMLInputElement).value;
      uiState.settings.workEnd = (document.getElementById("set-work-end") as HTMLInputElement).value;
      uiState.settings.blockDuration = Number((document.getElementById("set-block-duration") as HTMLInputElement).value);
      uiState.settings.breakDuration = Number((document.getElementById("set-break-duration") as HTMLInputElement).value);
      setStatus("設定をセッションに保存しました");
    });
    return;
  }

  if (activePage === "git") {
    document.getElementById("set-git-check")?.addEventListener("click", () => {
      uiState.settings.gitRemote = (document.getElementById("set-git-remote") as HTMLInputElement).value;
      setStatus(uiState.settings.gitRemote ? "Git リモートを設定しました" : "Git リモートが未設定です");
      renderSettingsPage(deps);
    });
    return;
  }

  document.getElementById("auth-sso")?.addEventListener("click", async () => {
    await deps.services.runUiAction(async () => {
      uiState.accountId = helpers.normalizeAccountId((document.getElementById("auth-account-id") as HTMLInputElement).value);
      const targetDate = uiState.dashboardDate || helpers.isoDate(new Date());
      await deps.authenticateAndSyncCalendar(targetDate, { forceReauth: true });
      await deps.refreshCoreData(targetDate);
      renderSettingsPage(deps);
    });
  });

  document.getElementById("auth-check")?.addEventListener("click", async () => {
    uiState.accountId = helpers.normalizeAccountId((document.getElementById("auth-account-id") as HTMLInputElement).value);
    uiState.auth = (await deps.services.safeInvoke("authenticate_google", helpers.withAccount({}))) as JsonObject;
    renderSettingsPage(deps);
  });

  document.getElementById("auth-exchange")?.addEventListener("click", async () => {
    uiState.accountId = helpers.normalizeAccountId((document.getElementById("auth-account-id") as HTMLInputElement).value);
    const code = (document.getElementById("auth-code") as HTMLInputElement).value.trim();
    uiState.auth = (await deps.services.safeInvoke(
      "authenticate_google",
      helpers.withAccount({ authorization_code: code })
    )) as JsonObject;
    renderSettingsPage(deps);
  });
}
