import type { DayBlockDragState } from "./types.js";

const DAY_BLOCK_DRAG_SNAP_MINUTES = 5;
const DAY_BLOCK_DRAG_THRESHOLD_PX = 4;

type DayBlockMoveSnapshot = {
  blockId: string;
  dayStartMs: number;
  dayEndMs: number;
  originStartMs: number;
  originEndMs: number;
  previewStartMs: number;
  previewEndMs: number;
};

export type DayBlockDndDeps = {
  appRoot: HTMLElement;
  state: DayBlockDragState;
  rerender: () => void;
  intervalRangeLabel: (interval: { startMs: number; endMs: number }) => string;
  blockDisplayName: (block: { start_at: string; end_at: string; date?: string }) => string;
  toClockText: (milliseconds: number) => string;
  getDashboardDate: () => string;
  setStatus: (message: string) => void;
  setSelectedBlock: (blockId: string) => void;
  runUiAction: (action: () => Promise<void>) => Promise<void>;
  safeInvoke: (name: string, payload: Record<string, unknown>) => Promise<unknown>;
  refreshCoreData: (date: string) => Promise<void>;
};

function snapToMinutes(milliseconds: number, minutes: number) {
  const step = Math.max(1, Math.floor(minutes)) * 60000;
  return Math.round(milliseconds / step) * step;
}

function clampBlockIntervalToDay(startMs: number, durationMs: number, dayStartMs: number, dayEndMs: number) {
  const safeDuration = Math.max(60000, durationMs);
  const maxStartMs = Math.max(dayStartMs, dayEndMs - safeDuration);
  const clampedStartMs = Math.min(Math.max(startMs, dayStartMs), maxStartMs);
  return {
    startMs: clampedStartMs,
    endMs: clampedStartMs + safeDuration,
  };
}

function snapAndClampBlockInterval(startMs: number, durationMs: number, dayStartMs: number, dayEndMs: number) {
  const snappedStartMs = snapToMinutes(startMs, DAY_BLOCK_DRAG_SNAP_MINUTES);
  return clampBlockIntervalToDay(snappedStartMs, durationMs, dayStartMs, dayEndMs);
}

function clearDayBlockDragDocumentListeners(state: DayBlockDragState) {
  if (state.onMove) {
    window.removeEventListener("pointermove", state.onMove);
    state.onMove = null;
  }
  if (state.onUp) {
    window.removeEventListener("pointerup", state.onUp);
    window.removeEventListener("pointercancel", state.onUp);
    state.onUp = null;
  }
}

function setHoveredFreeEntry(state: DayBlockDragState, entry: HTMLElement | null) {
  if (state.hoveredFreeEntry === entry) return;
  if (state.hoveredFreeEntry) {
    state.hoveredFreeEntry.classList.remove("is-drop-target");
  }
  state.hoveredFreeEntry = entry;
  if (state.hoveredFreeEntry) {
    state.hoveredFreeEntry.classList.add("is-drop-target");
  }
}

function resetDayBlockDragVisualState(state: DayBlockDragState) {
  setHoveredFreeEntry(state, null);
  if (state.entry) {
    state.entry.classList.remove("is-dragging");
    state.entry.style.top = state.originalTopCss;
    state.entry.style.left = state.originalLeftCss;
    state.entry.style.removeProperty("z-index");
    state.entry.title = state.originalTitle;
    if (state.timeLabel) {
      state.timeLabel.textContent = state.originalTimeLabelText;
    }
  }
}

async function commitDayBlockMove(deps: DayBlockDndDeps, snapshot: DayBlockMoveSnapshot) {
  const blockId = snapshot.blockId;
  if (!blockId) return;
  const durationMs = snapshot.previewEndMs - snapshot.previewStartMs;
  const finalInterval = snapAndClampBlockInterval(snapshot.previewStartMs, durationMs, snapshot.dayStartMs, snapshot.dayEndMs);
  const finalStartMs = finalInterval.startMs;
  const finalEndMs = finalInterval.endMs;
  const unchanged =
    Math.abs(finalStartMs - snapshot.originStartMs) < 1000 && Math.abs(finalEndMs - snapshot.originEndMs) < 1000;
  if (unchanged) return;
  await deps.runUiAction(async () => {
    await deps.safeInvoke("adjust_block_time", {
      block_id: blockId,
      start_at: new Date(finalStartMs).toISOString(),
      end_at: new Date(finalEndMs).toISOString(),
    });
    deps.setSelectedBlock(blockId);
    await deps.refreshCoreData(deps.getDashboardDate());
    deps.setStatus(`block moved: ${deps.toClockText(finalStartMs)} - ${deps.toClockText(finalEndMs)}`);
    deps.rerender();
  });
}

function finishDayBlockDrag(deps: DayBlockDndDeps) {
  const { state } = deps;
  clearDayBlockDragDocumentListeners(state);
  if (!state.active) return;
  resetDayBlockDragVisualState(state);
  const commitSnapshot = {
    blockId: state.blockId,
    dayStartMs: state.dayStartMs,
    dayEndMs: state.dayEndMs,
    originStartMs: state.originStartMs,
    originEndMs: state.originEndMs,
    previewStartMs: state.previewStartMs,
    previewEndMs: state.previewEndMs,
  };
  const moved = state.moved;
  if (moved) {
    state.suppressClickUntil = Date.now() + 220;
  }
  const releaseEntry = state.entry;
  const pointerId = state.pointerId;
  if (releaseEntry && typeof pointerId === "number" && Number.isInteger(pointerId)) {
    try {
      releaseEntry.releasePointerCapture(pointerId);
    } catch {
      // ignore unsupported or already released capture
    }
  }
  state.active = false;
  state.moved = false;
  state.pointerId = null;
  state.blockId = "";
  state.dayStartMs = 0;
  state.dayEndMs = 0;
  state.rangeMs = 0;
  state.trackHeightPx = 0;
  state.trackWidthPx = 0;
  state.originClientY = 0;
  state.originClientX = 0;
  state.originStartMs = 0;
  state.originEndMs = 0;
  state.previewStartMs = 0;
  state.previewEndMs = 0;
  state.originalTopCss = "";
  state.originalLeftCss = "";
  state.originalTimeLabelText = "";
  state.originalTitle = "";
  state.hoveredFreeEntry = null;
  state.entry = null;
  state.timeLabel = null;
  if (moved) {
    void commitDayBlockMove(deps, commitSnapshot);
  }
}

function applyDayBlockPreview(
  deps: DayBlockDndDeps,
  entry: HTMLButtonElement,
  interval: { startMs: number; endMs: number }
) {
  const { state } = deps;
  if (!state.rangeMs || state.rangeMs <= 0) return;
  state.previewStartMs = interval.startMs;
  state.previewEndMs = interval.endMs;
  const startPercent = ((interval.startMs - state.dayStartMs) / state.rangeMs) * 100;
  if (entry.classList.contains("day-simple-segment")) {
    entry.style.left = `${startPercent}%`;
  } else {
    entry.style.top = `${startPercent}%`;
  }
  const timeText = deps.intervalRangeLabel(interval);
  if (state.timeLabel) {
    state.timeLabel.textContent = timeText;
  }
  entry.title = `${deps.blockDisplayName({
    start_at: new Date(interval.startMs).toISOString(),
    end_at: new Date(interval.endMs).toISOString(),
    date: deps.getDashboardDate(),
  })} | ${timeText}`;
}

function bindGridDrag(deps: DayBlockDndDeps) {
  const { appRoot, state } = deps;
  appRoot.querySelectorAll(".day-entry-block.is-draggable[data-day-item-id]").forEach((node) => {
    node.addEventListener("pointerdown", (event: Event) => {
      const pointerEvent = event as PointerEvent;
      if (pointerEvent.button !== 0) return;
      const entry = node as HTMLButtonElement;
      const blockId = entry.dataset.dayItemId;
      const dayStartMs = Number(entry.dataset.dayStartMs || "");
      const dayEndMs = Number(entry.dataset.dayEndMs || "");
      const itemStartMs = Number(entry.dataset.dayItemStartMs || "");
      const itemEndMs = Number(entry.dataset.dayItemEndMs || "");
      const laneTrack = entry.closest(".day-lane-track");
      const laneHeight = laneTrack instanceof HTMLElement ? laneTrack.clientHeight : 0;
      if (
        !blockId ||
        !Number.isFinite(dayStartMs) ||
        !Number.isFinite(dayEndMs) ||
        !Number.isFinite(itemStartMs) ||
        !Number.isFinite(itemEndMs) ||
        dayEndMs <= dayStartMs ||
        itemEndMs <= itemStartMs ||
        laneHeight <= 1
      ) {
        return;
      }
      clearDayBlockDragDocumentListeners(state);
      state.active = true;
      state.moved = false;
      state.pointerId = pointerEvent.pointerId;
      state.blockId = blockId;
      state.dayStartMs = dayStartMs;
      state.dayEndMs = dayEndMs;
      state.rangeMs = dayEndMs - dayStartMs;
      state.trackHeightPx = laneHeight;
      state.trackWidthPx = 0;
      state.originClientY = pointerEvent.clientY;
      state.originClientX = pointerEvent.clientX;
      state.originStartMs = itemStartMs;
      state.originEndMs = itemEndMs;
      state.previewStartMs = itemStartMs;
      state.previewEndMs = itemEndMs;
      state.entry = entry;
      state.timeLabel = entry.querySelector(".day-entry-time");
      state.originalTopCss = entry.style.top || "";
      state.originalLeftCss = entry.style.left || "";
      state.originalTimeLabelText = state.timeLabel?.textContent || "";
      state.originalTitle = entry.title || "";
      entry.classList.add("is-dragging");
      entry.style.zIndex = "4";
      try {
        entry.setPointerCapture(pointerEvent.pointerId);
      } catch {
        // ignore unsupported pointer capture
      }
      const onMove = (moveEvent: PointerEvent) => {
        if (!state.active || moveEvent.pointerId !== state.pointerId) return;
        const durationMs = state.originEndMs - state.originStartMs;
        const hovered = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
        const hoveredFreeEntry =
          hovered instanceof Element ? hovered.closest(".day-entry-free[data-day-item-start-ms][data-day-item-end-ms]") : null;
        const hoveredFree = hoveredFreeEntry instanceof HTMLElement ? hoveredFreeEntry : null;
        let movedByFreeDrop = false;
        if (hoveredFree) {
          const freeStartMs = Number(hoveredFree.dataset.dayItemStartMs || "");
          const freeEndMs = Number(hoveredFree.dataset.dayItemEndMs || "");
          if (
            Number.isFinite(freeStartMs) &&
            Number.isFinite(freeEndMs) &&
            freeEndMs > freeStartMs &&
            freeEndMs - freeStartMs >= durationMs
          ) {
            setHoveredFreeEntry(state, hoveredFree);
            const nextInterval = snapAndClampBlockInterval(freeStartMs, durationMs, state.dayStartMs, state.dayEndMs);
            applyDayBlockPreview(deps, entry, nextInterval);
            movedByFreeDrop = true;
          } else {
            setHoveredFreeEntry(state, null);
          }
        } else {
          setHoveredFreeEntry(state, null);
        }
        const deltaY = moveEvent.clientY - state.originClientY;
        if (!movedByFreeDrop) {
          if (!state.moved && Math.abs(deltaY) < DAY_BLOCK_DRAG_THRESHOLD_PX) {
            return;
          }
          const deltaMsRaw = (deltaY / state.trackHeightPx) * state.rangeMs;
          const nextInterval = snapAndClampBlockInterval(state.originStartMs + deltaMsRaw, durationMs, state.dayStartMs, state.dayEndMs);
          applyDayBlockPreview(deps, entry, nextInterval);
        }
        state.moved =
          Math.abs(state.previewStartMs - state.originStartMs) >= 1000 ||
          Math.abs(state.previewEndMs - state.originEndMs) >= 1000;
        moveEvent.preventDefault();
      };
      const onUp = (upEvent: PointerEvent) => {
        if (!state.active || upEvent.pointerId !== state.pointerId) return;
        finishDayBlockDrag(deps);
      };
      state.onMove = onMove;
      state.onUp = onUp;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      pointerEvent.preventDefault();
    });
  });
}

function bindSimpleDrag(deps: DayBlockDndDeps) {
  const { appRoot, state } = deps;
  appRoot.querySelectorAll(".day-simple-segment-block.is-draggable[data-day-item-id]").forEach((node) => {
    node.addEventListener("pointerdown", (event: Event) => {
      const pointerEvent = event as PointerEvent;
      if (pointerEvent.button !== 0) return;
      const entry = node as HTMLButtonElement;
      const blockId = entry.dataset.dayItemId;
      const dayStartMs = Number(entry.dataset.dayStartMs || "");
      const dayEndMs = Number(entry.dataset.dayEndMs || "");
      const itemStartMs = Number(entry.dataset.dayItemStartMs || "");
      const itemEndMs = Number(entry.dataset.dayItemEndMs || "");
      const laneTrack = entry.closest(".day-simple-track");
      const laneWidth = laneTrack instanceof HTMLElement ? laneTrack.clientWidth : 0;
      if (
        !blockId ||
        !Number.isFinite(dayStartMs) ||
        !Number.isFinite(dayEndMs) ||
        !Number.isFinite(itemStartMs) ||
        !Number.isFinite(itemEndMs) ||
        dayEndMs <= dayStartMs ||
        itemEndMs <= itemStartMs ||
        laneWidth <= 1
      ) {
        return;
      }
      clearDayBlockDragDocumentListeners(state);
      state.active = true;
      state.moved = false;
      state.pointerId = pointerEvent.pointerId;
      state.blockId = blockId;
      state.dayStartMs = dayStartMs;
      state.dayEndMs = dayEndMs;
      state.rangeMs = dayEndMs - dayStartMs;
      state.trackHeightPx = 0;
      state.trackWidthPx = laneWidth;
      state.originClientY = pointerEvent.clientY;
      state.originClientX = pointerEvent.clientX;
      state.originStartMs = itemStartMs;
      state.originEndMs = itemEndMs;
      state.previewStartMs = itemStartMs;
      state.previewEndMs = itemEndMs;
      state.entry = entry;
      state.timeLabel = null;
      state.originalTopCss = entry.style.top || "";
      state.originalLeftCss = entry.style.left || "";
      state.originalTimeLabelText = "";
      state.originalTitle = entry.title || "";
      entry.classList.add("is-dragging");
      entry.style.zIndex = "4";
      try {
        entry.setPointerCapture(pointerEvent.pointerId);
      } catch {
        // ignore unsupported pointer capture
      }
      const onMove = (moveEvent: PointerEvent) => {
        if (!state.active || moveEvent.pointerId !== state.pointerId) return;
        const deltaX = moveEvent.clientX - state.originClientX;
        if (!state.moved && Math.abs(deltaX) < DAY_BLOCK_DRAG_THRESHOLD_PX) {
          return;
        }
        const durationMs = state.originEndMs - state.originStartMs;
        const deltaMsRaw = (deltaX / state.trackWidthPx) * state.rangeMs;
        const nextInterval = snapAndClampBlockInterval(state.originStartMs + deltaMsRaw, durationMs, state.dayStartMs, state.dayEndMs);
        applyDayBlockPreview(deps, entry, nextInterval);
        state.moved =
          Math.abs(state.previewStartMs - state.originStartMs) >= 1000 ||
          Math.abs(state.previewEndMs - state.originEndMs) >= 1000;
        moveEvent.preventDefault();
      };
      const onUp = (upEvent: PointerEvent) => {
        if (!state.active || upEvent.pointerId !== state.pointerId) return;
        finishDayBlockDrag(deps);
      };
      state.onMove = onMove;
      state.onUp = onUp;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      pointerEvent.preventDefault();
    });
  });
}

export function bindDayBlockDragInteractions(deps: DayBlockDndDeps): void {
  bindGridDrag(deps);
  bindSimpleDrag(deps);
}
