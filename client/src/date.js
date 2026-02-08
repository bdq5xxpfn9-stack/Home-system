import { DateTime } from 'luxon';

export const TZ = 'Europe/Zurich';
export const LOCALE = 'de-CH';

export const RECURRENCE_LABELS = {
  once: 'Einmalig',
  daily: 'Täglich',
  weekly: 'Wöchentlich',
  seasonal: 'Saisonal (3 Monate)',
  half_year: 'Halbjährlich (Frühling/Herbst)',
  yearly: 'Jährlich'
};

export function todayISO() {
  return DateTime.now().setZone(TZ).toISODate();
}

export function formatDate(iso) {
  return DateTime.fromISO(iso, { zone: TZ }).setLocale(LOCALE).toFormat('cccc, dd.LL.yyyy');
}

export function formatDateShort(iso) {
  return DateTime.fromISO(iso, { zone: TZ }).setLocale(LOCALE).toFormat('dd.LL');
}

export function weekRange(baseISO = todayISO()) {
  const base = DateTime.fromISO(baseISO, { zone: TZ }).setLocale(LOCALE);
  const start = base.startOf('week');
  const end = start.plus({ days: 6 });
  return { start: start.toISODate(), end: end.toISODate() };
}

export function isOverdue(dueDate, reference = todayISO()) {
  return dueDate < reference;
}

export function isToday(dueDate, reference = todayISO()) {
  return dueDate === reference;
}

export function isInWeek(dueDate, range) {
  return dueDate >= range.start && dueDate <= range.end;
}
