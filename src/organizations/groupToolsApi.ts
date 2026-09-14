import type { User } from 'firebase/auth';

export type GroupToolsMembership = {
  organizationId: string;
  organizationName: string;
  groupId: string | null;
  groupName: string | null;
  surfaceRole: 'member' | 'group_admin' | 'org_admin' | 'partner_analyst';
  groupPlanStatus: 'active';
  groupPlanExpiresAt?: number | null;
};

export type GroupToolsData = {
  organization: { id: string; name: string; status: 'active' };
  membership: { uid: string; groupId: string | null; surfaceRole: GroupToolsMembership['surfaceRole'] };
  groupPlan: { status: 'active'; expiresAt: number | null };
  groups: Array<{ id: string; name: string; parentGroupId: string | null; status: 'active' | 'inactive' }>;
  members: Array<{ uid: string; groupId: string | null; status: 'active' | 'inactive'; surfaceRole: GroupToolsMembership['surfaceRole']; joinedAt: number | null }>;
  groupAnalytics: Array<Record<string, number | string>>;
  organizationAnalytics: Array<Record<string, number | string>>;
  memberAnalytics: Array<Record<string, number | string>>;
};

export type GroupIisAnalysis = {
  scope: 'member' | 'group' | 'organization';
  subjectId: string;
  analysisCode: string;
  window: '7d' | '30d';
  confidence: number;
  severity: number;
  metrics: Record<string, number | boolean>;
};

const apiBase = () => (import.meta.env.VITE_SURFACE_API_BASE_URL ?? 'https://surface-payments.onrender.com').replace(/\/+$/, '');

async function request<T>(user: User, path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = result && typeof result === 'object' && 'code' in result ? String((result as { code: unknown }).code) : '';
    const message = code === 'GROUP_PLAN_REQUIRED' ? 'This organization’s Group Plan is not active.'
      : code === 'ORGANIZATION_MEMBERSHIP_REQUIRED' ? 'No active Group Plan membership was found.'
        : code === 'ORGANIZATION_ROLE_DENIED' ? 'This action is not available for your organization role.'
          : response.status >= 500 ? 'Group Tools is temporarily unavailable. Try again.'
            : 'Group Tools could not complete that request.';
    throw new Error(message);
  }
  return result as T;
}

export async function listMyGroupMemberships(user: User): Promise<GroupToolsMembership[]> {
  const result = await request<{ memberships: GroupToolsMembership[] }>(user, '/organizations/memberships');
  if (!Array.isArray(result.memberships)) throw new Error('Group Tools returned an invalid membership response.');
  return result.memberships.filter((item) => item && typeof item.organizationId === 'string' && item.groupPlanStatus === 'active' && ['member', 'group_admin', 'org_admin', 'partner_analyst'].includes(item.surfaceRole));
}

export function getGroupTools(user: User, organizationId: string) {
  return request<GroupToolsData>(user, `/organizations/${encodeURIComponent(organizationId)}/tools`);
}

export function mutateGroupTools(user: User, path: string, method: 'POST' | 'PATCH', body: unknown) {
  return request<Record<string, unknown>>(user, path, method, body);
}

export async function readIisAnalyses(user: User, organizationId: string, scope: GroupIisAnalysis['scope'], subjectId: string, window: GroupIisAnalysis['window']): Promise<GroupIisAnalysis[]> {
  const suffix = `?organizationId=${encodeURIComponent(organizationId)}&window=${window}`;
  const path = scope === 'organization'
    ? `/iis/analysis/organization${suffix}`
    : `/iis/analysis/${scope}/${encodeURIComponent(subjectId)}${suffix}`;
  const result = await request<{ analyses: GroupIisAnalysis[] }>(user, path);
  return Array.isArray(result.analyses) ? result.analyses : [];
}
