import { clampDateKeyToBuffer, resolveVisibleWeekDateKeys, resolveWeekBufferDateKeys } from "../../time.js";
import type { PageRenderDeps } from "../../types.js";

const weekDateLabelFormatter = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  weekday: "short",
});

export type WeekPageModel = {
  selectedDate: string;
  selectedDateLabel: string;
  visibleDateKeys: string[];
  visibleRangeLabel: string;
  bufferDateKeys: string[];
  bufferAnchorDate: string;
  visibleStartIndex: number;
  plannerModel: {
    weekLabel?: string;
  };
};

function formatDateKeyLabel(dateKey: string): string {
  if (!dateKey) {
    return "-";
  }

  const parsedDate = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    return dateKey;
  }

  return weekDateLabelFormatter.format(parsedDate);
}

export function buildWeekPageModel(deps: PageRenderDeps): WeekPageModel {
  const { uiState, calendarHelpers, commonHelpers } = deps;
  const fallbackDate = commonHelpers.isoDate(new Date());
  const selectedDate = uiState.dashboardDate || fallbackDate;
  const requestedBufferAnchorDate = uiState.weekView.bufferAnchorDate || selectedDate;
  const bufferAnchorDate = clampDateKeyToBuffer(selectedDate, requestedBufferAnchorDate) === selectedDate ? requestedBufferAnchorDate : selectedDate;
  const bufferDateKeys = resolveWeekBufferDateKeys(bufferAnchorDate);
  const visibleDateKeys = resolveVisibleWeekDateKeys(selectedDate);
  const visibleStartIndex = Math.max(0, bufferDateKeys.indexOf(visibleDateKeys[0] || selectedDate));
  const selectedDateLabel = formatDateKeyLabel(selectedDate);
  const visibleRangeLabel =
    visibleDateKeys.length > 0
      ? `${formatDateKeyLabel(visibleDateKeys[0] || selectedDate)} - ${formatDateKeyLabel(visibleDateKeys[visibleDateKeys.length - 1] || selectedDate)}`
      : selectedDateLabel;

  uiState.weekView.bufferAnchorDate = bufferAnchorDate;

  return {
    selectedDate,
    selectedDateLabel,
    visibleDateKeys,
    visibleRangeLabel,
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
