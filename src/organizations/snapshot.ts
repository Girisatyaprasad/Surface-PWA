import type { Note, Pin } from '../db';
import type { SurfaceMedia } from '../media';

export const ANALYTICS_VERSION = 1 as const;
export const ANALYTICS_WINDOW_DAYS = 30;
export const STALE_PEOPLE_THRESHOLD_DAYS = 30;
const DAY_MS = 86_400_000;

export type AnalyticsActivityDay = {
  day: string;
  activityCount: number;
  peopleAdded: number;
  followupsDue: number;
  followupsCompleted: number;
  followupsMissed: number;
  notesCreated: number;
  capturesCreated: number;
  eventsCreated: number;
};

export type LocalAnalyticsActivityDay = Pick<AnalyticsActivityDay, 'day' | 'activityCount' | 'peopleAdded' | 'notesCreated' | 'capturesCreated'>;

export type MemberAnalyticsSnapshotV1 = {
  analyticsVersion: typeof ANALYTICS_VERSION;
  periodStart: number;
  periodEnd: number;
  generatedAt: number;
  eligibleDays: typeof ANALYTICS_WINDOW_DAYS;
  peopleAdded: number;
  activePins: number;
  followupsDue: number;
  followupsCompleted: number;
  followupsMissed: number;
  relationshipStageCounts: Record<string, number>;
  stalePeopleCount: number;
  notesCreated: number;
  capturesCreated: number;
  eventsCreated: 0;
  activeDays: number;
  consistencyScore: number;
  activityByDay: AnalyticsActivityDay[];
  sourceStatus: {
    followupCompletion: 'unsupported';
    relationshipStages: 'unsupported';
    events: 'unsupported';
  };
};

const TOP_LEVEL_KEYS = [
  'analyticsVersion', 'periodStart', 'periodEnd', 'generatedAt', 'eligibleDays', 'peopleAdded', 'activePins',
  'followupsDue', 'followupsCompleted', 'followupsMissed', 'relationshipStageCounts', 'stalePeopleCount',
  'notesCreated', 'capturesCreated', 'eventsCreated', 'activeDays', 'consistencyScore', 'activityByDay', 'sourceStatus',
];
const ACTIVITY_KEYS = ['day', 'activityCount', 'peopleAdded', 'followupsDue', 'followupsCompleted', 'followupsMissed', 'notesCreated', 'capturesCreated', 'eventsCreated'];
const SOURCE_STATUS_KEYS = ['followupCompletion', 'relationshipStages', 'events'];
const COUNTS = ['peopleAdded', 'activePins', 'followupsDue', 'followupsCompleted', 'followupsMissed', 'stalePeopleCount', 'notesCreated', 'capturesCreated', 'eventsCreated', 'activeDays'] as const;
const MAX_COUNT = 1_000_000;

function utcDayStart(timestamp: number): number { const date = new Date(timestamp); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()); }
function dateKey(timestamp: number): string { return new Date(timestamp).toISOString().slice(0, 10); }
function inRange(value: number, start: number, end: number): boolean { return value >= start && value <= end; }

function blankDay(day: string): AnalyticsActivityDay {
  return { day, activityCount: 0, peopleAdded: 0, followupsDue: 0, followupsCompleted: 0, followupsMissed: 0, notesCreated: 0, capturesCreated: 0, eventsCreated: 0 };
}

export function buildMemberAnalyticsSnapshot(
  pins: readonly Pin[],
  notes: readonly Note[],
  media: readonly SurfaceMedia[],
  localActivity: readonly LocalAnalyticsActivityDay[],
  generatedAt = Date.now(),
): MemberAnalyticsSnapshotV1 {
  const todayStart = utcDayStart(generatedAt);
  const periodStart = todayStart - (ANALYTICS_WINDOW_DAYS - 1) * DAY_MS;
  const periodEnd = todayStart + DAY_MS - 1;
  const days = new Map<string, AnalyticsActivityDay>();

  for (const item of localActivity) {
    const date = Date.parse(`${item.day}T00:00:00.000Z`);
    if (!Number.isFinite(date) || dateKey(date) !== item.day || !inRange(date, periodStart, todayStart)) continue;
    const target = days.get(item.day) ?? blankDay(item.day);
    target.activityCount += item.activityCount;
    target.peopleAdded += item.peopleAdded;
    target.notesCreated += item.notesCreated;
    target.capturesCreated += item.capturesCreated;
    days.set(item.day, target);
  }

  const localCreated = new Map<string, { peopleAdded: number; notesCreated: number; capturesCreated: number }>();
  const countCreated = (timestamp: number, field: 'peopleAdded' | 'notesCreated' | 'capturesCreated') => {
    if (!inRange(timestamp, periodStart, periodEnd)) return;
    const key = dateKey(timestamp);
    const counts = localCreated.get(key) ?? { peopleAdded: 0, notesCreated: 0, capturesCreated: 0 };
    counts[field] += 1;
    localCreated.set(key, counts);
  };
  for (const pin of pins) countCreated(pin.createdAt, 'peopleAdded');
  for (const note of notes) countCreated(note.createdAt, 'notesCreated');
  for (const item of media) if (item.capture) countCreated(item.createdAt, 'capturesCreated');
  for (const [key, counts] of localCreated) {
    const target = days.get(key) ?? blankDay(key);
    target.peopleAdded = Math.max(target.peopleAdded, counts.peopleAdded);
    target.notesCreated = Math.max(target.notesCreated, counts.notesCreated);
    target.capturesCreated = Math.max(target.capturesCreated, counts.capturesCreated);
    target.activityCount = Math.max(target.activityCount, counts.peopleAdded + counts.notesCreated + counts.capturesCreated);
    days.set(key, target);
  }

  const activePins = pins.filter((pin) => pin.deletedAt == null).length;
  const activePinRecords = pins.filter((pin) => pin.deletedAt == null);
  for (const pin of activePinRecords) {
    const dueAt = pin.followUpAt;
    if (typeof dueAt !== 'number' || !inRange(dueAt, periodStart, periodEnd)) continue;
    const key = dateKey(dueAt);
    const target = days.get(key) ?? blankDay(key);
    target.followupsDue += 1;
    if (dueAt < generatedAt) target.followupsMissed += 1;
    days.set(key, target);
  }

  const staleThreshold = generatedAt - STALE_PEOPLE_THRESHOLD_DAYS * DAY_MS;
  const stalePeopleCount = activePinRecords.filter((pin) => pin.updatedAt < staleThreshold).length;
  const activityByDay = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  const activeDays = activityByDay.filter((day) => day.activityCount > 0).length;
  const sum = (field: 'peopleAdded' | 'notesCreated' | 'capturesCreated') => activityByDay.reduce((total, day) => total + day[field], 0);

  return {
    analyticsVersion: ANALYTICS_VERSION,
    periodStart,
    periodEnd,
    generatedAt,
    eligibleDays: ANALYTICS_WINDOW_DAYS,
    peopleAdded: sum('peopleAdded'),
    activePins,
    followupsDue: activityByDay.reduce((total, day) => total + day.followupsDue, 0),
    followupsCompleted: 0,
    followupsMissed: activityByDay.reduce((total, day) => total + day.followupsMissed, 0),
    relationshipStageCounts: {},
    stalePeopleCount,
    notesCreated: sum('notesCreated'),
    capturesCreated: sum('capturesCreated'),
    eventsCreated: 0,
    activeDays,
    consistencyScore: Math.round(activeDays / ANALYTICS_WINDOW_DAYS * 100),
    activityByDay,
    sourceStatus: { followupCompletion: 'unsupported', relationshipStages: 'unsupported', events: 'unsupported' },
  };
}

export function validateMemberAnalyticsSnapshot(value: unknown, now = Date.now()): MemberAnalyticsSnapshotV1 {
  if (!isPlainObject(value) || !hasExactKeys(value, TOP_LEVEL_KEYS)) throw new TypeError('Snapshot contains unexpected fields.');
  if (value.analyticsVersion !== ANALYTICS_VERSION || value.eligibleDays !== ANALYTICS_WINDOW_DAYS) throw new TypeError('Unsupported analytics version or period.');
  const periodStart = safeTimestamp(value.periodStart, 'periodStart');
  const periodEnd = safeTimestamp(value.periodEnd, 'periodEnd');
  const generatedAt = safeTimestamp(value.generatedAt, 'generatedAt');
  const generatedDay = utcDayStart(generatedAt);
  if (Math.abs(now - generatedAt) > 5 * 60_000 || periodStart !== generatedDay - (ANALYTICS_WINDOW_DAYS - 1) * DAY_MS || periodEnd !== generatedDay + DAY_MS - 1) throw new TypeError('Snapshot period is not the current rolling 30-day window.');

  for (const field of COUNTS) safeCount(value[field], field);
  if (value.eventsCreated !== 0) throw new TypeError('Events are unsupported until Surface has an explicit Event record.');
  if (value.activeDays > ANALYTICS_WINDOW_DAYS || value.consistencyScore !== Math.round(value.activeDays / ANALYTICS_WINDOW_DAYS * 100)) throw new TypeError('Consistency score does not match active days.');
  if (!isPlainObject(value.relationshipStageCounts) || Object.keys(value.relationshipStageCounts).length !== 0) throw new TypeError('No relationship stages are currently supported.');
  if (!isPlainObject(value.sourceStatus) || !hasExactKeys(value.sourceStatus, SOURCE_STATUS_KEYS) || value.sourceStatus.followupCompletion !== 'unsupported' || value.sourceStatus.relationshipStages !== 'unsupported' || value.sourceStatus.events !== 'unsupported') throw new TypeError('Unsupported analytics source status.');
  if (!Array.isArray(value.activityByDay) || value.activityByDay.length > ANALYTICS_WINDOW_DAYS) throw new TypeError('Invalid daily activity.');

  const seen = new Set<string>();
  const activityByDay = value.activityByDay.map((raw) => {
    if (!isPlainObject(raw) || !hasExactKeys(raw, ACTIVITY_KEYS) || typeof raw.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.day)) throw new TypeError('Invalid activity day.');
    const timestamp = Date.parse(`${raw.day}T00:00:00.000Z`);
    if (!Number.isFinite(timestamp) || dateKey(timestamp) !== raw.day || !inRange(timestamp, periodStart, utcDayStart(generatedAt)) || seen.has(raw.day)) throw new TypeError('Activity day is outside the snapshot period or duplicated.');
    seen.add(raw.day);
    const day = { ...raw } as unknown as AnalyticsActivityDay;
    for (const field of ACTIVITY_KEYS.slice(1) as (keyof Omit<AnalyticsActivityDay, 'day'>)[]) safeCount(day[field], field);
    if (day.eventsCreated !== 0 || day.followupsCompleted !== 0) throw new TypeError('Unsupported event or follow-up completion count.');
    return day;
  });
  const activeDays = activityByDay.filter((day) => day.activityCount > 0).length;
  if (activeDays !== value.activeDays) throw new TypeError('activeDays does not match daily activity.');
  const sum = (field: keyof Omit<AnalyticsActivityDay, 'day'>) => activityByDay.reduce((total, day) => total + day[field], 0);
  for (const field of ['peopleAdded', 'followupsDue', 'followupsCompleted', 'followupsMissed', 'notesCreated', 'capturesCreated', 'eventsCreated'] as const) {
    if (value[field] !== sum(field)) throw new TypeError(`${field} does not match daily activity.`);
  }

  return {
    analyticsVersion: ANALYTICS_VERSION,
    periodStart,
    periodEnd,
    generatedAt,
    eligibleDays: ANALYTICS_WINDOW_DAYS,
    peopleAdded: value.peopleAdded as number,
    activePins: value.activePins as number,
    followupsDue: value.followupsDue as number,
    followupsCompleted: 0,
    followupsMissed: value.followupsMissed as number,
    relationshipStageCounts: {},
    stalePeopleCount: value.stalePeopleCount as number,
    notesCreated: value.notesCreated as number,
    capturesCreated: value.capturesCreated as number,
    eventsCreated: 0,
    activeDays,
    consistencyScore: value.consistencyScore as number,
    activityByDay,
    sourceStatus: { followupCompletion: 'unsupported', relationshipStages: 'unsupported', events: 'unsupported' },
  };
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function safeCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_COUNT) throw new TypeError(`${field} must be a bounded non-negative integer.`);
  return value;
}

function safeTimestamp(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative millisecond timestamp.`);
  return value;
}
