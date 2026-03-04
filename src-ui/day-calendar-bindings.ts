import { bindDayBlockDragInteractions } from "./day-block-dnd.js";
import { bindDayCalendarEvents } from "./day-calendar-events.js";
import type { Block, DayBlockDragState } from "./types.js";

export function blockRows(
  blocks: Block[],
  helpers: {
    blockDisplayName: (block: Block) => string;
    formatTime: (value: string | null | undefined) => string;
  }
): string {
  return blocks
    .map(
      (block: Block) => `
      <tr>
        <td>${helpers.blockDisplayName(block)}</td>
        <td>${helpers.formatTime(block.start_at)}</td>
        <td>${helpers.formatTime(block.end_at)}</td>
        <td><span class="pill">${block.firmness}</span></td>
      </tr>`
    )
    .join("");
}

export function bindDailyCalendarInteractions(deps: {
  appRoot: HTMLElement;
  rerender: () => void;
  dayBlockDragState: DayBlockDragState;
  intervalRangeLabel: (interval: unknown) => string;
  blockDisplayName: (block: { start_at: string; end_at: string; date?: string }) => string;
  toClockText: (milliseconds: number) => string;
  getDashboardDate: () => string;
  setStatus: (message: string) => void;
  setSelectedBlock: (blockId: string) => void;
  setDayCalendarViewMode: (mode: "grid" | "simple") => void;
  setDayCalendarSelection: (selection: { kind: "block" | "event" | "free"; id: string }) => void;
  setBlockTitle: (blockId: string, title: string) => boolean;
  runUiAction: (action: () => Promise<void>) => Promise<void>;
  safeInvoke: (name: string, payload: Record<string, unknown>) => Promise<unknown>;
  refreshCoreData: (date: string) => Promise<void>;
}) {
  bindDayCalendarEvents({
    appRoot: deps.appRoot,
    rerender: deps.rerender,
    dayBlockDragState: deps.dayBlockDragState,
    bindDayBlockDrag: () =>
      bindDayBlockDragInteractions({
        appRoot: deps.appRoot,
        state: deps.dayBlockDragState,
        rerender: deps.rerender,
        intervalRangeLabel: (interval) => deps.intervalRangeLabel(interval),
        blockDisplayName: deps.blockDisplayName,
        toClockText: deps.toClockText,
        getDashboardDate: deps.getDashboardDate,
        setStatus: deps.setStatus,
        setSelectedBlock: deps.setSelectedBlock,
        runUiAction: deps.runUiAction,
        safeInvoke: deps.safeInvoke,
        refreshCoreData: deps.refreshCoreData,
      }),
    setDayCalendarViewMode: deps.setDayCalendarViewMode,
    setDayCalendarSelection: deps.setDayCalendarSelection,
    setBlockTitle: deps.setBlockTitle,
    setStatus: deps.setStatus,
  });
}
