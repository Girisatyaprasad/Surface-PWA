import { doc, getDoc, type Firestore } from 'firebase/firestore';

export type SurfaceTier = 'FREE' | 'PRO' | 'MAX';
export type SurfaceEntitlement = { tier: SurfaceTier; proStatus: string; planId: string | null; expiresAt: unknown };

export function tierForEntitlementFields(proStatus: unknown, planId: unknown): SurfaceTier {
  const active = proStatus === 'PRO_ACTIVE' || proStatus === 'PRO_GRACE';
  if (!active) return 'FREE';
  return typeof planId === 'string' && planId.toLowerCase().includes('max') ? 'MAX' : 'PRO';
}

export async function readSurfaceEntitlement(firestore: Firestore, uid: string): Promise<SurfaceEntitlement> {
  const snapshot = await getDoc(doc(firestore, 'users', uid));
  const data = snapshot.data() ?? {};
  const proStatus = typeof data.proStatus === 'string' ? data.proStatus : 'UNPAID';
  const planId = typeof data.planId === 'string' ? data.planId : null;
  const active = proStatus === 'PRO_ACTIVE' || proStatus === 'PRO_GRACE';
  const tier = tierForEntitlementFields(proStatus, planId);
  return { tier, proStatus, planId, expiresAt: data.expiresAt ?? null };
}
