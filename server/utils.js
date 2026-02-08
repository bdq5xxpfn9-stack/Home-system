import { DateTime } from 'luxon';

const COLORS = [
  '#1f2937',
  '#0f766e',
  '#b45309',
  '#7c3aed',
  '#be123c',
  '#1d4ed8',
  '#15803d',
  '#c2410c'
];

export function randomColor(seed = '') {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % COLORS.length;
  return COLORS[index];
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
