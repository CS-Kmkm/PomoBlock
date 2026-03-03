import type { PageRenderDeps } from "../types.js";

export function renderInsightsPage(deps: PageRenderDeps): void {
  deps.renderers.renderReflection();
}
