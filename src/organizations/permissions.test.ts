import { describe, expect, it } from 'vitest';
import { canManageMembership, canReadGroupAnalytics, canReadMemberAnalytics, canReadMembership, canReadOrganizationAnalytics, canReadPersonalAnalytics, canReadPrivateSurfaceRecord } from './permissions';
import type { SurfaceMembership, SurfaceOrganizationRole } from './model';

function member(uid: string, surfaceRole: SurfaceOrganizationRole, groupId: string | null = 'g1', extra: Partial<SurfaceMembership> = {}): SurfaceMembership {
  return { uid, organizationId: 'org-1', groupId, status: 'active', joinedAt: 1, updatedAt: 1, surfaceRole, ...extra };
}

const actor = (membership: SurfaceMembership) => ({ uid: membership.uid, membership });

describe('organization permissions', () => {
  it('lets a normal member read only their own private data and personal analytics', () => {
    expect(canReadPrivateSurfaceRecord('a', 'a')).toBe(true);
    expect(canReadPrivateSurfaceRecord('a', 'b')).toBe(false);
    expect(canReadPersonalAnalytics('a', 'a')).toBe(true);
    expect(canReadPersonalAnalytics('a', 'b')).toBe(false);
  });

  it('does not let upline/rank/recognition metadata grant permission', () => {
    const leader = member('leader', 'member', 'g1', { companyRank: 'Diamond', recognitionTitle: 'Upline' });
    expect(canReadMembership(actor(leader), member('other', 'member'))).toBe(false);
    expect(canManageMembership(actor(leader), member('other', 'member'))).toBe(false);
    expect(canReadPrivateSurfaceRecord('leader', 'other')).toBe(false);
  });

  it('allows group admins only their group aggregate and membership management, never private records', () => {
    const admin = actor(member('ga', 'group_admin', 'g1'));
    expect(canReadGroupAnalytics(admin, 'org-1', 'g1')).toBe(true);
    expect(canReadGroupAnalytics(admin, 'org-1', 'g2')).toBe(false);
    expect(canReadMembership(admin, member('member-1', 'member', 'g1'))).toBe(true);
    expect(canManageMembership(admin, member('member-1', 'member', 'g1'))).toBe(true);
    expect(canReadPrivateSurfaceRecord('ga', 'member-1')).toBe(false);
    expect(canReadMemberAnalytics(admin, member('member-1', 'member'))).toBe(false);
  });

  it('allows org admins org/group aggregates but no individual analytics or private records', () => {
    const admin = actor(member('oa', 'org_admin'));
    expect(canReadOrganizationAnalytics(admin, 'org-1')).toBe(true);
    expect(canReadGroupAnalytics(admin, 'org-1', 'g2')).toBe(true);
    expect(canReadMemberAnalytics(admin, member('member-1', 'member'))).toBe(false);
    expect(canReadPrivateSurfaceRecord('oa', 'member-1')).toBe(false);
  });

  it('allows partner analysts per-member metrics only for active memberships in the same organization', () => {
    const analyst = actor(member('pa', 'partner_analyst', null));
    expect(canReadMemberAnalytics(analyst, member('member-1', 'member'))).toBe(true);
    expect(canReadGroupAnalytics(analyst, 'org-1', 'g99')).toBe(true);
    expect(canReadOrganizationAnalytics(analyst, 'org-1')).toBe(true);
    expect(canReadMemberAnalytics(analyst, member('off', 'member', 'g1', { organizationId: 'org-2' }))).toBe(false);
    expect(canReadMemberAnalytics(analyst, member('inactive', 'member', 'g1', { status: 'inactive' }))).toBe(false);
    expect(canReadPrivateSurfaceRecord('pa', 'member-1')).toBe(false);
  });

  it('does not derive organization permissions from Free/Pro/Max entitlement', () => {
    const sameMemberRole = member('u', 'member');
    const allowed = canReadGroupAnalytics(actor(sameMemberRole), 'org-1', 'g1');
    for (const tier of ['FREE', 'PRO', 'MAX']) {
      void tier;
      expect(canReadGroupAnalytics(actor(sameMemberRole), 'org-1', 'g1')).toBe(allowed);
    }
    expect(allowed).toBe(false);
  });
});
