import { createPolicy } from "./models.js";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function timeToMinutes(timeString) {
  const [hours, minutes] = timeString.split(":").map(Number);
  return hours * 60 + minutes;
}

function dateToMinuteOfDay(date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function clonePolicy(policy) {
  return {
    workHours: {
      start: policy.workHours.start,
      end: policy.workHours.end,
      days: [...policy.workHours.days],
    },
    blockDurationMinutes: policy.blockDurationMinutes,
    breakDurationMinutes: policy.breakDurationMinutes,
    minBlockGapMinutes: policy.minBlockGapMinutes,
  };
}

function mergePolicy(basePolicy, overrideValue) {
  const merged = clonePolicy(basePolicy);

  if (overrideValue.workHours) {
    merged.workHours = {
      ...merged.workHours,
      ...overrideValue.workHours,
      days: overrideValue.workHours.days
        ? [...overrideValue.workHours.days]
        : merged.workHours.days,
    };
  }
  if (typeof overrideValue.blockDurationMinutes === "number") {
    merged.blockDurationMinutes = overrideValue.blockDurationMinutes;
  }
  if (typeof overrideValue.breakDurationMinutes === "number") {
    merged.breakDurationMinutes = overrideValue.breakDurationMinutes;
  }
  if (typeof overrideValue.minBlockGapMinutes === "number") {
    merged.minBlockGapMinutes = overrideValue.minBlockGapMinutes;
  }

  return merged;
}

function blendNumber(baseValue, overrideValue, weight) {
  if (typeof overrideValue !== "number") {
    return baseValue;
  }
  return Math.max(1, Math.round(baseValue * (1 - weight) + overrideValue * weight));
}

function isTemporaryOverrideActive(override, now) {
  if (override.mode !== "temporary") {
    return false;
  }
  if (!override.validFrom || !override.validTo) {
    return true;
  }
  const from = new Date(override.validFrom);
  const to = new Date(override.validTo);
  return now >= from && now <= to;
}

export function isWithinWorkHours(policyInput, value) {
  const policy = createPolicy(policyInput);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const dayName = DAY_NAMES[date.getUTCDay()];
  if (!policy.workHours.days.includes(dayName)) {
    return false;
  }

  const minute = dateToMinuteOfDay(date);
  const workStart = timeToMinutes(policy.workHours.start);
  const workEnd = timeToMinutes(policy.workHours.end);

  return minute >= workStart && minute < workEnd;
}

export function filterSlots(policyInput, slots) {
  const policy = createPolicy(policyInput);
  const filtered = [];

  for (const slot of slots) {
    const slotStart = new Date(slot.startAt);
    const slotEnd = new Date(slot.endAt);
    if (Number.isNaN(slotStart.getTime()) || Number.isNaN(slotEnd.getTime()) || slotEnd <= slotStart) {
      continue;
    }

    const dayName = DAY_NAMES[slotStart.getUTCDay()];
    if (!policy.workHours.days.includes(dayName)) {
      continue;
    }

    const datePart = slot.startAt.slice(0, 10);
    const workStart = new Date(`${datePart}T${policy.workHours.start}:00.000Z`);
    const workEnd = new Date(`${datePart}T${policy.workHours.end}:00.000Z`);
    if (Number.isNaN(workStart.getTime()) || Number.isNaN(workEnd.getTime()) || workEnd <= workStart) {
      continue;
    }

    const clippedStart = new Date(Math.max(slotStart.getTime(), workStart.getTime()));
    const clippedEnd = new Date(Math.min(slotEnd.getTime(), workEnd.getTime()));
    if (clippedEnd <= clippedStart) {
      continue;
    }

    filtered.push({
      startAt: clippedStart.toISOString(),
      endAt: clippedEnd.toISOString(),
    });
  }

  return filtered;
}

export function applyPolicyOverride(basePolicyInput, override, nowInput = new Date()) {
  const basePolicy = createPolicy(basePolicyInput);
  const now = new Date(nowInput);
  if (!override || override.mode === "none") {
    return basePolicy;
  }

  if (override.mode === "temporary" && !isTemporaryOverrideActive(override, now)) {
    return basePolicy;
  }

  const merged = mergePolicy(basePolicy, override.value ?? {});
  if (override.mode === "hard" || override.mode === "temporary") {
    return createPolicy(merged);
  }

  const weight = Math.max(0, Math.min(1, Number(override.weight ?? 1)));
  const blended = clonePolicy(basePolicy);
  blended.blockDurationMinutes = blendNumber(
    basePolicy.blockDurationMinutes,
    merged.blockDurationMinutes,
    weight
  );
  blended.breakDurationMinutes = blendNumber(
    basePolicy.breakDurationMinutes,
    merged.breakDurationMinutes,
    weight
  );
  blended.minBlockGapMinutes = Math.max(
    0,
    Math.round(
      basePolicy.minBlockGapMinutes * (1 - weight) + merged.minBlockGapMinutes * weight
    )
  );
  if (override.value?.workHours) {
    blended.workHours = merged.workHours;
  }

  return createPolicy(blended);
}

export function workWindowForDate(policyInput, dateString) {
  const policy = createPolicy(policyInput);
  const start = new Date(`${dateString}T${policy.workHours.start}:00.000Z`);
  const end = new Date(`${dateString}T${policy.workHours.end}:00.000Z`);

  return { start, end };
}
