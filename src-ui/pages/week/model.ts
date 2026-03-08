import { clampDateKeyToBuffer, resolveVisibleWeekDateKeys, resolveWeekBufferDateKeys } from "../../time.js";
import type { PageRenderDeps } from "../../types.js";

export type WeekPageModel = {
  selectedDate: string;
  visibleDateKeys: string[];
  bufferDateKeys: string[];
  bufferAnchorDate: string;
  visibleStartIndex: number;
  plannerModel: {
    weekLabel?: string;
  };
};

export function buildWeekPageModel(deps: PageRenderDeps): WeekPageModel {
  const { uiState, calendarHelpers, commonHelpers } = deps;
  const fallbackDate = commonHelpers.isoDate(new Date());
  const selectedDate = uiState.dashboardDate || fallbackDate;
  const requestedBufferAnchorDate = uiState.weekView.bufferAnchorDate || selectedDate;
  const bufferAnchorDate = clampDateKeyToBuffer(selectedDate, requestedBufferAnchorDate) === selectedDate ? requestedBufferAnchorDate : selectedDate;
  const bufferDateKeys = resolveWeekBufferDateKeys(bufferAnchorDate);
  const visibleDateKeys = resolveVisibleWeekDateKeys(selectedDate);
  const visibleStartIndex = Math.max(0, bufferDateKeys.indexOf(visibleDateKeys[0] || selectedDate));

  uiState.weekView.bufferAnchorDate = bufferAnchorDate;

  return {
    selectedDate,
    visibleDateKeys,
    bufferDateKeys,
    bufferAnchorDate,
    visibleStartIndex,
    plannerModel: calendarHelpers.buildPlannerStripModel(
      bufferDateKeys,
      selectedDate,
      uiState.blocks,
      uiState.calendarEvents
    ) as { weekLabel?: string },
  };
}
