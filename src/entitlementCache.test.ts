import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLastKnownEntitlement, writeLastKnownEntitlement } from './entitlementCache';
import type { SurfaceEntitlement } from './entitlement';

const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };

describe('last-known entitlement cache', () => {
  afterEach(() => { values.clear(); vi.unstubAllGlobals(); });

  it('keeps a safe entitlement cache separated by Firebase UID', () => {
    vi.stubGlobal('localStorage', storage);
    const pro: SurfaceEntitlement = { tier: 'PRO', proStatus: 'PRO_ACTIVE', planId: 'PRO_30D', expiresAt: 123 };
    writeLastKnownEntitlement('uid-a', pro);
    expect(readLastKnownEntitlement('uid-a')).toEqual(pro);
    expect(readLastKnownEntitlement('uid-b')).toBeNull();
  });

  it('ignores malformed or invalid cached state', () => {
    vi.stubGlobal('localStorage', { ...storage, getItem: () => '{broken' });
    expect(readLastKnownEntitlement('uid-a')).toBeNull();
  });
});
