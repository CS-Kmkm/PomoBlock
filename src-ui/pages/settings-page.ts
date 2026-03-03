import type { PageRenderDeps } from "../types.js";

export function renderSettingsPage(deps: PageRenderDeps): void {
  deps.renderers.renderSettings();
}
