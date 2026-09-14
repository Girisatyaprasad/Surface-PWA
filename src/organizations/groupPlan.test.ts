import { describe, expect, it } from 'vitest';
import { hasOrganizationAccess } from './model';

describe('server-authoritative Group Plan access response', () => {
  it('requires both active Group Plan and organization access from the backend', () => {
    expect(hasOrganizationAccess({ groupPlanAvailable: true, groupPlanStatus: 'active', organizationAccessAvailable: true })).toBe(true);
    for (const groupPlanStatus of ['inactive', 'expired', 'suspended'] as const) {
      expect(hasOrganizationAccess({ groupPlanAvailable: false, groupPlanStatus, organizationAccessAvailable: false })).toBe(false);
    }
    expect(hasOrganizationAccess({ groupPlanAvailable: true, groupPlanStatus: 'active', organizationAccessAvailable: false })).toBe(false);
    expect(hasOrganizationAccess(null)).toBe(false);
  });
});
