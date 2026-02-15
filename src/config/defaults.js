export const DEFAULT_CONFIGS = Object.freeze({
  "app.json": {
    schema: 1,
    appName: "PomBlock",
    timezone: "UTC",
    blocksCalendarName: "Blocks",
  },
  "calendars.json": {
    schema: 1,
    blocksCalendarId: null,
    busyCalendarIds: ["primary"],
  },
  "policies.json": {
    schema: 1,
    workHours: {
      start: "09:00",
      end: "18:00",
      days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    },
    generation: {
      autoEnabled: true,
      autoTime: "05:30",
      catchUpOnAppStart: true,
      placementStrategy: "keep",
      maxShiftMinutes: 120,
      createIfNoSlot: false,
      respectSuppression: true,
    },
    blockDurationMinutes: 50,
    breakDurationMinutes: 10,
    minBlockGapMinutes: 5,
  },
  "templates.json": {
    schema: 1,
    templates: [],
  },
  "routines.json": {
    schema: 1,
    routines: [],
  },
  "overrides.json": {
    schema: 1,
    mode: "none",
    value: {},
  },
});
