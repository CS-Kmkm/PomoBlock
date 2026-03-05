import { randomUUID } from "node:crypto";

export type BlockType = "deep" | "shallow" | "admin" | "learning";
export type Firmness = "draft" | "soft" | "hard";
export type BlockStatus = "planned" | "running" | "done" | "partial" | "skipped";
export type TaskStatus = "pending" | "in_progress" | "completed" | "deferred";
export type PomodoroPhase = "focus" | "break" | "long_break" | "paused";
export type OverrideMode = "none" | "soft" | "hard" | "temporary";

export interface WorkHours {
  start: string;
  end: string;
  days: string[];
}

export interface Policy {
  workHours: WorkHours;
  timezone: string;
  blockDurationMinutes: number;
  breakDurationMinutes: number;
  minBlockGapMinutes: number;
}

export interface PolicyOverride {
  mode: OverrideMode;
  value: Record<string, unknown>;
  weight: number;
  validFrom: string | null;
  validTo: string | null;
}

export interface Block {
  id: string;
  instance: string;
  date: string;
  startAt: string;
  endAt: string;
  type: BlockType;
  firmness: Firmness;
  plannedPomodoros: number;
  status: BlockStatus;
  source: string;
  sourceId: string | null;
  taskRefs: string[];
  calendarEventId: string | null;
  taskId: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  estimatedPomodoros: number | null;
  completedPomodoros: number;
  status: TaskStatus;
  createdAt: string;
}

export interface PomodoroLog {
  id: string;
  blockId: string;
  taskId: string | null;
  phase: PomodoroPhase;
  startTime: string;
  endTime: string | null;
  interruptionReason: string | null;
}

export interface PomodoroState {
  currentBlockId: string | null;
  currentTaskId: string | null;
  phase: PomodoroPhase | "idle";
  remainingSeconds: number;
  startTime: string | null;
  totalCycles: number;
  completedCycles: number;
  currentCycle: number;
}

export interface Routine {
  id: string;
  name: string;
  rrule: string;
  default: Record<string, unknown>;
  exceptions: unknown[];
}

export type RoutineInput = Partial<Routine> & Pick<Routine, "id" | "name" | "rrule">;

export interface Template {
  id: string;
  name: string;
  durationMinutes: number;
  defaultTasks: unknown[];
}

export type TemplateInput = Partial<Template> & Pick<Template, "id" | "name" | "durationMinutes">;

const BLOCK_TYPES = ["deep", "shallow", "admin", "learning"];
const FIRMNESS_VALUES = ["draft", "soft", "hard"];
const BLOCK_STATUS_VALUES = ["planned", "running", "done", "partial", "skipped"];
const TASK_STATUS_VALUES = ["pending", "in_progress", "completed", "deferred"];
const POMODORO_PHASE_VALUES = ["focus", "break", "long_break", "paused"];
const OVERRIDE_MODE_VALUES = ["none", "soft", "hard", "temporary"];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function toIsoDateTime(value: string | Date, fieldName: string): string {
  const date = new Date(value);
  assert(!Number.isNaN(date.getTime()), `${fieldName} must be a valid date-time`);
  return date.toISOString();
}

function validateEnum(value: string, allowedValues: readonly string[], fieldName: string): void {
  assert(
    allowedValues.includes(value),
    `${fieldName} must be one of: ${allowedValues.join(", ")}`
  );
}

function validateNonEmptyString(value: unknown, fieldName: string): void {
  assert(typeof value === "string" && value.trim().length > 0, `${fieldName} is required`);
}

function validateTime(value: unknown, fieldName: string): void {
  assert(
    typeof value === "string" && /^[0-2]\d:[0-5]\d$/.test(value),
    `${fieldName} must be HH:MM`
  );
}

function validateDate(value: unknown, fieldName: string): void {
  assert(
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
    `${fieldName} must be YYYY-MM-DD`
  );
}

function validateInteger(value: unknown, fieldName: string, min = Number.MIN_SAFE_INTEGER): void {
  assert(typeof value === "number" && Number.isInteger(value) && value >= min, `${fieldName} must be an integer >= ${min}`);
}

function validateTimeZone(value: unknown, fieldName: string): void {
  validateNonEmptyString(value, fieldName);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value as string });
  } catch {
    throw new Error(`${fieldName} must be a valid IANA time zone`);
  }
}

export function createWorkHours(input: Partial<WorkHours> = {}): WorkHours {
  const workHours = {
    start: input.start ?? "09:00",
    end: input.end ?? "18:00",
    days: input.days ?? ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  };

  validateTime(workHours.start, "workHours.start");
  validateTime(workHours.end, "workHours.end");
  assert(Array.isArray(workHours.days) && workHours.days.length > 0, "workHours.days is required");
  for (const day of workHours.days) {
    validateNonEmptyString(day, "workHours.days[]");
  }

  return workHours;
}

export function createPolicy(input: Partial<Policy> = {}): Policy {
  const policy = {
    workHours: createWorkHours(input.workHours),
    timezone: input.timezone ?? "UTC",
    blockDurationMinutes: input.blockDurationMinutes ?? 60,
    breakDurationMinutes: input.breakDurationMinutes ?? 5,
    minBlockGapMinutes: input.minBlockGapMinutes ?? 0,
  };

  validateTimeZone(policy.timezone, "timezone");
  validateInteger(policy.blockDurationMinutes, "blockDurationMinutes", 1);
  validateInteger(policy.breakDurationMinutes, "breakDurationMinutes", 1);
  validateInteger(policy.minBlockGapMinutes, "minBlockGapMinutes", 0);

  return policy;
}

export function createPolicyOverride(input: Partial<PolicyOverride> = {}): PolicyOverride {
  const override = {
    mode: input.mode ?? "none",
    value: input.value ?? {},
    weight: input.weight ?? 1,
    validFrom: input.validFrom ?? null,
    validTo: input.validTo ?? null,
  };

  validateEnum(override.mode, OVERRIDE_MODE_VALUES, "override.mode");
  assert(typeof override.value === "object" && override.value !== null, "override.value must be object");
  assert(typeof override.weight === "number", "override.weight must be a number");
  if (override.validFrom !== null) {
    override.validFrom = toIsoDateTime(override.validFrom, "override.validFrom");
  }
  if (override.validTo !== null) {
    override.validTo = toIsoDateTime(override.validTo, "override.validTo");
  }

  return override;
}

export function createBlock(input: Partial<Block> & Pick<Block, "startAt" | "endAt">): Block {
  assert(typeof input === "object" && input !== null, "block input is required");
  validateNonEmptyString(input.startAt, "startAt");
  validateNonEmptyString(input.endAt, "endAt");

  const startAt = toIsoDateTime(input.startAt, "startAt");
  const endAt = toIsoDateTime(input.endAt, "endAt");
  const start = new Date(startAt);
  const end = new Date(endAt);
  assert(end > start, "endAt must be after startAt");

  const id = input.id ?? randomUUID();
  const source = input.source ?? "manual";
  const sourceId = input.sourceId ?? null;
  const createdAt = toIsoDateTime(input.createdAt ?? new Date().toISOString(), "createdAt");
  const plannedPomodoros = input.plannedPomodoros ?? 1;
  const date = input.date ?? startAt.slice(0, 10);
  const instance =
    input.instance ??
    (source === "manual"
      ? `man:${id}`
      : `${source}:${sourceId ?? "unknown"}:${date}`);
  const taskRefs = input.taskRefs ?? [];

  validateNonEmptyString(id, "id");
  validateNonEmptyString(instance, "instance");
  validateDate(date, "date");
  validateEnum(input.type ?? "deep", BLOCK_TYPES, "type");
  validateEnum(input.firmness ?? "draft", FIRMNESS_VALUES, "firmness");
  validateEnum(input.status ?? "planned", BLOCK_STATUS_VALUES, "status");
  validateInteger(plannedPomodoros, "plannedPomodoros", 0);
  assert(Array.isArray(taskRefs), "taskRefs must be an array");

  return {
    id,
    instance,
    date,
    startAt,
    endAt,
    type: input.type ?? "deep",
    firmness: input.firmness ?? "draft",
    plannedPomodoros,
    status: input.status ?? "planned",
    source,
    sourceId,
    taskRefs,
    calendarEventId: input.calendarEventId ?? null,
    taskId: input.taskId ?? null,
    createdAt,
  };
}

export function createTask(input: Partial<Task> & Pick<Task, "title">): Task {
  assert(typeof input === "object" && input !== null, "task input is required");
  validateNonEmptyString(input.title, "title");

  const task = {
    id: input.id ?? randomUUID(),
    title: input.title.trim(),
    description: input.description ?? null,
    estimatedPomodoros: input.estimatedPomodoros ?? null,
    completedPomodoros: input.completedPomodoros ?? 0,
    status: input.status ?? "pending",
    createdAt: toIsoDateTime(input.createdAt ?? new Date().toISOString(), "createdAt"),
  };

  if (task.estimatedPomodoros !== null) {
    validateInteger(task.estimatedPomodoros, "estimatedPomodoros", 0);
  }
  validateInteger(task.completedPomodoros, "completedPomodoros", 0);
  validateEnum(task.status, TASK_STATUS_VALUES, "status");

  return task;
}

export function createPomodoroLog(
  input: Partial<PomodoroLog> & Pick<PomodoroLog, "blockId" | "startTime">
): PomodoroLog {
  assert(typeof input === "object" && input !== null, "pomodoro log input is required");
  validateNonEmptyString(input.blockId, "blockId");
  validateNonEmptyString(input.startTime, "startTime");

  const log = {
    id: input.id ?? randomUUID(),
    blockId: input.blockId,
    taskId: input.taskId ?? null,
    phase: input.phase ?? "focus",
    startTime: toIsoDateTime(input.startTime, "startTime"),
    endTime: input.endTime ? toIsoDateTime(input.endTime, "endTime") : null,
    interruptionReason: input.interruptionReason ?? null,
  };

  validateEnum(log.phase, POMODORO_PHASE_VALUES, "phase");
  if (log.endTime !== null) {
    assert(new Date(log.endTime) >= new Date(log.startTime), "endTime must be after startTime");
  }

  return log;
}

export function createRoutine(input: RoutineInput): Routine {
  assert(typeof input === "object" && input !== null, "routine input is required");
  validateNonEmptyString(input.id, "routine.id");
  validateNonEmptyString(input.name, "routine.name");
  validateNonEmptyString(input.rrule, "routine.rrule");

  return {
    id: input.id,
    name: input.name,
    rrule: input.rrule,
    default: input.default ?? {},
    exceptions: input.exceptions ?? [],
  };
}

export function createTemplate(input: TemplateInput): Template {
  assert(typeof input === "object" && input !== null, "template input is required");
  validateNonEmptyString(input.id, "template.id");
  validateNonEmptyString(input.name, "template.name");
  validateInteger(input.durationMinutes, "template.durationMinutes", 1);
  assert(Array.isArray(input.defaultTasks ?? []), "template.defaultTasks must be an array");

  return {
    id: input.id,
    name: input.name,
    durationMinutes: input.durationMinutes,
    defaultTasks: input.defaultTasks ?? [],
  };
}

export const enums = Object.freeze({
  BLOCK_TYPES,
  FIRMNESS_VALUES,
  BLOCK_STATUS_VALUES,
  TASK_STATUS_VALUES,
  POMODORO_PHASE_VALUES,
  OVERRIDE_MODE_VALUES,
});
