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
