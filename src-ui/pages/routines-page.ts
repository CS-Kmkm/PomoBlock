import type { PageRenderDeps } from "../types.js";
import { renderRoutinesEvents } from "./routines-events.js";

export function renderRoutinesPage(deps: PageRenderDeps): void {
  renderRoutinesEvents(deps);
}
