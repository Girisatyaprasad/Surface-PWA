import { afterEach, describe, expect, it, vi } from 'vitest';
import { listMyGroupMemberships, readIisAnalyses } from './groupToolsApi';

const user = { getIdToken: vi.fn(async () => 'not-asserted-token') } as never;

describe('Group Tools API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses authenticated membership discovery and rejects non-active or invalid membership rows', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ memberships: [
      { organizationId: 'org-1', organizationName: 'Surface Org', groupId: 'g1', groupName: 'Group 1', surfaceRole: 'group_admin', groupPlanStatus: 'active' },
      { organizationId: 'org-2', organizationName: 'Inactive', surfaceRole: 'member', groupPlanStatus: 'suspended' },
      { organizationId: 'org-3', surfaceRole: 'unexpected', groupPlanStatus: 'active' },
    ] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const memberships = await listMyGroupMemberships(user);
    expect(memberships).toHaveLength(1);
    expect(memberships[0].organizationId).toBe('org-1');
    expect(fetch.mock.calls[0][0]).toContain('/organizations/memberships');
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer not-asserted-token' });
  });

  it('requests human-readable server IIS analysis by authorized scope', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ analyses: [{ scope: 'group', subjectId: 'g1', analysisCode: 'CONSISTENCY_IMPROVING', window: '30d', confidence: .8, severity: .2, metrics: {} }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const result = await readIisAnalyses(user, 'org id', 'group', 'g/1', '30d');
    expect(result).toHaveLength(1);
    expect(fetch.mock.calls[0][0]).toContain('/iis/analysis/group/g%2F1?organizationId=org%20id&window=30d');
  });

  it('classifies session and network failures without exposing tokens or server details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'AUTH_INVALID', error: 'private server detail' }), { status: 401 })));
    await expect(listMyGroupMemberships(user)).rejects.toThrow('Surface could not verify the current sign-in session. Sign in again.');

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network failure'); }));
    await expect(listMyGroupMemberships(user)).rejects.toThrow('Surface organization services could not be reached. Check your connection and retry.');
  });
});
