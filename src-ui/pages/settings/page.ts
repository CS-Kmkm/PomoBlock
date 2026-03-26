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
            <label>ルーティン JSON<textarea id="set-routine-json" placeholder='{"routines":[]}'></textarea></label>
            <label>テンプレート JSON<textarea id="set-template-json" placeholder='{"templates":[]}'></textarea></label>
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
            <label>Git リモート <input id="set-git-remote" value="${uiState.settings.gitRemote}" placeholder="https://..." /></label>
            <button id="set-git-check" class="btn-secondary">Git 設定確認</button>
          </div>
          <div class="panel grid">
            <h3>現在の同期先</h3>
            <pre class="small">${uiState.settings.gitRemote || "未設定"}</pre>
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
            <label>アカウント ID
              <input id="auth-account-id" value="${helpers.normalizeAccountId(uiState.accountId)}" placeholder="default または email ラベル" />
            </label>
            <label>認可コード
              <input id="auth-code" placeholder="認可コードを貼り付け" />
            </label>
            <div class="row">
              <button id="auth-sso" class="btn-primary">SSOログインして同期</button>
              <button id="auth-check" class="btn-secondary">セッション確認</button>
              <button id="auth-exchange" class="btn-secondary">コード交換</button>
            </div>
          </div>
          <div class="panel">
            <h3>認証結果</h3>
            <pre id="auth-result" class="small">${uiState.auth ? JSON.stringify(uiState.auth, null, 2) : "未実行"}</pre>
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
        <a href="#/settings/${page}" data-settings-page="${page}" ${page === activePage ? 'aria-current="page"' : ""}>${settingsPageLabels[page] || page}</a>
      `
        )
        .join("")}
    </nav>
    ${pageContent}
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
