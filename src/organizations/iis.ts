import { getSurfaceFirebase } from '../firebase';
import { listLocalAnalyticsActivity, listPins, type Pin } from '../db';
import { isLegacyMigrationInProgress } from '../legacyRecovery';
import { requireWorkspaceUid } from '../localWorkspace';
import type { MemberAnalyticsSnapshotV1 } from './snapshot';

export const IIS_SCHEMA_VERSION = 1 as const;
export const IIS_ENGINE_VERSION = 'surface-client-iis-v1' as const;
export const IIS_THRESHOLDS = Object.freeze({
  trendMinimumEvents: 3,
  trendRelativeChange: 0.25,
  consistencyDelta: 0.12,
  highStaleRate: 0.5,
  highMissRate: 0.5,
  stagnatingMaximumEvents: 1,
});

export const IIS_INSIGHT_CATEGORIES = ['activity', 'consistency', 'followup', 'relationship', 'people'] as const;
export type IisCategory = typeof IIS_INSIGHT_CATEGORIES[number];
export const IIS_INSIGHT_CODES = [
  'ACTIVITY_MOMENTUM_RISING', 'ACTIVITY_STAGNATING',
  'CONSISTENCY_DECLINING', 'CONSISTENCY_IMPROVING',
  'HIGH_FOLLOWUP_MISS_RATE', 'HIGH_STALE_RELATIONSHIP_RATE',
  'NEW_PEOPLE_MOMENTUM_FALLING', 'NEW_PEOPLE_MOMENTUM_RISING',
] as const;
export type IisInsightCode = typeof IIS_INSIGHT_CODES[number];
export type IisInsightEnvelope = {
  schemaVersion: 1;
  insightId: string;
  insightCode: IisInsightCode;
  category: IisCategory;
  periodStart: number;
  periodEnd: number;
  severity: number;
  confidence: number;
  direction?: 'declining' | 'falling' | 'high' | 'improving' | 'rising' | 'stagnating';
  magnitude?: number;
  evidenceMetrics: Record<string, number>;
  generatedAt: number;
  engineVersion: typeof IIS_ENGINE_VERSION;
};

type SafeAggregates = {
  current7d: { activity: number; activeDays: number; peopleAdded: number; followupsDue: number; followupsMissed: number };
  previous7d: { activity: number; activeDays: number; peopleAdded: number };
  current30d: { activity: number; activeDays: number; peopleAdded: number; followupsDue: number; followupsMissed: number };
  previous30d: { activity: number; activeDays: number; peopleAdded: number };
  stalePeople: number;
  activePins: number;
};

const DAY_MS = 86_400_000;
const CATEGORY: Record<IisInsightCode, IisCategory> = {
  ACTIVITY_MOMENTUM_RISING: 'activity', ACTIVITY_STAGNATING: 'activity',
  CONSISTENCY_DECLINING: 'consistency', CONSISTENCY_IMPROVING: 'consistency',
  HIGH_FOLLOWUP_MISS_RATE: 'followup', HIGH_STALE_RELATIONSHIP_RATE: 'relationship',
  NEW_PEOPLE_MOMENTUM_FALLING: 'people', NEW_PEOPLE_MOMENTUM_RISING: 'people',
};
const EVIDENCE_KEYS: Record<IisInsightCode, readonly string[]> = {
  ACTIVITY_MOMENTUM_RISING: ['currentActivity', 'previousActivity', 'delta', 'deltaRate'],
  ACTIVITY_STAGNATING: ['currentActivity', 'previousActivity', 'currentActiveDays', 'eligibleDays'],
  CONSISTENCY_DECLINING: ['currentRate', 'previousRate', 'delta', 'eligibleDays'],
  CONSISTENCY_IMPROVING: ['currentRate', 'previousRate', 'delta', 'eligibleDays'],
  HIGH_FOLLOWUP_MISS_RATE: ['missedFollowups', 'dueFollowups', 'rate'],
  HIGH_STALE_RELATIONSHIP_RATE: ['stalePeople', 'activePins', 'rate'],
  NEW_PEOPLE_MOMENTUM_FALLING: ['currentPeopleAdded', 'previousPeopleAdded', 'delta'],
  NEW_PEOPLE_MOMENTUM_RISING: ['currentPeopleAdded', 'previousPeopleAdded', 'delta'],
};

export function validateIisInsightEnvelope(value: unknown, now = Date.now()): IisInsightEnvelope {
  if (!plain(value)) throw new TypeError('Unexpected IIS envelope fields.');
  if (value.schemaVersion !== IIS_SCHEMA_VERSION || value.engineVersion !== IIS_ENGINE_VERSION || !isCode(value.insightCode)) throw new TypeError('Unsupported IIS schema or code.');
  const code = value.insightCode;
  if (value.category !== CATEGORY[code]) throw new TypeError('IIS category does not match its code.');
  if (typeof value.insightId !== 'string' || !/^iis1_[a-f0-9]{16}$/.test(value.insightId)) throw new TypeError('Invalid IIS insight ID.');
  const generatedAt = timestamp(value.generatedAt);
  if (Math.abs(now - generatedAt) > 5 * 60_000) throw new TypeError('IIS envelope timestamp is stale.');
  const periodStart = timestamp(value.periodStart);
  const periodEnd = timestamp(value.periodEnd);
  const dayStart = Math.floor(generatedAt / DAY_MS) * DAY_MS;
  const validWindow = [7, 30].some((days) => periodStart === dayStart - (days - 1) * DAY_MS && periodEnd === dayStart + DAY_MS - 1);
  if (!validWindow) throw new TypeError('IIS period is not an allowed rolling window.');
  const severity = rate(value.severity, 'severity');
  const confidence = rate(value.confidence, 'confidence');
  const keys = ['schemaVersion', 'insightId', 'insightCode', 'category', 'periodStart', 'periodEnd', 'severity', 'confidence', 'evidenceMetrics', 'generatedAt', 'engineVersion'];
  if (value.direction !== undefined) keys.push('direction');
  if (value.magnitude !== undefined) keys.push('magnitude');
  if (!exact(value, keys) || !plain(value.evidenceMetrics) || !exact(value.evidenceMetrics, EVIDENCE_KEYS[code])) throw new TypeError('IIS envelope has invalid evidence fields.');
  const metrics: Record<string, number> = {};
  for (const [key, metric] of Object.entries(value.evidenceMetrics)) {
    if (typeof metric !== 'number' || !Number.isFinite(metric) || Math.abs(metric) > 1_000_000) throw new TypeError('IIS evidence must be bounded numeric data.');
    if (['currentRate', 'previousRate', 'rate'].includes(key) && (metric < 0 || metric > 1)) throw new TypeError('IIS evidence rate is out of range.');
    if (['eligibleDays', 'activePins', 'stalePeople', 'missedFollowups', 'dueFollowups', 'currentActivity', 'previousActivity', 'currentActiveDays', 'currentPeopleAdded', 'previousPeopleAdded'].includes(key) && (!Number.isSafeInteger(metric) || metric < 0)) throw new TypeError('IIS evidence count is invalid.');
    if (key === 'eligibleDays' && metric !== 7 && metric !== 30) throw new TypeError('IIS evidence period is invalid.');
    metrics[key] = metric;
  }
  if (value.direction !== undefined && !['declining', 'falling', 'high', 'improving', 'rising', 'stagnating'].includes(String(value.direction))) throw new TypeError('Invalid IIS direction.');
  if (value.magnitude !== undefined && (typeof value.magnitude !== 'number' || !Number.isFinite(value.magnitude) || Math.abs(value.magnitude) > 1_000_000)) throw new TypeError('Invalid IIS magnitude.');
  return { schemaVersion: 1, insightId: value.insightId, insightCode: code, category: CATEGORY[code], periodStart, periodEnd, severity, confidence, ...(value.direction === undefined ? {} : { direction: value.direction as IisInsightEnvelope['direction'] }), ...(value.magnitude === undefined ? {} : { magnitude: value.magnitude as number }), evidenceMetrics: metrics, generatedAt, engineVersion: IIS_ENGINE_VERSION };
}

export function deriveClientIisInsights(
  currentSnapshot: MemberAnalyticsSnapshotV1,
  _previousSnapshot: MemberAnalyticsSnapshotV1 | null,
  safeLocalAggregates: SafeAggregates,
): IisInsightEnvelope[] {
  const generatedAt = currentSnapshot.generatedAt;
  const insights: IisInsightEnvelope[] = [];
  const add = (code: IisInsightCode, days: 7 | 30, direction: NonNullable<IisInsightEnvelope['direction']>, evidenceMetrics: Record<string, number>, magnitude: number, observations: number) => {
    const startOfToday = Math.floor(generatedAt / DAY_MS) * DAY_MS;
    const periodStart = startOfToday - (days - 1) * DAY_MS;
    const periodEnd = startOfToday + DAY_MS - 1;
    const confidence = Math.min(0.95, Math.max(0.15, observations / Math.max(days, 1)));
    const severity = Math.min(1, Math.max(0.05, Math.abs(magnitude)));
    const canonical = `${code}|${days}|${periodStart}|${periodEnd}|${JSON.stringify(evidenceMetrics)}`;
    insights.push({ schemaVersion: 1, insightId: `iis1_${hash(canonical)}`, insightCode: code, category: CATEGORY[code], periodStart, periodEnd, severity, confidence, direction, magnitude, evidenceMetrics, generatedAt, engineVersion: IIS_ENGINE_VERSION });
  };
  for (const days of [7, 30] as const) {
    const current = days === 7 ? safeLocalAggregates.current7d : safeLocalAggregates.current30d;
    const previous = days === 7 ? safeLocalAggregates.previous7d : safeLocalAggregates.previous30d;
    if (current.activeDays + previous.activeDays >= IIS_THRESHOLDS.trendMinimumEvents) {
      const currentRate = current.activeDays / days;
      const previousRate = previous.activeDays / days;
      const delta = currentRate - previousRate;
      if (Math.abs(delta) >= IIS_THRESHOLDS.consistencyDelta) {
        const code = delta > 0 ? 'CONSISTENCY_IMPROVING' : 'CONSISTENCY_DECLINING';
        add(code, days, delta > 0 ? 'improving' : 'declining', { currentRate, previousRate, delta, eligibleDays: days }, delta, current.activeDays + previous.activeDays);
      }
    }
    if (current.activity + previous.activity >= IIS_THRESHOLDS.trendMinimumEvents) {
      const delta = current.activity - previous.activity;
      const deltaRate = previous.activity === 0 ? (current.activity > 0 ? 1 : 0) : delta / previous.activity;
      if (delta > 0 && deltaRate >= IIS_THRESHOLDS.trendRelativeChange) {
        add('ACTIVITY_MOMENTUM_RISING', days, 'rising', { currentActivity: current.activity, previousActivity: previous.activity, delta, deltaRate }, deltaRate, current.activity + previous.activity);
      } else if (current.activity <= IIS_THRESHOLDS.stagnatingMaximumEvents && current.activity < previous.activity) {
        add('ACTIVITY_STAGNATING', days, 'stagnating', { currentActivity: current.activity, previousActivity: previous.activity, currentActiveDays: current.activeDays, eligibleDays: days }, 1 - current.activity / Math.max(previous.activity, 1), current.activity + previous.activity);
      }
    }
    if (current.peopleAdded + previous.peopleAdded >= IIS_THRESHOLDS.trendMinimumEvents) {
      const delta = current.peopleAdded - previous.peopleAdded;
      if (delta !== 0 && Math.abs(delta) / Math.max(previous.peopleAdded, 1) >= IIS_THRESHOLDS.trendRelativeChange) {
        const code = delta > 0 ? 'NEW_PEOPLE_MOMENTUM_RISING' : 'NEW_PEOPLE_MOMENTUM_FALLING';
        add(code, days, delta > 0 ? 'rising' : 'falling', { currentPeopleAdded: current.peopleAdded, previousPeopleAdded: previous.peopleAdded, delta }, Math.abs(delta) / Math.max(previous.peopleAdded, 1), current.peopleAdded + previous.peopleAdded);
      }
    }
  }
  const current = safeLocalAggregates.current30d;
  if (safeLocalAggregates.activePins > 0) {
    const rateValue = safeLocalAggregates.stalePeople / safeLocalAggregates.activePins;
    if (rateValue >= IIS_THRESHOLDS.highStaleRate) add('HIGH_STALE_RELATIONSHIP_RATE', 30, 'high', { stalePeople: safeLocalAggregates.stalePeople, activePins: safeLocalAggregates.activePins, rate: rateValue }, rateValue, safeLocalAggregates.activePins);
  }
  if (current.followupsDue > 0) {
    const rateValue = current.followupsMissed / current.followupsDue;
    if (rateValue >= IIS_THRESHOLDS.highMissRate) add('HIGH_FOLLOWUP_MISS_RATE', 30, 'high', { missedFollowups: current.followupsMissed, dueFollowups: current.followupsDue, rate: rateValue }, rateValue, current.followupsDue);
  }
  return insights.map((item) => validateIisInsightEnvelope(item, generatedAt));
}

export async function deriveUidWorkspaceIisInsights(uid: string, now = Date.now()): Promise<IisInsightEnvelope[]> {
  const ownerUid = requireWorkspaceUid(uid);
  const auth = getSurfaceFirebase().auth;
  if (auth.currentUser?.uid !== ownerUid || await isLegacyMigrationInProgress(ownerUid)) return [];
  const [storedPins, activity] = await Promise.all([
    listPins(ownerUid),
    listLocalAnalyticsActivity(ownerUid, new Date(now - 62 * DAY_MS).toISOString().slice(0, 10), new Date(now).toISOString().slice(0, 10)),
  ]);
  if (auth.currentUser?.uid !== ownerUid || await isLegacyMigrationInProgress(ownerUid)) return [];
  const pins = storedPins.filter((pin) => pin.deletedAt == null);
  const snapshot = makeSnapshotShell(now);
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const countRange = (start: number, end: number) => activity.filter((item) => {
    const day = Date.parse(`${item.day}T00:00:00.000Z`);
    return day >= start && day <= end;
  });
  const counts = (days: 7 | 30, previous = false) => {
    const shift = previous ? days : 0;
    const start = today - (days - 1 + shift) * DAY_MS;
    const end = today - shift * DAY_MS + DAY_MS - 1;
    const rows = countRange(start, end);
    const peopleAddedByRecords = pins.filter((pin) => pin.createdAt >= start && pin.createdAt <= end).length;
    const followups = pins.filter((pin) => typeof pin.followUpAt === 'number' && pin.followUpAt >= start && pin.followUpAt <= end);
    return { activity: rows.reduce((sum, row) => sum + row.activityCount, 0), activeDays: rows.filter((row) => row.activityCount > 0).length, peopleAdded: Math.max(rows.reduce((sum, row) => sum + row.peopleAdded, 0), peopleAddedByRecords), followupsDue: followups.length, followupsMissed: followups.filter((pin) => (pin.followUpAt ?? Infinity) < now).length };
  };
  const activePins: Pin[] = pins.filter((pin) => pin.deletedAt == null);
  const derived = deriveClientIisInsights(snapshot, null, {
    current7d: counts(7), previous7d: counts(7, true), current30d: counts(30), previous30d: counts(30, true),
    stalePeople: activePins.filter((pin) => pin.updatedAt < now - 30 * DAY_MS).length, activePins: activePins.length,
  });
  if (auth.currentUser?.uid !== ownerUid) throw new Error('IIS analysis aborted after authentication changed.');
  return derived;
}

function makeSnapshotShell(generatedAt: number): MemberAnalyticsSnapshotV1 {
  const start = Math.floor(generatedAt / DAY_MS) * DAY_MS - 29 * DAY_MS;
  const end = Math.floor(generatedAt / DAY_MS) * DAY_MS + DAY_MS - 1;
  return { analyticsVersion: 1, periodStart: start, periodEnd: end, generatedAt, eligibleDays: 30, peopleAdded: 0, activePins: 0, followupsDue: 0, followupsCompleted: 0, followupsMissed: 0, relationshipStageCounts: {}, stalePeopleCount: 0, notesCreated: 0, capturesCreated: 0, eventsCreated: 0, activeDays: 0, consistencyScore: 0, activityByDay: [], sourceStatus: { followupCompletion: 'unsupported', relationshipStages: 'unsupported', events: 'unsupported' } };
}

function isCode(value: unknown): value is IisInsightCode { return typeof value === 'string' && (IIS_INSIGHT_CODES as readonly string[]).includes(value); }
function plain(value: unknown): value is Record<string, any> { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); return actual.length === expected.length && actual.every((item, index) => item === expected[index]); }
function timestamp(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid IIS timestamp.'); return value; }
function rate(value: unknown, field: string): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new TypeError(`Invalid IIS ${field}.`); return value; }
function hash(value: string): string { let a = 0x811c9dc5; let b = 0x9e3779b9; for (let i = 0; i < value.length; i += 1) { const code = value.charCodeAt(i); a = Math.imul(a ^ code, 0x01000193); b = Math.imul(b ^ (code + i), 0x85ebca6b); } return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`; }
