type AppHeaderRoute = "today" | "week" | "week-details" | "now" | "routines" | "insights" | "settings";

type AppHeaderParams = {
  route: AppHeaderRoute;
  settingsPage: string;
};

type NavLink = {
  href: string;
  route: AppHeaderRoute | "week";
  label: string;
};

function navMarkup(activeRoute: string, links: NavLink[]): string {
  return `
    <nav class="route-nav" id="route-nav" aria-label="Main navigation">
      ${links
        .map(
          (link) => `<a href="${link.href}" data-route="${link.route}" ${link.route === activeRoute ? 'aria-current="page"' : ""}>${link.label}</a>`,
        )
        .join("")}
    </nav>
  `;
}

function brandMarkup(): string {
  return `
    <a href="#/today" class="brand brand-link" aria-label="PomoBlock home">
      <span class="brand-wordmark">PomoBlock</span>
    </a>
  `;
}

function searchMarkup(placeholder: string): string {
  return `
    <label class="topbar-search" aria-label="プラン検索">
      <span class="topbar-search-icon" aria-hidden="true">&#8981;</span>
      <input type="search" placeholder="${placeholder}" autocomplete="off" />
    </label>
  `;
}

export function renderAppHeader(params: AppHeaderParams): string {
  const activeRoute = params.route === "week-details" ? "today" : params.route;
  const links: NavLink[] = [
    { href: "#/today", route: "today", label: "Dashboard" },
    { href: "#/now", route: "now", label: "Focus" },
    { href: "#/routines", route: "routines", label: "Routines" },
    { href: "#/insights", route: "insights", label: "Insights" },
    { href: `#/settings/${params.settingsPage || "blocks"}`, route: "settings", label: "Settings" },
  ];

  return `
    <header class="topbar topbar--shared">
      <div class="topbar-primary">
        ${brandMarkup()}
        ${navMarkup(activeRoute, links)}
      </div>

      <div class="topbar-secondary">
        ${searchMarkup("Search schedules...")}
        <div id="global-progress" class="progress-chip" hidden>
          <span id="global-progress-label">Loading</span>
          <div class="progress-track"><span id="global-progress-fill" class="progress-fill"></span></div>
          <span id="global-progress-value">0%</span>
        </div>
        <div class="topbar-actions">
          <p id="global-status" class="status-chip topbar-status">Ready</p>
          <button type="button" class="topbar-icon-btn" aria-label="notifications">&#128276;</button>
          <button type="button" class="topbar-icon-btn" aria-label="settings">&#9881;</button>
          <button type="button" class="topbar-icon-btn topbar-icon-btn--avatar" aria-label="profile">◔</button>
          <a href="#/now" class="focus-launch" data-route="now">Start Focus</a>
        </div>
      </div>
    </header>
  `;
}
