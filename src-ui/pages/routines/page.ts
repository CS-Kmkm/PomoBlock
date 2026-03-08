import type { PageRenderDeps } from "../../types.js";
import { renderRoutinesEvents } from "./events.js";

export function renderRoutinesPage(deps: PageRenderDeps): void {
  renderRoutinesEvents(deps);
}
