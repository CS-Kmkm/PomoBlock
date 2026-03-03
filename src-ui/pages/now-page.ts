import type { PageRenderDeps } from "../types.js";

export function renderNowPage(deps: PageRenderDeps): void {
  deps.renderers.renderPomodoro();
}
