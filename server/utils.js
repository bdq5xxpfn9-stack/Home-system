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

export function nextDueDate(fromDate, recurrence, timezone = 'Europe/Zurich') {
  const base = DateTime.fromISO(fromDate, { zone: timezone }).startOf('day');

  if (recurrence === 'daily') {
    return base.plus({ days: 1 }).toISODate();
  }
  if (recurrence === 'weekly') {
    return base.plus({ weeks: 1 }).toISODate();
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
