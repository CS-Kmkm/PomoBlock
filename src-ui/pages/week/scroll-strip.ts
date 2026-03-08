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

export function attachWeekScrollStrip(params: AttachWeekScrollStripParams): void {
  const { appRoot, uiState, selectedDate, bufferDateKeys, visibleStartIndex, onSelectDate, onBufferEdge } = params;
  const scrollContainer = appRoot.querySelector("[data-week-scroll-container]");
  if (!(scrollContainer instanceof HTMLElement)) {
    return;
  }
  const dayNodes = Array.from(scrollContainer.querySelectorAll("[data-week-day-key]")) as HTMLElement[];
  if (dayNodes.length === 0) {
    return;
  }

  let settleTimer = 0 as ReturnType<typeof setTimeout> | 0;
  let suppressScrollUntil = 0;

  const alignToVisibleStart = (startIndex: number) => {
    const targetNode = dayNodes[Math.max(0, Math.min(startIndex, dayNodes.length - 1))];
    if (!(targetNode instanceof HTMLElement)) {
      return;
    }
    suppressScrollUntil = Date.now() + SCROLL_SETTLE_MS;
    scrollContainer.scrollLeft = targetNode.offsetLeft;
    uiState.weekView.scrollLeftSnapshot = scrollContainer.scrollLeft;
  };

  const resolveClosestDateKey = () => {
    const viewportCenter = scrollContainer.scrollLeft + scrollContainer.clientWidth / 2;
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
    alignToVisibleStart(Math.max(0, index - 3));
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
    alignToVisibleStart(Math.max(0, Math.min(nextIndex - 3, bufferDateKeys.length - 7)));
    onSelectDate(nextDateKey);
    if (nextIndex <= EDGE_RELOAD_INDEX || nextIndex >= bufferDateKeys.length - EDGE_RELOAD_INDEX - 1) {
      onBufferEdge(nextDateKey);
    }
  });

  alignToVisibleStart(visibleStartIndex);
}
