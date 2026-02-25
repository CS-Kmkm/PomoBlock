import { createPolicy } from "./models.js";

const FORMATTER_CACHE = new Map();

function getFormatter(timeZone) {
  const cacheKey = `en-US:${timeZone}`;
  let formatter = FORMATTER_CACHE.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    FORMATTER_CACHE.set(cacheKey, formatter);
  }
  return formatter;
}

function zonedDateTimeParts(date, timeZone) {
  const formatter = getFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const byType = {};
  for (const part of parts) {
    byType[part.type] = part.value;
  }
  return {
    weekday: byType.weekday,
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour) % 24,
    minute: Number(byType.minute),
  };
}

function timeToMinutes(timeString) {
  const [hours, minutes] = timeString.split(":").map(Number);
  return hours * 60 + minutes;
}

function dateToMinuteOfDay(date, timeZone) {
  const parts = zonedDateTimeParts(date, timeZone);
  return parts.hour * 60 + parts.minute;
}

function dayNameInTimezone(date, timeZone) {
  return zonedDateTimeParts(date, timeZone).weekday;
}

function dateStringInTimezone(date, timeZone) {
  const parts = zonedDateTimeParts(date, timeZone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

function zonedDateTimeToUtc(dateString, timeString, timeZone) {
  const [year, month, day] = dateString.split("-").map(Number);
  const [hour, minute] = timeString.split(":").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidateUtc = targetAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = zonedDateTimeParts(new Date(candidateUtc), timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      0,
      0
    );
    const delta = targetAsUtc - observedAsUtc;
    candidateUtc += delta;
    if (delta === 0) {
      break;
    }
  }

  return new Date(candidateUtc);
}

function clonePolicy(policy) {
  return {
    workHours: {
      start: policy.workHours.start,
      end: policy.workHours.end,
      days: [...policy.workHours.days],
    },
    timezone: policy.timezone,
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
  if (typeof overrideValue.timezone === "string") {
    merged.timezone = overrideValue.timezone;
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

  const dayName = dayNameInTimezone(date, policy.timezone);
  if (!policy.workHours.days.includes(dayName)) {
    return false;
  }

  const minute = dateToMinuteOfDay(date, policy.timezone);
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

    const dayName = dayNameInTimezone(slotStart, policy.timezone);
    if (!policy.workHours.days.includes(dayName)) {
      continue;
    }

    const datePart = dateStringInTimezone(slotStart, policy.timezone);
    const workStart = zonedDateTimeToUtc(datePart, policy.workHours.start, policy.timezone);
    const workEnd = zonedDateTimeToUtc(datePart, policy.workHours.end, policy.timezone);
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
  if (typeof override.value?.timezone === "string") {
    blended.timezone = merged.timezone;
  }

  return createPolicy(blended);
}

export function workWindowForDate(policyInput, dateString) {
  const policy = createPolicy(policyInput);
  const start = zonedDateTimeToUtc(dateString, policy.workHours.start, policy.timezone);
  const end = zonedDateTimeToUtc(dateString, policy.workHours.end, policy.timezone);

  return { start, end };
}
