export function renderDayHourGuides(): string {
  return Array.from({ length: 25 }, (_, index) => {
    const top = (index / 24) * 100;
    return `<span class="day-hour-line" style="top:${top}%"></span>`;
  }).join("");
}

export function renderDayTimeAxis(
  dayStartMs: number,
  dayEndMs: number,
  toClockText: (milliseconds: number) => string
): string {
  const totalHours = Math.max(1, Math.round((dayEndMs - dayStartMs) / (60 * 60 * 1000)));
  return `
    <div class="day-time-axis">
      ${renderDayHourGuides()}
      ${Array.from({ length: totalHours + 1 }, (_, index) => {
        const top = (index / totalHours) * 100;
        const clock = toClockText(dayStartMs + index * 60 * 60 * 1000);
        return `<span class="day-time-label" style="top:${top}%">${clock}</span>`;
      }).join("")}
    </div>
  `;
}

type RenderItem = {
  kind?: string;
  id: string;
  key: string;
  title: string;
  startMs: number;
  endMs: number;
  durationMinutes: number;
};

type RenderHelpers = {
  escapeHtml: (value: unknown) => string;
  intervalRangeLabel: (item: unknown) => string;
  toDurationLabel: (minutes: number) => string;
};

export type DayCalendarModel = {
  dayStartMs: number;
  dayEndMs: number;
  blockItems: RenderItem[];
  eventItems: RenderItem[];
  freeItems: RenderItem[];
  busyIntervals: Array<{ startMs: number; endMs: number }>;
  selectedItem: { key?: string } | null;
};

export function renderDayLaneItems(
  kind: string,
  items: RenderItem[],
  dayStartMs: number,
  dayEndMs: number,
  selectedItem: { key?: string } | null,
  helpers: RenderHelpers
): string {
  const totalRange = Math.max(1, dayEndMs - dayStartMs);
  return items
    .map((item) => {
      const top = ((item.startMs - dayStartMs) / totalRange) * 100;
      const baseHeight = ((item.endMs - item.startMs) / totalRange) * 100;
      const minHeight = kind === "free" ? 2.2 : 3.2;
      const height = Math.max(minHeight, baseHeight);
      const compact = height < 7 ? "is-compact" : "";
      const selectedClass = selectedItem && selectedItem.key === item.key ? "is-selected" : "";
      const dragClass = kind === "block" ? "is-draggable" : "";
      return `
        <button
          type="button"
          class="day-entry day-entry-${kind} ${selectedClass} ${compact} ${dragClass}"
          style="top:${top}%;height:${height}%"
          data-day-item-kind="${kind}"
          data-day-item-id="${helpers.escapeHtml(item.id)}"
          data-day-start-ms="${dayStartMs}"
          data-day-end-ms="${dayEndMs}"
          data-day-item-start-ms="${item.startMs}"
          data-day-item-end-ms="${item.endMs}"
          title="${helpers.escapeHtml(`${item.title} | ${helpers.intervalRangeLabel(item)}`)}"
        >
          <span class="day-entry-title">${helpers.escapeHtml(item.title)}</span>
          <span class="day-entry-time">${helpers.intervalRangeLabel(item)}</span>
          <span class="day-entry-duration">${helpers.toDurationLabel(item.durationMinutes)}</span>
        </button>
      `;
    })
    .join("");
}

export function renderCombinedDayLaneItems(
  items: Array<RenderItem & { kind: string }>,
  dayStartMs: number,
  dayEndMs: number,
  selectedItem: { key?: string } | null,
  helpers: RenderHelpers
): string {
  const totalRange = Math.max(1, dayEndMs - dayStartMs);
  return items
    .map((item) => {
      const top = ((item.startMs - dayStartMs) / totalRange) * 100;
      const baseHeight = ((item.endMs - item.startMs) / totalRange) * 100;
      const minHeight = item.kind === "free" ? 2.2 : 3.2;
      const height = Math.max(minHeight, baseHeight);
      const compact = height < 7 ? "is-compact" : "";
      const selectedClass = selectedItem && selectedItem.key === item.key ? "is-selected" : "";
      const dragClass = item.kind === "block" ? "is-draggable" : "";
      return `
        <button
          type="button"
          class="day-entry day-entry-${item.kind} ${selectedClass} ${compact} ${dragClass}"
          style="top:${top}%;height:${height}%"
          data-day-item-kind="${item.kind}"
          data-day-item-id="${helpers.escapeHtml(item.id)}"
          data-day-start-ms="${dayStartMs}"
          data-day-end-ms="${dayEndMs}"
          data-day-item-start-ms="${item.startMs}"
          data-day-item-end-ms="${item.endMs}"
          title="${helpers.escapeHtml(`${item.title} | ${helpers.intervalRangeLabel(item)}`)}"
        >
          <span class="day-entry-title">${helpers.escapeHtml(item.title)}</span>
          <span class="day-entry-time">${helpers.intervalRangeLabel(item)}</span>
          <span class="day-entry-duration">${helpers.toDurationLabel(item.durationMinutes)}</span>
        </button>
      `;
    })
    .join("");
}

export function renderSimpleTimelineSegments(
  kind: string,
  items: RenderItem[],
  dayStartMs: number,
  dayEndMs: number,
  selectedItem: { key?: string } | null,
  helpers: RenderHelpers
): string {
  const totalRange = Math.max(1, dayEndMs - dayStartMs);
  return items
    .map((item) => {
      const left = ((item.startMs - dayStartMs) / totalRange) * 100;
      const width = Math.max(0.9, ((item.endMs - item.startMs) / totalRange) * 100);
      const selectedClass = selectedItem && selectedItem.key === item.key ? "is-selected" : "";
      const dragClass = kind === "block" ? "is-draggable" : "";
      return `
        <button
          type="button"
          class="day-simple-segment day-simple-segment-${kind} ${selectedClass} ${dragClass}"
          style="left:${left}%;width:${width}%"
          data-day-item-kind="${kind}"
          data-day-item-id="${helpers.escapeHtml(item.id)}"
          data-day-start-ms="${dayStartMs}"
          data-day-end-ms="${dayEndMs}"
          data-day-item-start-ms="${item.startMs}"
          data-day-item-end-ms="${item.endMs}"
          title="${helpers.escapeHtml(`${item.title} | ${helpers.intervalRangeLabel(item)}`)}"
        >
          <span>${helpers.escapeHtml(item.title)}</span>
        </button>
      `;
    })
    .join("");
}

export function renderSimpleOccupancySegments(
  intervals: Array<{ startMs: number; endMs: number }>,
  dayStartMs: number,
  dayEndMs: number,
  helpers: {
    intervalRangeLabel: (item: unknown) => string;
    toDurationLabel: (minutes: number) => string;
    minutesBetween: (startMs: number, endMs: number) => number;
  }
): string {
  const totalRange = Math.max(1, dayEndMs - dayStartMs);
  return intervals
    .map((interval) => {
      const left = ((interval.startMs - dayStartMs) / totalRange) * 100;
      const width = Math.max(0.7, ((interval.endMs - interval.startMs) / totalRange) * 100);
      const title = `${helpers.intervalRangeLabel(interval)} (${helpers.toDurationLabel(
        helpers.minutesBetween(interval.startMs, interval.endMs)
      )})`;
      return `<span class="day-simple-occupancy-segment" style="left:${left}%;width:${width}%" title="${title}"></span>`;
    })
    .join("");
}

export function renderSimpleTimelineRow(
  label: string,
  kind: string,
  items: RenderItem[],
  dayStartMs: number,
  dayEndMs: number,
  selectedItem: { key?: string } | null,
  helpers: RenderHelpers
): string {
  const segments = renderSimpleTimelineSegments(kind, items, dayStartMs, dayEndMs, selectedItem, helpers);
  return `
    <div class="day-simple-row">
      <span class="day-simple-row-label">${label}</span>
      <div class="day-simple-track">
        ${segments || '<span class="day-simple-empty">なし</span>'}
      </div>
    </div>
  `;
}

export function renderDayLane(
  label: string,
  kind: string,
  items: RenderItem[],
  dayStartMs: number,
  dayEndMs: number,
  selectedItem: { key?: string } | null,
  helpers: RenderHelpers
): string {
  const entries = renderDayLaneItems(kind, items, dayStartMs, dayEndMs, selectedItem, helpers);
  return `
    <section class="day-lane">
      <header class="day-lane-head">
        <span>${label}</span>
        <span class="small">${items.length}件</span>
      </header>
      <div class="day-lane-track">
        ${renderDayHourGuides()}
        ${entries || '<span class="day-lane-empty">なし</span>'}
      </div>
    </section>
  `;
}

export function renderSimpleTimelineScale(): string {
  return [0, 6, 12, 18, 24]
    .map((hour) => {
      const left = (hour / 24) * 100;
      return `<span style="left:${left}%">${String(hour).padStart(2, "0")}:00</span>`;
    })
    .join("");
}

export function renderSimpleDailyCalendar(
  model: DayCalendarModel,
  options: { includeDetail?: boolean; includeTimeline?: boolean } | undefined,
  deps: RenderHelpers & {
    minutesBetween: (startMs: number, endMs: number) => number;
    renderDailyDetail: (selectedItem: unknown) => string;
  }
): string {
  const includeDetail = options?.includeDetail !== false;
  const includeTimeline = options?.includeTimeline !== false;
  return `
    <div class="day-view-simple">
      ${
        includeTimeline
          ? `
      <div class="panel day-simple-timeline">
        <div class="day-simple-scale">${renderSimpleTimelineScale()}</div>
        <div class="day-simple-row">
          <span class="day-simple-row-label">埋まり具合</span>
          <div class="day-simple-track day-simple-track-occupancy">
            ${renderSimpleOccupancySegments(model.busyIntervals, model.dayStartMs, model.dayEndMs, {
              intervalRangeLabel: deps.intervalRangeLabel,
              toDurationLabel: deps.toDurationLabel,
              minutesBetween: deps.minutesBetween,
            })}
          </div>
        </div>
        ${renderSimpleTimelineRow("ブロック", "block", model.blockItems, model.dayStartMs, model.dayEndMs, model.selectedItem, deps)}
        ${renderSimpleTimelineRow("予定", "event", model.eventItems, model.dayStartMs, model.dayEndMs, model.selectedItem, deps)}
        ${renderSimpleTimelineRow("空き枠", "free", model.freeItems, model.dayStartMs, model.dayEndMs, model.selectedItem, deps)}
      </div>
      `
          : ""
      }
      ${includeDetail ? deps.renderDailyDetail(model.selectedItem) : ""}
    </div>
  `;
}

export function renderGridDailyCalendar(
  model: DayCalendarModel,
  options: { includeDetail?: boolean; includeBoard?: boolean } | undefined,
  deps: RenderHelpers & { renderDailyDetail: (selectedItem: unknown) => string; toClockText: (milliseconds: number) => string }
): string {
  const includeDetail = options?.includeDetail !== false;
  const includeBoard = options?.includeBoard !== false;
  return `
    <div class="day-view-grid ${includeBoard ? "" : "is-detail-only"}">
      ${
        includeBoard
          ? `
      <div class="day-board">
        <div class="day-board-head">
          <span class="day-board-head-time">時刻</span>
          <span>ブロック</span>
          <span>予定</span>
          <span>空き枠</span>
        </div>
        <div class="day-board-body">
          ${renderDayTimeAxis(model.dayStartMs, model.dayEndMs, deps.toClockText)}
          ${renderDayLane("ブロック", "block", model.blockItems, model.dayStartMs, model.dayEndMs, model.selectedItem, deps)}
          ${renderDayLane("予定", "event", model.eventItems, model.dayStartMs, model.dayEndMs, model.selectedItem, deps)}
          ${renderDayLane("空き枠", "free", model.freeItems, model.dayStartMs, model.dayEndMs, model.selectedItem, deps)}
        </div>
      </div>
      `
          : ""
      }
      ${includeDetail ? deps.renderDailyDetail(model.selectedItem) : ""}
    </div>
  `;
}

export function renderWeeklyPlannerCalendar(
  model: {
    days: Array<{
      isCurrent: boolean;
      dayNumber: string;
      weekdayLabel: string;
      combinedItems: Array<RenderItem & { kind: string }>;
      dayStartMs: number;
      dayEndMs: number;
    }>;
    selectedItem: { key?: string } | null;
  },
  deps: RenderHelpers & { toClockText: (milliseconds: number) => string }
): string {
  if (!model.days.length) {
    return '<div class="panel"><p class="small">週次データがありません。</p></div>';
  }
  const gridColumns = `84px repeat(${model.days.length}, minmax(150px, 1fr))`;
  return `
    <div class="week-board">
      <div class="week-board-head" style="grid-template-columns:${gridColumns}">
        <span class="week-board-head-time">時刻</span>
        ${model.days
          .map(
            (day) => `
          <span class="week-board-day ${day.isCurrent ? "is-current" : ""}">
            <small>${day.weekdayLabel}</small>
            <strong>${day.dayNumber}</strong>
          </span>
        `
          )
          .join("")}
      </div>
      <div class="week-board-body" style="grid-template-columns:${gridColumns}">
        ${renderDayTimeAxis(model.days[0]?.dayStartMs || 0, model.days[0]?.dayEndMs || 0, deps.toClockText)}
        ${model.days
          .map((day) => {
            const entries = renderCombinedDayLaneItems(day.combinedItems, day.dayStartMs, day.dayEndMs, model.selectedItem, deps);
            return `
              <section class="week-day-lane ${day.isCurrent ? "is-current" : ""}">
                <div class="day-lane-track week-day-track">
                  ${renderDayHourGuides()}
                  ${entries || '<span class="day-lane-empty">なし</span>'}
                </div>
              </section>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

export function renderDailyDetail(
  selectedItem: unknown,
  deps: RenderHelpers & { blockTitle: (block: unknown) => string }
): string {
  const item = selectedItem as
    | {
        kind: string;
        durationMinutes: number;
        payload: Record<string, unknown>;
      }
    | null;

  if (!item) {
    return `
      <div class="day-detail panel">
        <h4>詳細</h4>
        <p class="small">表示対象がありません。</p>
      </div>
    `;
  }
  if (item.kind === "block") {
    const block = item.payload;
    const titleValue = deps.blockTitle(block);
    return `
      <div class="day-detail panel">
        <h4>ブロック詳細</h4>
        <div class="row">
          <label style="flex:1">
            タイトル
            <input
              type="text"
              value="${deps.escapeHtml(titleValue)}"
              data-block-title-input="${deps.escapeHtml(block.id || "")}"
              placeholder="タイトルなし"
            />
          </label>
          <button type="button" class="btn-secondary" data-block-title-save="${deps.escapeHtml(block.id || "")}">タイトル保存</button>
        </div>
        <dl class="day-detail-list">
          <div><dt>ID</dt><dd>${deps.escapeHtml(block.id || "")}</dd></div>
          <div><dt>時間</dt><dd>${deps.intervalRangeLabel(item)}</dd></div>
          <div><dt>長さ</dt><dd>${deps.toDurationLabel(item.durationMinutes)}</dd></div>
          <div><dt>Firmness</dt><dd>${deps.escapeHtml(block.firmness || "-")}</dd></div>
          <div><dt>予定ポモドーロ</dt><dd>${Number.isFinite(Number(block.planned_pomodoros)) ? block.planned_pomodoros : "-"}</dd></div>
          <div><dt>Source</dt><dd>${deps.escapeHtml(block.source || "-")}</dd></div>
        </dl>
      </div>
    `;
  }
  if (item.kind === "event") {
    const event = item.payload;
    return `
      <div class="day-detail panel">
        <h4>予定詳細</h4>
        <dl class="day-detail-list">
          <div><dt>タイトル</dt><dd>${deps.escapeHtml(event.title || "予定")}</dd></div>
          <div><dt>時間</dt><dd>${deps.intervalRangeLabel(item)}</dd></div>
          <div><dt>長さ</dt><dd>${deps.toDurationLabel(item.durationMinutes)}</dd></div>
          <div><dt>Event ID</dt><dd>${deps.escapeHtml(event.id || "-")}</dd></div>
          <div><dt>Account</dt><dd>${deps.escapeHtml(event.account_id || "-")}</dd></div>
        </dl>
      </div>
    `;
  }
  return `
    <div class="day-detail panel">
      <h4>空き枠詳細</h4>
      <dl class="day-detail-list">
        <div><dt>時間</dt><dd>${deps.intervalRangeLabel(item)}</dd></div>
        <div><dt>長さ</dt><dd>${deps.toDurationLabel(item.durationMinutes)}</dd></div>
        <div><dt>種別</dt><dd>ブロック作成可能な時間帯</dd></div>
      </dl>
    </div>
  `;
}

export function renderDailyCalendar(
  params: {
    dateValue: string;
    model: DayCalendarModel & { totals: { blockMinutes: number; eventMinutes: number; freeMinutes: number } };
    mode: "grid" | "simple";
    panelClass: string;
    showHeader: boolean;
    showMetrics: boolean;
    showViewToggle: boolean;
    includeDetail: boolean;
    includeBoard: boolean;
    includeTimeline: boolean;
  },
  deps: RenderHelpers & {
    timezoneOffsetLabel: () => string;
    renderSimpleDailyCalendar: (model: DayCalendarModel, options: { includeDetail?: boolean; includeTimeline?: boolean }) => string;
    renderGridDailyCalendar: (model: DayCalendarModel, options: { includeDetail?: boolean; includeBoard?: boolean }) => string;
  }
): string {
  return `
    <div class="panel day-calendar${params.panelClass}">
      ${
        params.showHeader
          ? `
      <div class="row spread">
        <h3>1日の時間ビュー</h3>
        <span class="small">${deps.escapeHtml(params.dateValue)} / ${deps.timezoneOffsetLabel()}</span>
      </div>
      `
          : ""
      }
      ${
        params.showMetrics
          ? `
      <div class="calendar-metrics">
        <span class="pill calendar-pill block">ブロック ${deps.toDurationLabel(params.model.totals.blockMinutes)}</span>
        <span class="pill calendar-pill event">予定 ${deps.toDurationLabel(params.model.totals.eventMinutes)}</span>
        <span class="pill calendar-pill free">空き ${deps.toDurationLabel(params.model.totals.freeMinutes)}</span>
      </div>
      `
          : ""
      }
      ${
        params.showViewToggle
          ? `
      <div class="day-view-toggle" role="group" aria-label="表示モード切替">
        <button
          type="button"
          class="btn-secondary ${params.mode === "grid" ? "is-active" : ""}"
          data-day-view="grid"
          aria-pressed="${params.mode === "grid"}"
        >
          詳細グリッド
        </button>
        <button
          type="button"
          class="btn-secondary ${params.mode === "simple" ? "is-active" : ""}"
          data-day-view="simple"
          aria-pressed="${params.mode === "simple"}"
        >
          シンプル
        </button>
      </div>
      `
          : ""
      }
      ${
        params.mode === "simple"
          ? deps.renderSimpleDailyCalendar(params.model, { includeDetail: params.includeDetail, includeTimeline: params.includeTimeline })
          : deps.renderGridDailyCalendar(params.model, { includeDetail: params.includeDetail, includeBoard: params.includeBoard })
      }
    </div>
  `;
}
