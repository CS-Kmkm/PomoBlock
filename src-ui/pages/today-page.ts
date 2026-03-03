import type { PageRenderDeps } from "../types.js";

export function renderTodayPage(deps: PageRenderDeps): void {
  deps.renderers.renderDashboard();
}
