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

function readSplitterSize(layout: HTMLElement): number {
  const raw = window.getComputedStyle(layout).getPropertyValue("--pane-splitter-size").trim();
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

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
  const splitterSize = readSplitterSize(layout);
  const availableMax = layout.getBoundingClientRect().width - config.mainMinWidth - oppositeWidth - splitterCount * splitterSize;
  const clampedMax = Math.max(config.minWidth, Math.min(config.maxWidth, availableMax));
  return Math.max(config.minWidth, Math.min(rawWidth, clampedMax));
}

function applyLiveWidth(layout: HTMLElement, config: PaneResizeConfig, width: number): number {
  const nextWidth = clampPaneWidth(layout, config, width);
  layout.style.setProperty(config.cssVar, `${Math.round(nextWidth)}px`);
  return nextWidth;
}

function applyWidth(layout: HTMLElement, config: PaneResizeConfig, width: number): void {
  const nextWidth = applyLiveWidth(layout, config, width);
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
        applyLiveWidth(layout, config, rawWidth);
      };

      const onUp = (upEvent: PointerEvent) => {
        if (handle.hasPointerCapture(upEvent.pointerId)) {
          handle.releasePointerCapture(upEvent.pointerId);
        }
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        document.body.classList.remove("is-resizing-pane");
        const layoutRect = layout.getBoundingClientRect();
        const rawWidth =
          config.edge === "left"
            ? upEvent.clientX - layoutRect.left
            : layoutRect.right - upEvent.clientX;
        applyWidth(layout, config, rawWidth);
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });

    handle.addEventListener("keydown", (event: KeyboardEvent) => {
      const STEP = 20;
      const LARGE_STEP = 80;
      const pane = layout.querySelector<HTMLElement>(config.paneSelector);
      if (!pane) {
        return;
      }
      const currentWidth = pane.getBoundingClientRect().width;
      let delta = 0;
      if (event.key === "ArrowLeft") {
        delta = config.edge === "left" ? -STEP : STEP;
      } else if (event.key === "ArrowRight") {
        delta = config.edge === "left" ? STEP : -STEP;
      } else if (event.key === "Home") {
        applyWidth(layout, config, config.minWidth);
        event.preventDefault();
        return;
      } else if (event.key === "End") {
        applyWidth(layout, config, config.maxWidth);
        event.preventDefault();
        return;
      } else {
        return;
      }
      if (event.shiftKey) {
        delta = Math.sign(delta) * LARGE_STEP;
      }
      event.preventDefault();
      applyWidth(layout, config, currentWidth + delta);
    });
  });
}
