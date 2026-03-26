type AppHeaderRoute = "today" | "week" | "week-details" | "now" | "routines" | "insights" | "settings";

type AppHeaderParams = {
  route: AppHeaderRoute;
  settingsPage: string;
};

type RouteLink = {
  href: string;
  route: AppHeaderRoute | "week";
  label: string;
};

const primaryLinks: RouteLink[] = [
  { href: "#/today", route: "today", label: "Weekly" },
  { href: "#/now", route: "now", label: "Now" },
  { href: "#/routines", route: "routines", label: "Routine Canvas" },
  { href: "#/insights", route: "insights", label: "Insights" },
  { href: "#/settings/blocks", route: "settings", label: "Admin" },
];

function resolveActiveRoute(route: AppHeaderRoute): RouteLink["route"] {
  return route === "week-details" ? "week" : route;
}

function searchPlaceholder(route: AppHeaderRoute): string {
  if (route === "routines") {
    return "Search routines...";
  }
  if (route === "settings") {
    return "Search settings...";
  }
  if (route === "insights") {
    return "Search reports...";
  }
  return "Search schedules...";
}

function pageEyebrow(route: AppHeaderRoute, settingsPage: string): string {
  if (route === "settings") {
    if (settingsPage === "git") {
      return "Git Sync";
    }
    if (settingsPage === "auth") {
      return "Authentication";
    }
    return "Admin Console";
  }
  if (route === "routines") {
    return "Builder";
  }
  if (route === "now") {
    return "Focus Session";
  }
  if (route === "insights") {
    return "Performance";
  }
  return "Planner";
}

export function renderAppHeader(params: AppHeaderParams): string {
  const activeRoute = resolveActiveRoute(params.route);
  const showZoom = params.route === "today" || params.route === "week" || params.route === "week-details" || params.route === "now" || params.route === "routines";

  return `
    <header class="topbar">
      <div class="topbar-brand-shell">
        <a href="#/today" class="brand brand-link" aria-label="PomoBlock home">
          <span class="brand-mark">P</span>
          <div>
            <p class="brand-kicker">${pageEyebrow(params.route, params.settingsPage)}</p>
            <h1>PomoBlock</h1>
          </div>
        </a>
        <nav class="route-nav" id="route-nav" aria-label="Main navigation">
          ${primaryLinks
            .map(
              (link) => `
            <a href="${link.href}" data-route="${link.route}" ${link.route === activeRoute ? 'aria-current="page"' : ""}>${link.label}</a>
          `,
            )
            .join("")}
        </nav>
      </div>

      <div class="topbar-utility">
        <label class="topbar-search" aria-label="プラン検索">
          <span class="topbar-search-icon" aria-hidden="true">&#8981;</span>
          <input type="search" placeholder="${searchPlaceholder(params.route)}" autocomplete="off" />
        </label>

        ${
          showZoom
            ? `
          <div class="topbar-zoom" aria-label="スケジュール表示倍率">
            <button type="button" class="topbar-zoom-btn" data-topbar-action="zoom-out" title="スケジュールを縮小">-</button>
            <span id="topbar-zoom-label" class="topbar-zoom-label">100%</span>
            <button type="button" class="topbar-zoom-btn" data-topbar-action="zoom-in" title="スケジュールを拡大">+</button>
            <button type="button" class="topbar-zoom-reset" data-topbar-action="zoom-reset" title="倍率をリセット">Reset</button>
          </div>
        `
            : `
          <div id="global-progress" class="progress-chip" hidden>
            <span id="global-progress-label">Loading</span>
            <div class="progress-track"><span id="global-progress-fill" class="progress-fill"></span></div>
            <span id="global-progress-value">0%</span>
          </div>
        `
        }

        <div class="topbar-actions">
          <p id="global-status" class="status-chip topbar-status">Ready</p>
          <a href="#/now" class="focus-launch" data-route="now">Start Focus</a>
          <a href="#/settings/auth" data-route="settings" class="settings-gear" aria-label="設定を開く" title="設定">&#9881;</a>
        </div>
      </div>
    </header>
  `;
}
