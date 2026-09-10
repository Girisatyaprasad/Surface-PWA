import { describe, expect, it } from 'vitest';
import { normalizeIndianMobile, paymentAmount } from './payments';

describe('Surface payment pricing', () => {
  it('computes PRO bundle pricing', () => expect([1, 2, 3, 4, 6, 12].map((n) => paymentAmount('PRO', n))).toEqual([99, 198, 259, 358, 518, 1036]));
  it('computes MAX bundle pricing', () => expect([1, 2, 3, 4, 6, 12].map((n) => paymentAmount('MAX', n))).toEqual([149, 298, 389, 538, 778, 1556]));
  it('rejects invalid periods and formats phones', () => { expect(() => paymentAmount('PRO', 0)).toThrow(); expect(() => paymentAmount('MAX', 13)).toThrow(); expect(normalizeIndianMobile('+91 98765 43210')).toBe('9876543210'); expect(normalizeIndianMobile('9999999999')).toBe('9999999999'); expect(normalizeIndianMobile('123')).toBeNull(); });
});
