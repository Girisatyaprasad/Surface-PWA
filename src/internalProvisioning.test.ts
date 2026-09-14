import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeInternalGroupPlan, checkInternalAdminAccess, createInternalOrganization, getInternalOrganizationStatus, InternalProvisioningError } from './internalProvisioning';

const user = { getIdToken: vi.fn(async () => 'firebase-id-token') };
const fetchMock = vi.fn();

describe('internal provisioning API client', () => {
  afterEach(() => { vi.restoreAllMocks(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });

  it('checks access with the signed-in Firebase token and accepts only the boolean response', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ internalAdmin: true }), { status: 200 }));
    await expect(checkInternalAdminAccess(user)).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain('/internal/admin/access');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer firebase-id-token');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ internalAdmin: true, uids: ['private'] }), { status: 200 }));
    await expect(checkInternalAdminAccess(user)).rejects.toBeInstanceOf(InternalProvisioningError);
  });

  it('sends an initial admin email to the server without looking up or creating client accounts', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ organizationId: 'org-1', name: 'Surface Test Organization', organizationActive: true, groupPlanStatus: 'inactive', groupPlanActive: false, initialAdminConfigured: true }), { status: 201 }));
    await createInternalOrganization(user, { name: 'Surface Test Organization', initialAdminEmail: 'admin@example.com' });
    const options = fetchMock.mock.calls[0][1];
    expect(JSON.parse(options.body)).toEqual({ name: 'Surface Test Organization', initialAdminEmail: 'admin@example.com' });
    expect(options.headers.Authorization).toBe('Bearer firebase-id-token');
  });

  it('uses opaque internal test plan ID and exposes a safe status read', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ organizationId: 'org-1', groupPlanStatus: 'active', groupPlanAvailable: true }), { status: 200 }));
    await changeInternalGroupPlan(user, 'org-1', 'activate');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ planId: 'surface_group_test_v1' });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ organizationId: 'org-1', name: 'Surface Test Organization', organizationActive: true, groupPlanStatus: 'active', groupPlanActive: true, initialAdminConfigured: true }), { status: 200 }));
    await expect(getInternalOrganizationStatus(user, 'org-1')).resolves.toMatchObject({ groupPlanStatus: 'active', initialAdminConfigured: true });
  });

  it('maps authorization denials to a safe message and does not surface backend details', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 'INTERNAL_AUTHORITY_REQUIRED', error: 'private backend detail' }), { status: 403 }));
    await expect(checkInternalAdminAccess(user)).rejects.toMatchObject({ message: 'Access denied. This Surface account is not an internal admin.' });
  });
});
