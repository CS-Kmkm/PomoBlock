import type { PageRenderDeps } from "../types.js";

export function renderDetailsPage(deps: PageRenderDeps): void {
  deps.renderers.renderTodayDetailsPage();
}
