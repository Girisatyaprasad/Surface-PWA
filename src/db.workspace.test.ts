import { beforeEach, describe, expect, it, vi } from 'vitest';

const { databases } = vi.hoisted(() => ({ databases: new Map<string, Map<string, Map<string, any>>>() }));
vi.mock('idb', () => ({
  openDB: async (name: string) => {
    const stores = databases.get(name) ?? new Map<string, Map<string, any>>();
    databases.set(name, stores);
    const store = (key: string) => { const values = stores.get(key) ?? new Map<string, any>(); stores.set(key, values); return values; };
    const api = (name: string) => ({
      get: async (key: string) => store(name).get(key),
      put: async (value: any) => { store(name).set(String(value.key ?? value.id ?? value.day ?? value.insightId ?? value.stateKey ?? value.ownerUid), value); },
      getAll: async () => [...store(name).values()],
      getAllFromIndex: async () => [...store(name).values()],
      delete: async (key: string) => { store(name).delete(String(key)); },
      count: async () => store(name).size,
    });
    return {
      ...api(''),
      get: async (name: string, key: string) => api(name).get(key),
      put: async (name: string, value: any) => api(name).put(value),
      getAll: async (name: string) => api(name).getAll(),
      getAllFromIndex: async (name: string) => api(name).getAllFromIndex(),
      delete: async (name: string, key: string) => api(name).delete(key),
      count: async (name: string) => api(name).count(),
      transaction: (name: string) => ({ store: api(name), done: Promise.resolve() }),
      close: () => undefined,
    };
  },
  deleteDB: async (name: string) => { databases.delete(name); },
}));

import { createNote, createPin, listLocalAnalyticsActivity, listNotes, listPins, pendingPinOperations, putPin, queueAnalyticsSnapshot, queuePinOperation, dueAnalyticsSnapshots, queueIisInsight, dueIisInsights, markIisStateSubmitted, wasIisStateSubmitted } from './db';
import { eraseLocalWorkspace } from './localWorkspaceData';
import { workspaceDatabaseName } from './localWorkspace';

describe('UID-partitioned local Surface workspaces', () => {
  beforeEach(() => {
    databases.clear();
    vi.stubGlobal('IDBKeyRange', { upperBound: (value: number) => value });
  });

  it('isolates PINs, Notes, relationships and reminders across users and restores each workspace', async () => {
    const pinA = await createPin('uid-A1', 'A private person', 'about A');
    const noteA = await createNote('uid-A1', 'A note', '', 'private A');
    await putPin('uid-A1', { ...pinA, followUpAt: Date.now() + 1000, mediaIds: ['media-A'] });
    const pinB = await createPin('uid-B1', 'B private person', 'about B');

    expect((await listPins('uid-B1')).map((pin) => pin.id)).toEqual([pinB.id]);
    expect(await listNotes('uid-B1')).toEqual([]);
    expect((await listPins('uid-A1')).map((pin) => pin.id)).toEqual([pinA.id]);
    expect((await listNotes('uid-A1')).map((note) => note.id)).toEqual([noteA.id]);
    expect((await listPins('uid-A1'))[0]).toMatchObject({ mediaIds: ['media-A'], followUpAt: expect.any(Number) });
  });

  it('scopes sync queues and daily analytics aggregates/outboxes by UID', async () => {
    await queuePinOperation('uid-A2', { id: 'upsert:A', kind: 'UPSERT_PIN', pinId: 'A' });
    await queuePinOperation('uid-B2', { id: 'upsert:B', kind: 'UPSERT_PIN', pinId: 'B' });
    const day = new Date().toISOString().slice(0, 10);
    await import('./db').then(({ recordLocalAnalyticsActivity }) => recordLocalAnalyticsActivity('uid-A2', 'pin_created'));
    await queueAnalyticsSnapshot('uid-A2', Date.now());

    expect((await pendingPinOperations('uid-B2')).map((item) => item.pinId)).toEqual(['B']);
    expect((await listLocalAnalyticsActivity('uid-B2', day, day))).toEqual([]);
    expect((await listLocalAnalyticsActivity('uid-A2', day, day))[0].peopleAdded).toBe(1);
    expect(await dueAnalyticsSnapshots('uid-B2', Date.now())).toEqual([]);
    expect((await dueAnalyticsSnapshots('uid-A2', Date.now())).map((item) => item.ownerUid)).toEqual(['uid-A2']);
  });

  it('keeps IIS outbox items isolated by UID and replaces obsolete insight state', async () => {
    await queueIisInsight('uid-A-iis', 'iis1_aaaaaaaaaaaaaaaa', 'CONSISTENCY:period', { insightId: 'iis1_aaaaaaaaaaaaaaaa' }, 100);
    await queueIisInsight('uid-A-iis', 'iis1_bbbbbbbbbbbbbbbb', 'CONSISTENCY:period', { insightId: 'iis1_bbbbbbbbbbbbbbbb' }, 200);
    await queueIisInsight('uid-B-iis', 'iis1_cccccccccccccccc', 'CONSISTENCY:period', { insightId: 'iis1_cccccccccccccccc' }, 100);
    expect((await dueIisInsights('uid-A-iis', 300)).map((item) => item.insightId)).toEqual(['iis1_bbbbbbbbbbbbbbbb']);
    expect((await dueIisInsights('uid-B-iis', 300)).map((item) => item.insightId)).toEqual(['iis1_cccccccccccccccc']);
    await markIisStateSubmitted('uid-A-iis', 'CONSISTENCY:period', 'iis1_bbbbbbbbbbbbbbbb', 300);
    expect(await wasIisStateSubmitted('uid-A-iis', 'CONSISTENCY:period', 'iis1_bbbbbbbbbbbbbbbb')).toBe(true);
    expect(await wasIisStateSubmitted('uid-B-iis', 'CONSISTENCY:period', 'iis1_bbbbbbbbbbbbbbbb')).toBe(false);
  });

  it('bounds the offline IIS retry outbox to the newest 100 envelopes', async () => {
    for (let index = 0; index < 101; index += 1) {
      const suffix = index.toString(16).padStart(16, '0');
      await queueIisInsight('uid-iis-bound', `iis1_${suffix}`, `state-${index}`, { generatedAt: index + 1 }, index + 1);
    }
    const queued = await dueIisInsights('uid-iis-bound', 200);
    expect(queued).toHaveLength(100);
    expect(queued.some((item) => item.envelope && typeof item.envelope === 'object' && 'generatedAt' in item.envelope && item.envelope.generatedAt === 1)).toBe(false);
  });

  it('rejects ambiguous IDs, retains the kept UID, and erases only the selected UID', async () => {
    const pinA = await createPin('uid-A3', 'A', '');
    await createPin('uid-B3', 'B', '');
    await expect(listPins('')).rejects.toThrow(/UID is required/i);
    await eraseLocalWorkspace('uid-B3');
    expect(await listPins('uid-A3')).toEqual([pinA]);
    expect(await listPins('uid-B3')).toEqual([]);
  });

  it('fails closed on a mismatched namespace marker and never falls back to legacy global records', async () => {
    const legacyPins = new Map([['legacy-pin', { id: 'legacy-pin', name: 'Unowned', createdAt: 1, updatedAt: 1 }]]);
    databases.set('surface-pwa', new Map([['pins', legacyPins]]));
    databases.set(workspaceDatabaseName('records', 'uid-corrupt'), new Map([
      ['workspaceMetadata', new Map([['ownerUid', { key: 'ownerUid', uid: 'uid-other' }]])],
    ]));

    expect(await listPins('uid-fresh')).toEqual([]);
    expect([...legacyPins.keys()]).toEqual(['legacy-pin']);
    await expect(listPins('uid-corrupt')).rejects.toThrow(/ownership mismatch/i);
  });

  it('fails closed instead of adopting a populated UID database with no owner marker', async () => {
    const databaseName = workspaceDatabaseName('records', 'uid-ambiguous');
    databases.set(databaseName, new Map([
      ['pins', new Map([['private-pin', { id: 'private-pin', name: 'unowned' }]])],
    ]));

    await expect(listPins('uid-ambiguous')).rejects.toThrow(/ownership is ambiguous/i);
    expect(databases.get(databaseName)?.get('pins')?.has('private-pin')).toBe(true);
    expect(databases.get(databaseName)?.get('workspaceMetadata')?.has('ownerUid') ?? false).toBe(false);
  });
});
