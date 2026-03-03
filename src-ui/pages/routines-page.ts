import type { PageRenderDeps } from "../types.js";

export function renderRoutinesPage(deps: PageRenderDeps): void {
  deps.renderers.renderRoutines();
}
