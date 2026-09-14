import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authState, db, migrationGate } = vi.hoisted(() => ({
  authState: { currentUser: null as null | { uid: string; getIdToken: () => Promise<string> } },
  migrationGate: { active: false },
  db: {
    dueAnalyticsSnapshots: vi.fn(),
    listLocalAnalyticsActivity: vi.fn(),
    listNotes: vi.fn(),
    listPins: vi.fn(),
    queueAnalyticsSnapshot: vi.fn(),
    recordLocalAnalyticsActivity: vi.fn(),
    removeAnalyticsSnapshot: vi.fn(),
    retryAnalyticsSnapshot: vi.fn(),
    listMedia: vi.fn(),
  },
}));

vi.mock('../firebase', () => ({ getSurfaceFirebase: () => ({ auth: authState }) }));
vi.mock('../db', () => db);
vi.mock('../media', () => ({ listMedia: db.listMedia }));
vi.mock('../legacyRecovery', () => ({ isLegacyMigrationInProgress: async () => migrationGate.active }));

import { flushDueSnapshots } from './snapshotPipeline';

describe('UID-bound organization analytics pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    migrationGate.active = false;
    authState.currentUser = { uid: 'uid-A', getIdToken: async () => 'test-token' };
    db.dueAnalyticsSnapshots.mockImplementation(async (uid: string) => uid === 'uid-A' ? [{ ownerUid: 'uid-A', attempts: 0, nextAttemptAt: 0 }] : []);
    db.listPins.mockResolvedValue([]);
    db.listNotes.mockResolvedValue([]);
    db.listMedia.mockResolvedValue([]);
    db.listLocalAnalyticsActivity.mockResolvedValue([]);
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  });

  it('reads each analytics input from the authenticated UID and submits aggregate data only', async () => {
    await flushDueSnapshots(Date.parse('2026-09-14T12:00:00.000Z'));

    expect(db.dueAnalyticsSnapshots).toHaveBeenCalledWith('uid-A', expect.any(Number));
    expect(db.listPins).toHaveBeenCalledWith('uid-A');
    expect(db.listNotes).toHaveBeenCalledWith('uid-A');
    expect(db.listMedia).toHaveBeenCalledWith('uid-A');
    expect(db.listLocalAnalyticsActivity).toHaveBeenCalledWith('uid-A', expect.any(String), expect.any(String));
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).not.toHaveProperty('uid');
    expect(db.removeAnalyticsSnapshot).toHaveBeenCalledWith('uid-A');
  });

  it('abandons snapshot generation if authentication changes during local reads', async () => {
    db.listPins.mockImplementation(async () => {
      authState.currentUser = { uid: 'uid-B', getIdToken: async () => 'other-token' };
      return [];
    });

    await flushDueSnapshots(Date.parse('2026-09-14T12:00:00.000Z'));

    expect(fetch).not.toHaveBeenCalled();
    expect(db.removeAnalyticsSnapshot).not.toHaveBeenCalled();
    expect(db.retryAnalyticsSnapshot).not.toHaveBeenCalled();
  });

  it('pauses activity recording and snapshot submission while legacy data is being migrated', async () => {
    const { flushDueSnapshots, queueInitialMemberSnapshot, recordSurfaceAnalyticsActivity } = await import('./snapshotPipeline');
    migrationGate.active = true;
    await recordSurfaceAnalyticsActivity('uid-A', 'pin_created');
    await queueInitialMemberSnapshot('uid-A');
    await flushDueSnapshots(Date.parse('2026-09-14T12:00:00.000Z'));

    expect(db.recordLocalAnalyticsActivity).not.toHaveBeenCalled();
    expect(db.queueAnalyticsSnapshot).not.toHaveBeenCalled();
    expect(db.dueAnalyticsSnapshots).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
