import { describe, expect, it } from 'vitest';
import { tierForEntitlementFields } from './entitlement';

describe('Surface entitlement mapping', () => {
  it('keeps unpaid accounts Free', () => expect(tierForEntitlementFields('UNPAID', 'surface_max_1period')).toBe('FREE'));
  it('maps active Max plans to Max', () => expect(tierForEntitlementFields('PRO_ACTIVE', 'surface_max_1period')).toBe('MAX'));
  it('maps active non-Max plans to Pro', () => expect(tierForEntitlementFields('PRO_ACTIVE', 'surface_pro_1period')).toBe('PRO'));
});
