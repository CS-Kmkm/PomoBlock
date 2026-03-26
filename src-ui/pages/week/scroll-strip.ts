import type { UiState } from "../../types.js";

const SCROLL_SETTLE_MS = 140;
const EDGE_RELOAD_INDEX = 6;

type AttachWeekScrollStripParams = {
  appRoot: HTMLElement;
  uiState: UiState;
  selectedDate: string;
  bufferDateKeys: string[];
  visibleStartIndex: number;
  onSelectDate: (dateKey: string) => void;
  onBufferEdge: (dateKey: string) => void;
};

export function resolveWeekSnapStartIndex(
  targetIndex: number,
  totalDayCount: number,
  viewportWidth: number,
  leadingOffset: number,
  dayStep: number
): number {
  const safeTotalDayCount = Math.max(0, Math.floor(totalDayCount));
  if (safeTotalDayCount <= 1) {
    return 0;
  }

  const safeViewportWidth = Math.max(0, viewportWidth - Math.max(0, leadingOffset));
  const safeDayStep = Math.max(1, dayStep);
  const viewportDayCount = Math.max(1, Math.floor(safeViewportWidth / safeDayStep));
  const leadDayCount = Math.floor(viewportDayCount / 2);
  const maxStartIndex = Math.max(0, safeTotalDayCount - viewportDayCount);
  return Math.max(0, Math.min(Math.floor(targetIndex) - leadDayCount, maxStartIndex));
}

export function attachWeekScrollStrip(params: AttachWeekScrollStripParams): void {
  const { appRoot, uiState, selectedDate, bufferDateKeys, visibleStartIndex, onSelectDate, onBufferEdge } = params;
  const scrollContainer = appRoot.querySelector("[data-week-scroll-container]");
  if (!(scrollContainer instanceof HTMLElement)) {
    return;
  }
  const timeRail = appRoot.querySelector("[data-week-time-rail]");
  const leadingOffset = timeRail instanceof HTMLElement ? timeRail.offsetWidth : 0;
  const dayNodes = Array.from(scrollContainer.querySelectorAll("[data-week-day-key]")) as HTMLElement[];
  if (dayNodes.length === 0) {
    return;
  }

  let settleTimer = 0 as ReturnType<typeof setTimeout> | 0;
  let suppressScrollUntil = 0;

  const resolveDayStep = () => {
    if (dayNodes.length <= 1) {
      return dayNodes[0]?.offsetWidth || 1;
    }
    const steps = dayNodes
      .slice(1)
      .map((node, index) => node.offsetLeft - dayNodes[index]!.offsetLeft)
      .filter((step) => step > 0);
    return steps[0] || dayNodes[0]?.offsetWidth || 1;
  };

  const resolveStartIndex = (targetIndex: number) =>
    resolveWeekSnapStartIndex(targetIndex, dayNodes.length, scrollContainer.clientWidth, leadingOffset, resolveDayStep());

  const alignToVisibleStart = (startIndex: number) => {
    const targetNode = dayNodes[Math.max(0, Math.min(startIndex, dayNodes.length - 1))];
    if (!(targetNode instanceof HTMLElement)) {
      return;
    }
    suppressScrollUntil = Date.now() + SCROLL_SETTLE_MS;
    scrollContainer.scrollLeft = Math.max(0, targetNode.offsetLeft - leadingOffset);
    uiState.weekView.scrollLeftSnapshot = scrollContainer.scrollLeft;
  };

  const resolveClosestDateKey = () => {
    const viewportWidth = Math.max(0, scrollContainer.clientWidth - leadingOffset);
    const viewportCenter = scrollContainer.scrollLeft + leadingOffset + viewportWidth / 2;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    dayNodes.forEach((node, index) => {
      const nodeCenter = node.offsetLeft + node.offsetWidth / 2;
      const distance = Math.abs(nodeCenter - viewportCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    return {
      dateKey: bufferDateKeys[closestIndex] || selectedDate,
      index: closestIndex,
    };
  };

  const settleSelection = () => {
    settleTimer = 0;
    uiState.weekView.isInteracting = false;
    const { dateKey, index } = resolveClosestDateKey();
    alignToVisibleStart(resolveStartIndex(index));
    if (dateKey !== selectedDate) {
      onSelectDate(dateKey);
    }
    if (index <= EDGE_RELOAD_INDEX || index >= bufferDateKeys.length - EDGE_RELOAD_INDEX - 1) {
      onBufferEdge(dateKey);
    }
  };

  const scheduleSettle = () => {
    if (settleTimer) {
      clearTimeout(settleTimer);
    }
    settleTimer = setTimeout(settleSelection, SCROLL_SETTLE_MS);
  };

  scrollContainer.addEventListener("scroll", () => {
    if (Date.now() < suppressScrollUntil) {
      return;
    }
    uiState.weekView.isInteracting = true;
    uiState.weekView.scrollLeftSnapshot = scrollContainer.scrollLeft;
    scheduleSettle();
  });

  scrollContainer.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const currentIndex = Math.max(0, bufferDateKeys.indexOf(selectedDate));
    const nextIndex = event.key === "ArrowRight" ? currentIndex + 1 : currentIndex - 1;
    const nextDateKey = bufferDateKeys[Math.max(0, Math.min(nextIndex, bufferDateKeys.length - 1))] || selectedDate;
    alignToVisibleStart(resolveStartIndex(nextIndex));
    onSelectDate(nextDateKey);
    if (nextIndex <= EDGE_RELOAD_INDEX || nextIndex >= bufferDateKeys.length - EDGE_RELOAD_INDEX - 1) {
      onBufferEdge(nextDateKey);
    }
  });

  const selectedIndex = bufferDateKeys.indexOf(selectedDate);
  alignToVisibleStart(selectedIndex >= 0 ? resolveStartIndex(selectedIndex) : visibleStartIndex);
}
