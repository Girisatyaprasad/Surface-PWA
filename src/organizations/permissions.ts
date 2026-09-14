import type { SurfaceMembership } from './model';

export type OrganizationPrincipal = { uid: string; membership: SurfaceMembership | null };

function activeInSameOrganization(actor: OrganizationPrincipal, target: SurfaceMembership): boolean {
  return actor.membership?.status === 'active' && target.status === 'active' &&
    actor.membership.organizationId === target.organizationId;
}

export function canReadPrivateSurfaceRecord(actorUid: string, ownerUid: string): boolean {
  return actorUid === ownerUid;
}

export function canReadPersonalAnalytics(actorUid: string, ownerUid: string): boolean {
  return actorUid === ownerUid;
}

export function canReadMembership(actor: OrganizationPrincipal, target: SurfaceMembership): boolean {
  if (actor.uid === target.uid) return true;
  if (!activeInSameOrganization(actor, target)) return false;
  const membership = actor.membership!;
  return membership.surfaceRole === 'org_admin' ||
    (membership.surfaceRole === 'group_admin' && Boolean(membership.groupId) && membership.groupId === target.groupId);
}

export function canManageMembership(actor: OrganizationPrincipal, target: SurfaceMembership): boolean {
  if (!activeInSameOrganization(actor, target)) return false;
  const membership = actor.membership!;
  return membership.surfaceRole === 'org_admin' ||
    (membership.surfaceRole === 'group_admin' && Boolean(membership.groupId) && membership.groupId === target.groupId);
}

export function canReadGroupAnalytics(actor: OrganizationPrincipal, organizationId: string, groupId: string): boolean {
  const membership = actor.membership;
  if (!membership || membership.status !== 'active' || membership.organizationId !== organizationId) return false;
  if (membership.surfaceRole === 'org_admin' || membership.surfaceRole === 'partner_analyst') return true;
  return membership.surfaceRole === 'group_admin' && membership.groupId === groupId;
}

export function canReadOrganizationAnalytics(actor: OrganizationPrincipal, organizationId: string): boolean {
  const membership = actor.membership;
  return Boolean(membership && membership.status === 'active' && membership.organizationId === organizationId &&
    (membership.surfaceRole === 'org_admin' || membership.surfaceRole === 'partner_analyst'));
}

export function canReadMemberAnalytics(actor: OrganizationPrincipal, target: SurfaceMembership): boolean {
  return Boolean(actor.membership?.status === 'active' && actor.membership.surfaceRole === 'partner_analyst' && activeInSameOrganization(actor, target));
}
