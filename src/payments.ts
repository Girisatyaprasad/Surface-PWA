export type PaymentTier = 'PRO' | 'MAX';

export function paymentAmount(tier: PaymentTier, periods: number): number {
  if (!Number.isInteger(periods) || periods < 1 || periods > 12) throw new Error('periods must be an integer from 1 to 12');
  const single = tier === 'PRO' ? 99 : 149;
  const bundle = tier === 'PRO' ? 259 : 389;
  return Math.floor(periods / 3) * bundle + (periods % 3) * single;
}

export function normalizeIndianMobile(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  const local = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits.startsWith('0') && digits.length === 11 ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}
