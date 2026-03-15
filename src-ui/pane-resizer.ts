type PaneResizeConfig = {
  layoutSelector: string;
  handleSelector: string;
  paneSelector: string;
  cssVar: string;
  storageKey: string;
  edge: "left" | "right";
  minWidth: number;
  maxWidth: number;
  mainMinWidth: number;
  oppositePaneSelector?: string;
  splitterCount?: number;
};

const DEFAULT_SPLITTER_SIZE = 10;

function readStoredWidth(storageKey: string): number | null {
  try {
    const value = window.localStorage.getItem(storageKey);
    if (!value) {
      return null;
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredWidth(storageKey: string, width: number): void {
  try {
    window.localStorage.setItem(storageKey, String(Math.round(width)));
  } catch {
    // Ignore localStorage failures and keep the in-memory layout update.
  }
}

function resolveVisibleWidth(layout: Element, selector: string | undefined): number {
  if (!selector) {
    return 0;
  }
  const pane = layout.querySelector<HTMLElement>(selector);
  if (!(pane instanceof HTMLElement)) {
    return 0;
  }
  const style = window.getComputedStyle(pane);
  if (style.display === "none") {
    return 0;
  }
  return pane.getBoundingClientRect().width;
}

function clampPaneWidth(layout: HTMLElement, config: PaneResizeConfig, rawWidth: number): number {
  const oppositeWidth = resolveVisibleWidth(layout, config.oppositePaneSelector);
  const splitterCount = config.splitterCount ?? 1;
  const availableMax = layout.getBoundingClientRect().width - config.mainMinWidth - oppositeWidth - splitterCount * DEFAULT_SPLITTER_SIZE;
  const clampedMax = Math.max(config.minWidth, Math.min(config.maxWidth, availableMax));
  return Math.max(config.minWidth, Math.min(rawWidth, clampedMax));
}

function applyWidth(layout: HTMLElement, config: PaneResizeConfig, width: number): void {
  const nextWidth = clampPaneWidth(layout, config, width);
  layout.style.setProperty(config.cssVar, `${Math.round(nextWidth)}px`);
  writeStoredWidth(config.storageKey, nextWidth);
}

export function bindPaneResizers(root: ParentNode, configs: PaneResizeConfig[]): void {
  configs.forEach((config) => {
    const handle = root.querySelector<HTMLElement>(config.handleSelector);
    const layout = root.querySelector<HTMLElement>(config.layoutSelector);
    if (!(handle instanceof HTMLElement) || !(layout instanceof HTMLElement)) {
      return;
    }

    const storedWidth = readStoredWidth(config.storageKey);
    if (storedWidth !== null) {
      applyWidth(layout, config, storedWidth);
    }

    handle.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      const pane = layout.querySelector<HTMLElement>(config.paneSelector);
      if (!(pane instanceof HTMLElement)) {
        return;
      }

      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add("is-resizing-pane");

      const onMove = (moveEvent: PointerEvent) => {
        const layoutRect = layout.getBoundingClientRect();
        const rawWidth =
          config.edge === "left"
            ? moveEvent.clientX - layoutRect.left
            : layoutRect.right - moveEvent.clientX;
        applyWidth(layout, config, rawWidth);
      };

      const onUp = (upEvent: PointerEvent) => {
        if (handle.hasPointerCapture(upEvent.pointerId)) {
          handle.releasePointerCapture(upEvent.pointerId);
        }
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        document.body.classList.remove("is-resizing-pane");
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  });
}
