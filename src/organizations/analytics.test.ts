import { describe, expect, it } from 'vitest';
import { aggregateGroupAnalytics, aggregateOrganizationAnalytics, createMemberAnalyticsEnvelope } from './analytics';
import type { MemberAnalyticsInput } from './analytics';
import type { SurfaceMembership } from './model';

const period = { periodStart: Date.parse('2026-08-16T00:00:00Z'), periodEnd: Date.parse('2026-09-14T23:59:59Z') };
const stages = ['stage_new', 'stage_contacted'] as const;

function input(overrides: Partial<MemberAnalyticsInput> = {}): MemberAnalyticsInput {
  return {
    ...period, updatedAt: period.periodEnd,
    peopleAdded: 2, activePins: 3, followupsDue: 4, followupsCompleted: 2, followupsMissed: 1,
    relationshipStageCounts: { stage_new: 1, stage_contacted: 2 }, stalePeopleCount: 1,
    notesCreated: 2, capturesCreated: 1, eventsCreated: 3, activeDays: 2, consistencyScore: 80,
    activityByDay: [
      { day: '2026-08-15', peopleAdded: 1, followupsCompleted: 0, notesCreated: 0, capturesCreated: 0, eventsCreated: 9 },
      { day: '2026-08-16', peopleAdded: 0, followupsCompleted: 1, notesCreated: 1, capturesCreated: 0, eventsCreated: 1 },
      { day: '2026-09-08', peopleAdded: 1, followupsCompleted: 0, notesCreated: 0, capturesCreated: 1, eventsCreated: 2 },
      { day: '2026-09-14', peopleAdded: 0, followupsCompleted: 1, notesCreated: 1, capturesCreated: 0, eventsCreated: 4 },
    ],
    ...overrides,
  };
}

function membership(uid: string, groupId: string, status: SurfaceMembership['status'] = 'active'): SurfaceMembership {
  return { uid, organizationId: 'org-1', groupId, status, joinedAt: 1, updatedAt: 1, surfaceRole: 'member' };
}

describe('privacy-safe organization analytics', () => {
  it('constructs an allow-listed envelope and omits identities, contact details, text, media refs, and exact coordinates', () => {
    const unsafe = {
      ...input({ relationshipStageCounts: { stage_new: 3, stage_contacted: 1, ravi: 900 } }),
      people: [{ name: 'Ravi', phone: '9876543210' }], noteText: 'private note', photoPath: 'users/u/photo',
      latitude: 16.81042, longitude: 80.82171, nextActionText: 'Meet Ravi',
    } as unknown as MemberAnalyticsInput;
    const result = createMemberAnalyticsEnvelope('member-uid', 'org-1', unsafe, stages);
    const serialized = JSON.stringify(result);
    expect(result.relationshipStageCounts).toEqual({ stage_new: 3, stage_contacted: 1 });
    for (const forbidden of ['Ravi', '9876543210', 'private note', 'photoPath', '16.81042', '80.82171', 'Meet Ravi', 'noteText']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(Object.keys(result)).toEqual(expect.arrayContaining(['uid', 'organizationId', 'peopleAdded', 'activePins', 'eventsCreated', 'activityByDay']));
  });

  it('rejects invalid metric values and unsafe stage codes', () => {
    expect(() => createMemberAnalyticsEnvelope('u', 'o', input({ peopleAdded: -1 }), stages)).toThrow();
    expect(() => createMemberAnalyticsEnvelope('u', 'o', input(), ['ravi'])).toThrow();
  });

  it('counts explicit event metrics by UTC 7-day and 30-day windows without inventing event records', () => {
    const snapshot = createMemberAnalyticsEnvelope('a', 'org-1', input(), stages);
    const group = aggregateGroupAnalytics({ organizationId: 'org-1', groupId: 'g1', period, memberships: [membership('a', 'g1')], memberAnalytics: [snapshot], updatedAt: period.periodEnd });
    expect(group.eventsCreated).toBe(3);
    expect(group.eventsCreated7d).toBe(6);
    expect(group.eventsCreated30d).toBe(7);
  });

  it('rolls group event counts and trends into organization totals', () => {
    const memberA = createMemberAnalyticsEnvelope('a', 'org-1', input(), stages);
    const memberB = createMemberAnalyticsEnvelope('b', 'org-1', input({ eventsCreated: 5, activityByDay: input().activityByDay.map((day) => ({ ...day, eventsCreated: day.eventsCreated * 2 })) }), stages);
    const groupA = aggregateGroupAnalytics({ organizationId: 'org-1', groupId: 'g1', period, memberships: [membership('a', 'g1')], memberAnalytics: [memberA], updatedAt: period.periodEnd });
    const groupB = aggregateGroupAnalytics({ organizationId: 'org-1', groupId: 'g2', period, memberships: [membership('b', 'g2', 'inactive')], memberAnalytics: [memberB], updatedAt: period.periodEnd });
    const organization = aggregateOrganizationAnalytics('org-1', [groupA, groupB], period.periodEnd);
    expect(organization.eventsCreated).toBe(8);
    expect(organization.eventsCreated7d).toBe(18);
    expect(organization.eventsCreated30d).toBe(21);
    expect(organization.activeMemberCount).toBe(1);
    expect(organization.inactiveMemberCount).toBe(1);
  });

  it('does not let unrelated organizations or mismatched periods contaminate aggregates', () => {
    const member = createMemberAnalyticsEnvelope('a', 'org-1', input(), stages);
    expect(() => aggregateGroupAnalytics({ organizationId: 'org-1', groupId: 'g1', period, memberships: [membership('a', 'g1')], memberAnalytics: [{ ...member, periodEnd: period.periodEnd - 1 }], updatedAt: period.periodEnd })).toThrow();
  });
});
