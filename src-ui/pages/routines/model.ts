import type { Module } from "../../types.js";

export type RoutineStudioModuleView = {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  durationMinutes: number;
};

export type RoutineStudioEntryView = {
  entryId: string;
  sourceKind: string;
  sourceId: string;
  moduleId: string;
  title: string;
  subtitle: string;
  durationMinutes: number;
  note: string;
  stepType: string;
  checklist: string[];
  pomodoro: Record<string, unknown> | null;
  executionHints: Record<string, unknown> | null;
  overrunPolicy: string;
  rawStep: Record<string, unknown>;
};

export function toPositiveInt(value: unknown, fallback: number, min = 1): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Math.max(min, Math.round(parsed));
  }
  return Math.max(min, Math.round(fallback));
}

export const routineStudioSeedModules: Module[] = [
  {
    id: "mod-deep-work-init",
    name: "Deep Work Init",
    category: "Focus Work",
    description: "Environment prep",
    icon: "spark",
    durationMinutes: 5,
    stepType: "micro",
    checklist: ["Close distracting tabs", "Set Slack to Away", "Enable Do Not Disturb"],
    pomodoro: null,
    overrunPolicy: "wait",
    executionHints: {
      allowSkip: true,
      mustCompleteChecklist: false,
      autoAdvance: true,
    },
  },
  {
    id: "mod-pomodoro-focus",
    name: "Pomodoro Focus",
    category: "Focus Work",
    description: "25m work block",
    icon: "timer",
    durationMinutes: 25,
    stepType: "pomodoro",
    pomodoro: {
      focusSeconds: 1500,
      breakSeconds: 300,
      cycles: 1,
      longBreakSeconds: 900,
      longBreakEvery: 4,
    },
    checklist: ["Focus on one task only", "No context switching"],
    overrunPolicy: "wait",
    executionHints: {
      allowSkip: true,
      mustCompleteChecklist: false,
      autoAdvance: true,
    },
  },
  {
    id: "mod-two-min-triage",
    name: "2m Triage",
    category: "Communication",
    description: "Quick inbox sort",
    icon: "mail",
    durationMinutes: 2,
    stepType: "micro",
    checklist: ["Reply, archive, or defer", "No deep replies"],
    pomodoro: null,
    overrunPolicy: "wait",
    executionHints: {
      allowSkip: true,
      mustCompleteChecklist: false,
      autoAdvance: true,
    },
  },
  {
    id: "mod-slack-status",
    name: "Slack Status",
    category: "Communication",
    description: "Update availability",
    icon: "chat",
    durationMinutes: 3,
    stepType: "micro",
    checklist: ["Set current status", "Confirm mention rules"],
    pomodoro: null,
    overrunPolicy: "wait",
    executionHints: {
      allowSkip: true,
      mustCompleteChecklist: false,
      autoAdvance: true,
    },
  },
  {
    id: "mod-break-reset",
    name: "Reset Break",
    category: "Recovery",
    description: "Short recovery",
    icon: "break",
    durationMinutes: 5,
    stepType: "free",
    checklist: ["Leave desk", "Hydrate", "Eye rest"],
    pomodoro: null,
    overrunPolicy: "wait",
    executionHints: {
      allowSkip: true,
      mustCompleteChecklist: false,
      autoAdvance: true,
    },
  },
  {
    id: "mod-plan-next",
    name: "Plan Next",
    category: "Planning",
    description: "Choose next task",
    icon: "plan",
    durationMinutes: 4,
    stepType: "micro",
    checklist: ["Pick next high-impact task", "Write first action"],
    pomodoro: null,
    overrunPolicy: "wait",
    executionHints: {
      allowSkip: true,
      mustCompleteChecklist: false,
      autoAdvance: true,
    },
  },
];

export const routineStudioContexts = ["Work - Deep Focus", "Admin", "Planning", "Learning", "Personal"];

let routineStudioSequence = 1;

export function nextRoutineStudioEntryId() {
  const id = `studio-entry-${routineStudioSequence}`;
  routineStudioSequence += 1;
  return id;
}

export function routineStudioStepDurationMinutes(step: unknown) {
  const source = (step ?? {}) as Record<string, unknown>;
  const seconds = Number(source.durationSeconds || source.duration_seconds || 0);
  if (Number.isFinite(seconds) && seconds > 0) return Math.max(1, Math.round(seconds / 60));
  const minutes = Number(source.durationMinutes || source.duration_minutes || 0);
  return Number.isFinite(minutes) && minutes > 0 ? toPositiveInt(minutes, 1) : 0;
}

export function routineStudioSlug(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isRoutineStudioRecipe(recipe: unknown) {
  const source = (recipe ?? {}) as Record<string, unknown>;
  const meta = (source.studioMeta || source.studio_meta || null) as Record<string, unknown> | null;
  return meta?.kind === "routine_studio";
}

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}
