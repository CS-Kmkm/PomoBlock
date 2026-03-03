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
