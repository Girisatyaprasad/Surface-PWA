import type { ActivityDay, AnalyticsPeriod, GroupAnalytics, MemberAnalytics, MemberAnalyticsMetrics, OrganizationAnalytics, SurfaceMembership } from './model';

const COUNT_FIELDS = [
  'peopleAdded', 'activePins', 'followupsDue', 'followupsCompleted', 'followupsMissed',
  'stalePeopleCount', 'notesCreated', 'capturesCreated', 'eventsCreated', 'activeDays',
] as const;
const DAY_COUNT_FIELDS = ['peopleAdded', 'followupsCompleted', 'notesCreated', 'capturesCreated', 'eventsCreated'] as const;
const DAY_MS = 86_400_000;

export type MemberAnalyticsInput = MemberAnalyticsMetrics & AnalyticsPeriod & { updatedAt: number };
export type GroupAnalyticsInput = {
  organizationId: string;
  groupId: string;
  period: AnalyticsPeriod;
  memberships: readonly SurfaceMembership[];
  memberAnalytics: readonly MemberAnalytics[];
  updatedAt: number;
};

function safeCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer`);
  return value;
}

function validId(value: string, field: string): string {
  if (!value.trim() || value.includes('/')) throw new TypeError(`${field} must be a non-empty Firestore path segment`);
  return value;
}

function validTime(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative millisecond timestamp`);
  return value;
}

function normalizeActivity(days: readonly ActivityDay[]): ActivityDay[] {
  const normalized = new Map<string, ActivityDay>();
  for (const item of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.day) || Number.isNaN(Date.parse(`${item.day}T00:00:00.000Z`))) throw new TypeError('activity day must be an ISO calendar date');
    const entry = normalized.get(item.day) ?? { day: item.day, peopleAdded: 0, followupsCompleted: 0, notesCreated: 0, capturesCreated: 0, eventsCreated: 0 };
    for (const field of DAY_COUNT_FIELDS) entry[field] += safeCount(item[field], field);
    normalized.set(item.day, entry);
  }
  return [...normalized.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function createMemberAnalyticsEnvelope(
  uid: string,
  organizationId: string,
  input: MemberAnalyticsInput,
  allowedRelationshipStageCodes: readonly string[] = [],
): MemberAnalytics {
  const relationshipStageCounts: Record<string, number> = {};
  for (const code of new Set(allowedRelationshipStageCodes)) {
    if (!/^stage_[a-z0-9_]{1,28}$/.test(code)) throw new TypeError('relationship stage codes must be opaque stage_* identifiers');
    const count = input.relationshipStageCounts[code];
    if (count !== undefined) relationshipStageCounts[code] = safeCount(count, `relationshipStageCounts.${code}`);
  }

  const metrics = Object.fromEntries(COUNT_FIELDS.map((field) => [field, safeCount(input[field], field)])) as Pick<MemberAnalyticsMetrics, typeof COUNT_FIELDS[number]>;
  if (!Number.isSafeInteger(input.consistencyScore) || input.consistencyScore < 0 || input.consistencyScore > 100) throw new TypeError('consistencyScore must be between 0 and 100');
  if (input.periodEnd <= input.periodStart) throw new TypeError('periodEnd must be after periodStart');

  return {
    uid: validId(uid, 'uid'), organizationId: validId(organizationId, 'organizationId'),
    periodStart: validTime(input.periodStart, 'periodStart'), periodEnd: validTime(input.periodEnd, 'periodEnd'),
    ...metrics,
    relationshipStageCounts,
    consistencyScore: input.consistencyScore,
    activityByDay: normalizeActivity(input.activityByDay),
    updatedAt: validTime(input.updatedAt, 'updatedAt'),
  };
}

function emptyCounts(): Omit<ActivityDay, 'day'> {
  return { peopleAdded: 0, followupsCompleted: 0, notesCreated: 0, capturesCreated: 0, eventsCreated: 0 };
}

function mergeActivityDays(lists: readonly (readonly ActivityDay[])[]): ActivityDay[] {
  const output = new Map<string, ActivityDay>();
  for (const list of lists) for (const item of list) {
    const total = output.get(item.day) ?? { day: item.day, ...emptyCounts() };
    for (const field of DAY_COUNT_FIELDS) total[field] += item[field];
    output.set(item.day, total);
  }
  return [...output.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function sumRecent(activity: readonly ActivityDay[], periodEnd: number, days: number): number {
  const endDay = Date.UTC(new Date(periodEnd).getUTCFullYear(), new Date(periodEnd).getUTCMonth(), new Date(periodEnd).getUTCDate());
  const firstDay = endDay - (days - 1) * DAY_MS;
  return activity.reduce((sum, item) => {
    const day = Date.parse(`${item.day}T00:00:00.000Z`);
    return day >= firstDay && day <= endDay ? sum + item.eventsCreated : sum;
  }, 0);
}

function sumMembers(analytics: readonly MemberAnalytics[]) {
  const totals = Object.fromEntries(COUNT_FIELDS.filter((field) => field !== 'activeDays').map((field) => [field, 0])) as Record<string, number>;
  for (const item of analytics) for (const field of COUNT_FIELDS) if (field !== 'activeDays') totals[field] += item[field];
  const stages: Record<string, number> = {};
  for (const item of analytics) for (const [code, count] of Object.entries(item.relationshipStageCounts)) stages[code] = (stages[code] ?? 0) + count;
  const activityByDay = mergeActivityDays(analytics.map((item) => item.activityByDay));
  const consistencyScoreSampleCount = analytics.length;
  return {
    peopleAdded: totals.peopleAdded, activePins: totals.activePins, followupsDue: totals.followupsDue,
    followupsCompleted: totals.followupsCompleted, followupsMissed: totals.followupsMissed,
    relationshipStageCounts: stages, stalePeopleCount: totals.stalePeopleCount,
    notesCreated: totals.notesCreated, capturesCreated: totals.capturesCreated, eventsCreated: totals.eventsCreated,
    activityByDay, eventsCreated7d: 0, eventsCreated30d: 0,
    consistencyScoreSampleCount,
    averageConsistencyScore: consistencyScoreSampleCount ? analytics.reduce((sum, item) => sum + item.consistencyScore, 0) / consistencyScoreSampleCount : 0,
  };
}

export function aggregateGroupAnalytics(input: GroupAnalyticsInput): GroupAnalytics {
  const membershipByUid = new Map(input.memberships.filter((membership) => membership.organizationId === input.organizationId && membership.groupId === input.groupId).map((membership) => [membership.uid, membership]));
  const activeMembers = [...membershipByUid.values()].filter((membership) => membership.status === 'active').length;
  const analytics = input.memberAnalytics.filter((item) => membershipByUid.has(item.uid));
  if (analytics.some((item) => item.organizationId !== input.organizationId || item.periodStart !== input.period.periodStart || item.periodEnd !== input.period.periodEnd)) throw new TypeError('member analytics must match group and period');
  const counts = sumMembers(analytics);
  const memberCount = membershipByUid.size;
  return {
    organizationId: input.organizationId, groupId: input.groupId, ...input.period,
    ...counts, eventsCreated7d: sumRecent(counts.activityByDay, input.period.periodEnd, 7),
    eventsCreated30d: sumRecent(counts.activityByDay, input.period.periodEnd, 30),
    memberCount, activeMemberCount: activeMembers, inactiveMemberCount: memberCount - activeMembers,
    activeRate: memberCount ? activeMembers / memberCount : 0, updatedAt: input.updatedAt,
  };
}

export function aggregateOrganizationAnalytics(organizationId: string, groups: readonly GroupAnalytics[], updatedAt: number): OrganizationAnalytics {
  if (groups.some((group) => group.organizationId !== organizationId)) throw new TypeError('all groups must belong to the organization');
  const first = groups[0];
  const periodStart = first?.periodStart ?? 0;
  const periodEnd = first?.periodEnd ?? 0;
  if (groups.some((group) => group.periodStart !== periodStart || group.periodEnd !== periodEnd)) throw new TypeError('all groups must use the same analytics period');
  const activityByDay = mergeActivityDays(groups.map((group) => group.activityByDay));
  const relationshipStageCounts: Record<string, number> = {};
  for (const group of groups) for (const [code, count] of Object.entries(group.relationshipStageCounts)) relationshipStageCounts[code] = (relationshipStageCounts[code] ?? 0) + count;
  const memberCount = groups.reduce((sum, group) => sum + group.memberCount, 0);
  const activeMemberCount = groups.reduce((sum, group) => sum + group.activeMemberCount, 0);
  const consistencyScoreSampleCount = groups.reduce((sum, group) => sum + group.consistencyScoreSampleCount, 0);
  const averageConsistencyScore = consistencyScoreSampleCount
    ? groups.reduce((sum, group) => sum + group.averageConsistencyScore * group.consistencyScoreSampleCount, 0) / consistencyScoreSampleCount
    : 0;
  const total = (field: keyof GroupAnalytics) => groups.reduce((sum, group) => sum + Number(group[field] ?? 0), 0);
  return {
    organizationId, periodStart, periodEnd, groupCount: groups.length, memberCount,
    activeMemberCount, inactiveMemberCount: memberCount - activeMemberCount,
    activeRate: memberCount ? activeMemberCount / memberCount : 0,
    peopleAdded: total('peopleAdded'), activePins: total('activePins'), followupsDue: total('followupsDue'),
    followupsCompleted: total('followupsCompleted'), followupsMissed: total('followupsMissed'),
    relationshipStageCounts, stalePeopleCount: total('stalePeopleCount'), notesCreated: total('notesCreated'),
    capturesCreated: total('capturesCreated'), eventsCreated: total('eventsCreated'),
    eventsCreated7d: total('eventsCreated7d'), eventsCreated30d: total('eventsCreated30d'),
    activityByDay, averageConsistencyScore, consistencyScoreSampleCount, updatedAt,
  };
}
