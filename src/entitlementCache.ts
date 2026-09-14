import type { SurfaceEntitlement } from './entitlement';

const key = (uid: string) => `surface:last-entitlement:${uid}`;

export function readLastKnownEntitlement(uid: string): SurfaceEntitlement | null {
  try {
    const raw = localStorage.getItem(key(uid));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const data = value as Record<string, unknown>;
    if (!['FREE', 'PRO', 'MAX'].includes(String(data.tier)) || typeof data.proStatus !== 'string') return null;
    return { tier: data.tier as SurfaceEntitlement['tier'], proStatus: data.proStatus, planId: typeof data.planId === 'string' ? data.planId : null, expiresAt: data.expiresAt ?? null };
  } catch { return null; }
}

export function writeLastKnownEntitlement(uid: string, entitlement: SurfaceEntitlement): void {
  try { localStorage.setItem(key(uid), JSON.stringify(entitlement)); } catch { /* Cache failure never blocks Surface. */ }
}
