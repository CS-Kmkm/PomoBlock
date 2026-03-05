import type { DayBlockDragState } from "./types.js";

type DayItemKind = "block" | "event" | "free";
type DayCalendarViewMode = "grid" | "simple";

export type DayCalendarEventsDeps = {
  appRoot: HTMLElement;
  rerender: () => void;
  dayBlockDragState: DayBlockDragState;
  bindDayBlockDrag: () => void;
  setDayCalendarViewMode: (mode: DayCalendarViewMode) => void;
  setDayCalendarSelection: (selection: { kind: DayItemKind; id: string }) => void;
  setBlockTitle: (blockId: string, title: string) => boolean;
  setStatus: (message: string) => void;
};

export function bindDayCalendarEvents(deps: DayCalendarEventsDeps): void {
  const { appRoot, rerender, dayBlockDragState } = deps;
  deps.bindDayBlockDrag();

  appRoot.querySelectorAll<HTMLElement>("[data-day-view]").forEach((node) => {
    node.addEventListener("click", () => {
      const mode = node.dataset.dayView;
      if (mode !== "grid" && mode !== "simple") return;
      deps.setDayCalendarViewMode(mode);
      rerender();
    });
  });

  appRoot.querySelectorAll<HTMLElement>("[data-day-item-kind][data-day-item-id]").forEach((node) => {
    node.addEventListener("click", () => {
      if (Date.now() < dayBlockDragState.suppressClickUntil) {
        return;
      }
      const kind = node.dataset.dayItemKind;
      const id = node.dataset.dayItemId;
      if (!id) return;
      if (kind !== "block" && kind !== "event" && kind !== "free") return;
      deps.setDayCalendarSelection({ kind, id });
      rerender();
    });
  });

  appRoot.querySelectorAll<HTMLElement>("[data-block-title-save]").forEach((node) => {
    node.addEventListener("click", () => {
      const blockId = node.dataset.blockTitleSave;
      if (!blockId) return;
      const nearestContainer = node.parentElement || appRoot;
      const scopedInput = nearestContainer.querySelector(`input[data-block-title-input="${blockId}"]`);
      const fallbackInput = appRoot.querySelector(`input[data-block-title-input="${blockId}"]`);
      const input = scopedInput || fallbackInput;
      if (!(input instanceof HTMLInputElement)) return;
      if (!deps.setBlockTitle(blockId, input.value)) return;
      deps.setStatus(input.value.trim() ? "タイトルを保存しました" : "タイトルをクリアしました");
      rerender();
    });
  });
}
