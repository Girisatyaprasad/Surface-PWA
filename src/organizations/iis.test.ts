import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authState, db, migrationGate, workspaceGate } = vi.hoisted(() => ({
  authState: { currentUser: null as null | { uid: string; getIdToken: () => Promise<string> } },
  migrationGate: { active: false },
  workspaceGate: { fail: false },
  db: { listPins: vi.fn(), listNotes: vi.fn(), listMedia: vi.fn(), listLocalAnalyticsActivity: vi.fn() },
}));

vi.mock('../firebase', () => ({ getSurfaceFirebase: () => ({ auth: authState }) }));
vi.mock('../db', () => db);
vi.mock('../legacyRecovery', () => ({ isLegacyMigrationInProgress: async () => migrationGate.active, readLegacyDataset: vi.fn() }));
vi.mock('../localWorkspace', () => ({ requireWorkspaceUid: (uid: string) => { if (!uid || uid.includes('/')) throw new Error('invalid uid'); if (workspaceGate.fail) throw new Error('ownership mismatch'); return uid; } }));

import { deriveClientIisInsights, deriveUidWorkspaceIisInsights, validateIisInsightEnvelope } from './iis';

const now = Date.parse('2026-09-14T12:00:00.000Z');
const dayMs = 86_400_000;
const shell = () => ({
  analyticsVersion: 1 as const, periodStart: Math.floor(now / dayMs) * dayMs - 29 * dayMs,
  periodEnd: Math.floor(now / dayMs) * dayMs + dayMs - 1, generatedAt: now, eligibleDays: 30 as const,
  peopleAdded: 0, activePins: 0, followupsDue: 0, followupsCompleted: 0, followupsMissed: 0,
  relationshipStageCounts: {}, stalePeopleCount: 0, notesCreated: 0, capturesCreated: 0, eventsCreated: 0 as const,
  activeDays: 0, consistencyScore: 0, activityByDay: [],
  sourceStatus: { followupCompletion: 'unsupported' as const, relationshipStages: 'unsupported' as const, events: 'unsupported' as const },
});
const safeAggregates = () => ({
  current7d: { activity: 8, activeDays: 5, peopleAdded: 4, followupsDue: 0, followupsMissed: 0 },
  previous7d: { activity: 2, activeDays: 1, peopleAdded: 1 },
  current30d: { activity: 20, activeDays: 12, peopleAdded: 8, followupsDue: 2, followupsMissed: 2 },
  previous30d: { activity: 12, activeDays: 8, peopleAdded: 5 },
  stalePeople: 6, activePins: 10,
});

describe('client IIS engine and workspace boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.currentUser = { uid: 'uid-current', getIdToken: async () => 'not-used-by-engine' };
    migrationGate.active = false;
    workspaceGate.fail = false;
    db.listPins.mockResolvedValue([{ id: 'local-id-secret', name: 'Private Person', phone: '9876543210', about: 'Private narrative', locationLabel: 'Private location', createdAt: now, updatedAt: now - 60 * dayMs, followUpAt: now - dayMs }]);
    db.listNotes.mockResolvedValue([{ id: 'private-note-id', name: 'Private Note Name', phone: '123', body: 'Private note body', createdAt: now, updatedAt: now }]);
    db.listMedia.mockResolvedValue([{ id: 'private-media-id', original: new Blob(['x']), processed: new Blob(['x']), createdAt: now, capture: true, location: { latitude: 1, longitude: 2 } }]);
    db.listLocalAnalyticsActivity.mockResolvedValue(Array.from({ length: 60 }, (_, index) => ({ day: new Date(Math.floor(now / dayMs) * dayMs - (59 - index) * dayMs).toISOString().slice(0, 10), activityCount: index >= 53 ? 2 : index >= 46 ? 0 : 1, peopleAdded: index >= 53 ? 1 : 0, notesCreated: 0, capturesCreated: 0 })));
  });

  it('reads only the authenticated UID workspace', async () => {
    await deriveUidWorkspaceIisInsights('uid-current', now);
    expect(db.listPins).toHaveBeenCalledWith('uid-current');
    expect(db.listLocalAnalyticsActivity).toHaveBeenCalledWith('uid-current', expect.any(String), expect.any(String));
    expect(db.listNotes).not.toHaveBeenCalled();
    expect(db.listMedia).not.toHaveBeenCalled();
  });
  it('does not inspect the legacy shared database', async () => {
    await deriveUidWorkspaceIisInsights('uid-current', now);
    expect((await import('../legacyRecovery')).readLegacyDataset).not.toHaveBeenCalled();
  });
  it('blocks IIS while migration is in progress', async () => {
    migrationGate.active = true;
    expect(await deriveUidWorkspaceIisInsights('uid-current', now)).toEqual([]);
    expect(db.listPins).not.toHaveBeenCalled();
  });
  it('fails closed on ambiguous or mismatched workspace ownership', async () => {
    workspaceGate.fail = true;
    await expect(deriveUidWorkspaceIisInsights('uid-current', now)).rejects.toThrow(/ownership mismatch/i);
  });
  it('does not analyze without an authenticated account', async () => {
    authState.currentUser = null;
    expect(await deriveUidWorkspaceIisInsights('uid-current', now)).toEqual([]);
    expect(db.listPins).not.toHaveBeenCalled();
  });
  it('aborts analysis when auth changes during local reads', async () => {
    db.listPins.mockImplementation(async () => { authState.currentUser = { uid: 'uid-other', getIdToken: async () => 'other' }; return []; });
    expect(await deriveUidWorkspaceIisInsights('uid-current', now)).toEqual([]);
  });
  it('does not send local private names, phone, note text, media references, or coordinates', async () => {
    const result = await deriveUidWorkspaceIisInsights('uid-current', now);
    const payload = JSON.stringify(result);
    for (const forbidden of ['Private Person', '9876543210', 'Private narrative', 'Private Note Name', 'Private note body', 'local-id-secret', 'private-media-id', 'latitude', 'longitude', 'Private location']) expect(payload).not.toContain(forbidden);
    for (const insight of result) for (const metric of Object.values(insight.evidenceMetrics)) expect(typeof metric).toBe('number');
  });
  it('derives improving consistency from current and previous numeric aggregates', () => {
    const result = deriveClientIisInsights(shell(), null, safeAggregates());
    expect(result.some((item) => item.insightCode === 'CONSISTENCY_IMPROVING')).toBe(true);
  });
  it('derives declining consistency from lower current active-day rate', () => {
    const values = safeAggregates();
    values.current7d.activeDays = 1;
    values.previous7d.activeDays = 6;
    const result = deriveClientIisInsights(shell(), null, values);
    expect(result.some((item) => item.insightCode === 'CONSISTENCY_DECLINING')).toBe(true);
  });
  it('derives people-add momentum only from numeric counts', () => {
    expect(deriveClientIisInsights(shell(), null, safeAggregates()).some((item) => item.insightCode === 'NEW_PEOPLE_MOMENTUM_RISING')).toBe(true);
  });
  it('derives high stale rate without exposing PIN records', () => {
    expect(deriveClientIisInsights(shell(), null, safeAggregates()).find((item) => item.insightCode === 'HIGH_STALE_RELATIONSHIP_RATE')?.evidenceMetrics).toEqual({ stalePeople: 6, activePins: 10, rate: 0.6 });
  });
  it('ignores soft-deleted PINs when deriving stale and follow-up metrics', async () => {
    db.listPins.mockResolvedValue([{ id: 'deleted', name: 'Deleted person', phone: '555', about: '', locationLabel: '', createdAt: now, updatedAt: now - 60 * dayMs, followUpAt: now - dayMs, deletedAt: now }]);
    const result = await deriveUidWorkspaceIisInsights('uid-current', now);
    expect(result.some((item) => item.insightCode === 'HIGH_STALE_RELATIONSHIP_RATE' || item.insightCode === 'HIGH_FOLLOWUP_MISS_RATE')).toBe(false);
  });
  it('derives high overdue follow-up rate only when due observations exist', () => {
    expect(deriveClientIisInsights(shell(), null, safeAggregates()).some((item) => item.insightCode === 'HIGH_FOLLOWUP_MISS_RATE')).toBe(true);
    const values = safeAggregates(); values.current30d.followupsDue = 0;
    expect(deriveClientIisInsights(shell(), null, values).some((item) => item.insightCode === 'HIGH_FOLLOWUP_MISS_RATE')).toBe(false);
  });
  it('does not invent events or unsupported relationship-decay trends', () => {
    const codes = deriveClientIisInsights(shell(), null, safeAggregates()).map((item) => item.insightCode);
    expect(codes).not.toContain('EVENTS_CREATED');
    expect(codes).not.toContain('RELATIONSHIP_DECAY_RISING');
    expect(codes).not.toContain('RELATIONSHIP_DECAY_FALLING');
  });
  it('creates stable IDs for an unchanged insight state', () => {
    const first = deriveClientIisInsights(shell(), null, safeAggregates());
    const second = deriveClientIisInsights(shell(), null, safeAggregates());
    expect(first.map((item) => item.insightId)).toEqual(second.map((item) => item.insightId));
  });
  it('rejects arbitrary strings and unexpected private fields in a client envelope', () => {
    const valid = deriveClientIisInsights(shell(), null, safeAggregates())[0];
    expect(() => validateIisInsightEnvelope({ ...valid, privateName: 'x' }, now)).toThrow();
    expect(() => validateIisInsightEnvelope({ ...valid, evidenceMetrics: { ...valid.evidenceMetrics, noteText: 'x' } }, now)).toThrow();
  });
  it('marks unsupported relationship stage, follow-up completion and Event sources explicitly', () => {
    expect(shell().sourceStatus).toEqual({ followupCompletion: 'unsupported', relationshipStages: 'unsupported', events: 'unsupported' });
  });
});
