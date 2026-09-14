import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authState, migrationGate, db, queueState, derived, authListener } = vi.hoisted(() => ({
  authState: { currentUser: null as null | { uid: string; getIdToken: () => Promise<string> } },
  migrationGate: { active: false },
  queueState: { items: [] as any[], submitted: new Map<string, string>() },
  derived: { insights: [] as any[], switchUid: null as string | null },
  authListener: { callback: null as null | ((user: { uid: string } | null) => void) },
  db: {
    dueIisInsights: vi.fn(), markIisStateSubmitted: vi.fn(), pendingIisStateKeys: vi.fn(), queueIisInsight: vi.fn(), removeIisInsight: vi.fn(), retryIisInsight: vi.fn(), wasIisStateSubmitted: vi.fn(),
  },
}));

vi.mock('../firebase', () => ({ getSurfaceFirebase: () => ({ auth: authState }) }));
vi.mock('../localWorkspace', () => ({ requireWorkspaceUid: (uid: string) => { if (!uid || uid.includes('/')) throw new Error('bad uid'); return uid; } }));
vi.mock('../legacyRecovery', () => ({ isLegacyMigrationInProgress: async () => migrationGate.active }));
vi.mock('./iis', () => ({ deriveUidWorkspaceIisInsights: async () => { if (derived.switchUid) authState.currentUser = { uid: derived.switchUid, getIdToken: async () => 'other-token' }; return derived.insights; } }));
vi.mock('../db', () => db);
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: { uid: string } | null) => void) => { authListener.callback = callback; return () => { authListener.callback = null; }; } }));

import { recomputeAndFlush, startClientIisPipeline } from './iisPipeline';

const insight = {
  schemaVersion: 1, insightId: 'iis1_0123456789abcdef', insightCode: 'CONSISTENCY_IMPROVING', category: 'consistency',
  periodStart: Math.floor(Date.now() / 86_400_000) * 86_400_000 - 6 * 86_400_000, periodEnd: Math.floor(Date.now() / 86_400_000) * 86_400_000 + 86_400_000 - 1,
  severity: 0.2, confidence: 0.7, evidenceMetrics: { currentRate: 0.6, previousRate: 0.4, delta: 0.2, eligibleDays: 7 },
  generatedAt: Date.now(), engineVersion: 'surface-client-iis-v1',
};

describe('client IIS outbox pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueState.items = [];
    queueState.submitted.clear();
    derived.insights = [insight];
    derived.switchUid = null;
    authListener.callback = null;
    migrationGate.active = false;
    authState.currentUser = { uid: 'uid-A', getIdToken: async () => 'firebase-id-token' };
    db.pendingIisStateKeys.mockResolvedValue([]);
    db.wasIisStateSubmitted.mockImplementation(async (_uid: string, key: string, fingerprint: string) => queueState.submitted.get(key) === fingerprint);
    db.queueIisInsight.mockImplementation(async (uid: string, insightId: string, stateKey: string, envelope: unknown, now: number) => {
      queueState.items = queueState.items.filter((item) => item.insightId !== insightId);
      queueState.items.push({ ownerUid: uid, insightId, stateKey, envelope, attempts: 0, nextAttemptAt: now });
    });
    db.dueIisInsights.mockImplementation(async (uid: string) => queueState.items.filter((item) => item.ownerUid === uid));
    db.removeIisInsight.mockImplementation(async (_uid: string, id: string) => { queueState.items = queueState.items.filter((item) => item.insightId !== id); });
    db.markIisStateSubmitted.mockImplementation(async (_uid: string, key: string, fingerprint: string) => { queueState.submitted.set(key, fingerprint); });
    db.retryIisInsight.mockImplementation(async (uid: string, item: any) => { item.attempts += 1; item.nextAttemptAt = Date.now() + 5000; });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 202 })));
  });

  it('queues locally while offline and submits after reconnect', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await recomputeAndFlush('uid-A', 10);
    expect(queueState.items).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', { onLine: true });
    await recomputeAndFlush('uid-A', 20);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(queueState.items).toHaveLength(0);
    expect(db.markIisStateSubmitted).toHaveBeenCalledWith('uid-A', 'CONSISTENCY_IMPROVING:7', expect.any(String), 20);
  });
  it('submits only with the current Firebase ID token and verified UID workspace', async () => {
    await recomputeAndFlush('uid-A', 30);
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer firebase-id-token');
    expect(JSON.parse(String(init.body))).toEqual({ insights: [insight] });
  });
  it('pauses when migration is in progress', async () => {
    migrationGate.active = true;
    await recomputeAndFlush('uid-A', 40);
    expect(db.queueIisInsight).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('aborts if authentication changes during analysis', async () => {
    derived.switchUid = 'uid-B';
    await recomputeAndFlush('uid-A', 50);
    expect(db.queueIisInsight).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not repeatedly submit an unchanged successfully submitted state', async () => {
    await recomputeAndFlush('uid-A', 60);
    await recomputeAndFlush('uid-A', 70);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.queueIisInsight).toHaveBeenCalledTimes(1);
  });
  it('does not resubmit identical evidence just because the rolling window moved', async () => {
    await recomputeAndFlush('uid-A', 60);
    const dayMs = 86_400_000;
    derived.insights = [{ ...insight, insightId: 'iis1_aaaaaaaaaaaaaaaa', periodStart: insight.periodStart + dayMs, periodEnd: insight.periodEnd + dayMs, generatedAt: insight.generatedAt + dayMs }];
    await recomputeAndFlush('uid-A', 70);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retains a retryable item after server/network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
    await recomputeAndFlush('uid-A', 80);
    expect(db.retryIisInsight).toHaveBeenCalledWith('uid-A', expect.objectContaining({ insightId: insight.insightId }), 80);
    expect(queueState.items).toHaveLength(1);
  });
  it('aborts a queued send if the active UID changes before token retrieval completes', async () => {
    authState.currentUser = { uid: 'uid-B', getIdToken: async () => 'other-token' };
    await recomputeAndFlush('uid-A', 90);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('aborts an in-flight submission when the authenticated UID changes', async () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), setInterval: () => 1, clearInterval: vi.fn(), setTimeout: () => 2, clearTimeout: vi.fn() });
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      markFetchStarted();
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })));
    const stop = startClientIisPipeline();
    const pending = recomputeAndFlush('uid-A', 100);
    await fetchStarted;
    authState.currentUser = { uid: 'uid-B', getIdToken: async () => 'other-token' };
    authListener.callback?.({ uid: 'uid-B' });
    await pending;
    expect((vi.mocked(fetch).mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(db.retryIisInsight).not.toHaveBeenCalled();
    stop();
  });
});
