import type { PageRenderDeps } from "../types.js";

export function renderBlocksPage(deps: PageRenderDeps): void {
  deps.renderers.renderBlocks();
}
