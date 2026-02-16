import { DateTime } from 'luxon';

export const PASTEL_COLORS = [
  '#9bb4ff',
  '#9ee7e5',
  '#f7c8a6',
  '#f6a6b2',
  '#c9c3ff',
  '#b8e4b0',
  '#ffd59e',
  '#b6d7ff',
  '#f3b0ff',
  '#a7e0ff'
];

export function randomColor(seed = '') {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % PASTEL_COLORS.length;
  return PASTEL_COLORS[index];
}

export function todayISO(timezone = 'Europe/Zurich') {
  return DateTime.now().setZone(timezone).toISODate();
}

export function parseRecurrenceRule(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function clampDay(year, month, day, timezone) {
  const base = DateTime.fromObject({ year, month, day: 1, zone: timezone });
  const safeDay = Math.min(Math.max(day, 1), base.daysInMonth);
  return base.set({ day: safeDay });
}

function nthWeekdayOfMonth(year, month, weekday, nth, timezone) {
  if (nth === -1) {
    let cursor = DateTime.fromObject({ year, month, day: 1, zone: timezone }).endOf('month');
    while (cursor.weekday !== weekday) {
      cursor = cursor.minus({ days: 1 });
    }
    return cursor;
  }

  let cursor = DateTime.fromObject({ year, month, day: 1, zone: timezone });
  while (cursor.weekday !== weekday) {
    cursor = cursor.plus({ days: 1 });
  }
  cursor = cursor.plus({ weeks: Math.max(nth - 1, 0) });
  if (cursor.month !== month) {
    cursor = cursor.minus({ weeks: 1 });
  }
  return cursor;
}

function advanceSimpleDueDate(fromDate, recurrence, timezone) {
  const base = DateTime.fromISO(fromDate, { zone: timezone }).startOf('day');

  if (recurrence === 'daily') {
    return base.plus({ days: 1 }).toISODate();
  }
  if (recurrence === 'weekly') {
    return base.plus({ weeks: 1 }).toISODate();
  }
  if (recurrence === 'monthly') {
    return base.plus({ months: 1 }).toISODate();
  }
  if (recurrence === 'seasonal') {
    return base.plus({ months: 3 }).toISODate();
  }
  if (recurrence === 'half_year') {
    return base.plus({ months: 6 }).toISODate();
  }
  if (recurrence === 'yearly') {
    return base.plus({ years: 1 }).toISODate();
  }

  return base.toISODate();
}

function advanceRuleDueDate(fromDate, recurrence, rule, timezone) {
  const base = DateTime.fromISO(fromDate, { zone: timezone }).startOf('day');
  const intervalMonths =
    recurrence === 'monthly'
      ? 1
      : recurrence === 'seasonal'
        ? 3
        : recurrence === 'half_year'
          ? 6
          : recurrence === 'yearly'
            ? 12
            : 0;

  if (!intervalMonths) {
    return advanceSimpleDueDate(fromDate, recurrence, timezone);
  }

  let target = base.plus({ months: intervalMonths });
  let year = target.year;
  let month = target.month;

  if (recurrence === 'yearly' && rule?.month) {
    year = base.plus({ years: 1 }).year;
    month = rule.month;
  }

  if (rule?.mode === 'by_weekday' && rule.weekday && rule.weekOfMonth) {
    const weekday = Number(rule.weekday);
    const weekOfMonth = Number(rule.weekOfMonth);
    if (Number.isFinite(weekday) && Number.isFinite(weekOfMonth)) {
      return nthWeekdayOfMonth(year, month, weekday, weekOfMonth, timezone).toISODate();
    }
  }

  const day = Number(rule?.day) || base.day;
  return clampDay(year, month, day, timezone).toISODate();
}

export function nextDueDate(fromDate, recurrence, timezone = 'Europe/Zurich', afterDate = null) {
  let next = advanceSimpleDueDate(fromDate, recurrence, timezone);
  if (!afterDate) {
    return next;
  }

  const after = DateTime.fromISO(afterDate, { zone: timezone }).startOf('day');
  let candidate = DateTime.fromISO(next, { zone: timezone }).startOf('day');
  let safety = 0;
  while (candidate <= after && safety < 24) {
    next = advanceSimpleDueDate(next, recurrence, timezone);
    candidate = DateTime.fromISO(next, { zone: timezone }).startOf('day');
    safety += 1;
  }
  return next;
}

export function nextDueDateWithRule(
  fromDate,
  recurrence,
  rule,
  timezone = 'Europe/Zurich',
  afterDate = null
) {
  let next = advanceRuleDueDate(fromDate, recurrence, rule, timezone);
  if (!afterDate) {
    return next;
  }

  const after = DateTime.fromISO(afterDate, { zone: timezone }).startOf('day');
  let candidate = DateTime.fromISO(next, { zone: timezone }).startOf('day');
  let safety = 0;
  while (candidate <= after && safety < 24) {
    next = advanceRuleDueDate(next, recurrence, rule, timezone);
    candidate = DateTime.fromISO(next, { zone: timezone }).startOf('day');
    safety += 1;
  }
  return next;
}
