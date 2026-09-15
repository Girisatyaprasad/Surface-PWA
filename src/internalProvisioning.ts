export type InternalProvisioningUser = {
  getIdToken(forceRefresh?: boolean): Promise<string>;
};

export type GroupPlanStatus = 'active' | 'inactive' | 'expired' | 'suspended';

export type InternalOrganizationStatus = {
  organizationId: string;
  name: string;
  organizationActive: boolean;
  groupPlanStatus: GroupPlanStatus;
  groupPlanActive: boolean;
  initialAdminConfigured: boolean;
};
export type InternalPersonalPlanTier = 'FREE' | 'PRO' | 'MAX';
export type InternalPersonalPlanStatus = { tier: InternalPersonalPlanTier; status: 'active' | 'UNPAID'; expiresAt: number | null };

export type CreatedInternalOrganization = InternalOrganizationStatus;

export class InternalProvisioningError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = 'InternalProvisioningError';
  }
}

const apiBase = () => (import.meta.env.VITE_SURFACE_API_BASE_URL ?? 'https://surface-payments.onrender.com').replace(/\/+$/, '');

async function internalRequest<T>(user: InternalProvisioningUser, path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = await user.getIdToken();
  if (!token) throw new InternalProvisioningError(401, 'AUTH_INVALID', 'Sign in again to continue.');
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const payload = result && typeof result === 'object' ? result as Record<string, unknown> : {};
    const code = typeof payload.code === 'string' ? payload.code : 'INTERNAL_REQUEST_FAILED';
    const messages: Record<string, string> = {
      AUTH_INVALID: 'Sign in again to continue.',
      INTERNAL_AUTHORITY_REQUIRED: 'Access denied. This Surface account is not an internal admin.',
      SURFACE_ACCOUNT_NOT_FOUND: 'The Surface account was not found.',
      ORGANIZATION_NOT_FOUND: 'Organization was not found.',
      GROUP_PLAN_NOT_FOUND: 'Group Plan status was not found.',
      ORGANIZATION_REQUEST_INVALID: 'Check the organization details and try again.',
      PERSONAL_PLAN_INVALID: 'Choose Free, Pro, or Max.',
    };
    throw new InternalProvisioningError(response.status, code, messages[code] ?? 'The provisioning request could not be completed.');
  }
  return result as T;
}

export async function checkInternalAdminAccess(user: InternalProvisioningUser): Promise<boolean> {
  const result = await internalRequest<{ internalAdmin: unknown }>(user, '/internal/admin/access');
  if (typeof result?.internalAdmin !== 'boolean' || Object.keys(result).length !== 1) {
    throw new InternalProvisioningError(502, 'INTERNAL_RESPONSE_INVALID', 'Internal access could not be verified.');
  }
  return result.internalAdmin;
}

export function createInternalOrganization(user: InternalProvisioningUser, input: { name: string; companyKey?: string; initialAdminEmail: string }) {
  return internalRequest<CreatedInternalOrganization>(user, '/organizations', 'POST', input);
}

export function getInternalOrganizationStatus(user: InternalProvisioningUser, organizationId: string) {
  return internalRequest<InternalOrganizationStatus>(user, `/internal/admin/organizations/${encodeURIComponent(organizationId)}/status`);
}

export function changeInternalGroupPlan(user: InternalProvisioningUser, organizationId: string, action: 'activate' | 'suspend' | 'deactivate') {
  const body = action === 'activate' ? { planId: 'surface_group_test_v1' } : {};
  return internalRequest<{ organizationId: string; groupPlanStatus: GroupPlanStatus; groupPlanAvailable: boolean }>(
    user,
    `/organizations/${encodeURIComponent(organizationId)}/group-plan/${action}`,
    'POST',
    body,
  );
}

export function provisionInternalPersonalPlan(user: InternalProvisioningUser, uid: string, tier: InternalPersonalPlanTier) {
  return internalRequest<InternalPersonalPlanStatus>(user, `/internal/users/${encodeURIComponent(uid)}/personal-plan`, 'PATCH', { tier });
}
