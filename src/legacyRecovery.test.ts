import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';

const authState = vi.hoisted(() => ({ currentUser: null as null | { uid: string } }));
vi.mock('./firebase', () => ({ getSurfaceFirebase: () => ({ auth: authState }) }));

import type { Note, Pin } from './db';
import type { SurfaceMedia } from './media';
import { workspaceDatabaseName } from './localWorkspace';

const LEGACY_RECORDS = 'surface-pwa';
const LEGACY_MEDIA = 'surface-pwa-media';
const RECOVERY = 'surface-pwa-legacy-recovery';
let uidSequence = 0;
const uid = () => `legacy-test-${++uidSequence}`;

function pin(id = 'pin-1', extra: Partial<Pin> = {}): Pin {
  return { id, name: 'Person', phone: '123', about: 'About', createdAt: 1, updatedAt: 2, ...extra };
}
function note(id = 'note-1', extra: Partial<Note> = {}): Note {
  return { id, name: 'Note', phone: '', body: 'Text', createdAt: 1, updatedAt: 2, ...extra };
}
function media(id = 'media-1', extra: Partial<SurfaceMedia> = {}): SurfaceMedia {
  const blob = new Blob(['same-image'], { type: 'image/jpeg' });
  return { id, original: blob, processed: blob, createdAt: 1, dateKey: '01/01/1970', timeLabel: '12:00 AM', capture: true, ...extra };
}

async function seedLegacy(data: { pins?: Pin[]; notes?: Note[]; media?: SurfaceMedia[] }) {
  const records = await openDB(LEGACY_RECORDS, 4, { upgrade(db) { db.createObjectStore('pins', { keyPath: 'id' }); db.createObjectStore('notes', { keyPath: 'id' }); } });
  const recordsTx = records.transaction(['pins', 'notes'], 'readwrite');
  for (const item of data.pins ?? []) await recordsTx.objectStore('pins').put(item);
  for (const item of data.notes ?? []) await recordsTx.objectStore('notes').put(item);
  await recordsTx.done;
  records.close();
  const mediaDb = await openDB(LEGACY_MEDIA, 1, { upgrade(db) { db.createObjectStore('media', { keyPath: 'id' }); } });
  const mediaTx = mediaDb.transaction('media', 'readwrite');
  for (const item of data.media ?? []) await mediaTx.objectStore('media').put(item);
  await mediaTx.done;
  mediaDb.close();
}

async function readLegacyCountsFromStores() {
  const recovery = await import('./legacyRecovery');
  return recovery.getLegacyRecoveryStatus(uid());
}

beforeEach(async () => {
  authState.currentUser = null;
  const recoveryDb = await openDB(RECOVERY, 1, { upgrade(db) { db.createObjectStore('state', { keyPath: 'key' }); } });
  await recoveryDb.put('state', { key: 'state', migrationState: 'not_started', dismissedUids: [] });
  recoveryDb.close();
  for (const [name, version, stores] of [[LEGACY_RECORDS, 4, ['pins', 'notes']], [LEGACY_MEDIA, 1, ['media']]] as const) {
    if (!indexedDB.databases || (await indexedDB.databases()).some((entry) => entry.name === name)) {
      const db = await openDB(name, version);
      for (const store of stores) if (db.objectStoreNames.contains(store)) await db.clear(store);
      db.close();
    }
  }
});

describe('legacy local data recovery', () => {
  it('1. no legacy data produces no prompt', async () => {
    expect((await readLegacyCountsFromStores()).prompt).toBe(false);
  });

  it('2. PIN-only legacy data produces a prompt', async () => {
    await seedLegacy({ pins: [pin()] });
    expect((await readLegacyCountsFromStores()).prompt).toBe(true);
  });

  it('3. media-only legacy data produces a prompt', async () => {
    await seedLegacy({ media: [media()] });
    expect((await readLegacyCountsFromStores()).prompt).toBe(true);
  });

  it('4. status exposes counts only, never legacy record contents', async () => {
    await seedLegacy({ pins: [pin()] });
    const status = await readLegacyCountsFromStores();
    expect(status.counts).toEqual({ pins: 1, notes: 0, followups: 0, media: 0 });
    expect(status).not.toHaveProperty('records');
    expect(JSON.stringify(status)).not.toContain('Person');
  });

  it('5. Leave untouched does not mutate legacy stores', async () => {
    await seedLegacy({ pins: [pin()] });
    const { readLegacyDataset, dismissLegacyRecovery } = await import('./legacyRecovery');
    const original = await readLegacyDataset();
    await dismissLegacyRecovery(uid());
    expect(await readLegacyDataset()).toEqual(original);
  });

  it('6. dismissal persists for that account', async () => {
    await seedLegacy({ pins: [pin()] });
    const recovery = await import('./legacyRecovery');
    const account = uid();
    await recovery.dismissLegacyRecovery(account);
    expect((await recovery.getLegacyRecoveryStatus(account)).prompt).toBe(false);
    expect((await recovery.getLegacyRecoveryStatus(account)).dismissed).toBe(true);
  });

  it('7. dismissed data remains available from the later Account entry point', async () => {
    await seedLegacy({ pins: [pin()] });
    const recovery = await import('./legacyRecovery');
    const account = uid();
    await recovery.dismissLegacyRecovery(account);
    const status = await recovery.getLegacyRecoveryStatus(account);
    expect(status.available).toBe(true);
    expect(status.dismissed).toBe(true);
  });

  it('7a. dismissing for UID A leaves the unclaimed prompt available to UID B', async () => {
    await seedLegacy({ pins: [pin()] });
    const recovery = await import('./legacyRecovery');
    const accountA = uid(); const accountB = uid();
    await recovery.dismissLegacyRecovery(accountA);
    expect((await recovery.getLegacyRecoveryStatus(accountA)).prompt).toBe(false);
    expect((await recovery.getLegacyRecoveryStatus(accountB)).prompt).toBe(true);
  });

  it('8. detection does not claim data; explicit migration is required', async () => {
    await seedLegacy({ pins: [pin()] });
    expect((await readLegacyCountsFromStores()).available).toBe(true);
  });

  it('9. migration copies PINs to the authenticated UID workspace', async () => {
    await seedLegacy({ pins: [pin()] });
    const account = uid(); authState.currentUser = { uid: account };
    const [{ migrateLegacyData }, db] = await Promise.all([import('./legacyRecovery'), import('./db')]);
    await migrateLegacyData(account);
    expect(await db.listPins(account)).toHaveLength(1);
  });

  it('10. migration copies Notes', async () => {
    await seedLegacy({ notes: [note()] });
    const account = uid(); authState.currentUser = { uid: account };
    const [{ migrateLegacyData }, db] = await Promise.all([import('./legacyRecovery'), import('./db')]);
    await migrateLegacyData(account);
    expect(await db.listNotes(account)).toHaveLength(1);
  });

  it('11. migration preserves follow-up/reminder metadata', async () => {
    const reminder = pin('reminder', { followUpAt: 99, followUpReason: 'Call back' });
    await seedLegacy({ pins: [reminder] });
    const account = uid(); authState.currentUser = { uid: account };
    const [{ migrateLegacyData }, db] = await Promise.all([import('./legacyRecovery'), import('./db')]);
    expect(await migrateLegacyData(account)).toMatchObject({ followups: 1 });
    expect((await db.listPins(account))[0]).toMatchObject({ followUpAt: 99, followUpReason: 'Call back' });
  });

  it('12. migration copies original and processed media blobs', async () => {
    const item = media(); await seedLegacy({ media: [item] });
    const account = uid(); authState.currentUser = { uid: account };
    const [{ migrateLegacyData }, target] = await Promise.all([import('./legacyRecovery'), import('./media')]);
    await migrateLegacyData(account);
    const copied = (await target.listMediaRaw(account))[0];
    expect(await copied.original.text()).toBe('same-image');
    expect(await copied.processed.text()).toBe('same-image');
  });

  it('13. PIN, Note and media relationships survive migration', async () => {
    await seedLegacy({ pins: [pin('p', { mediaIds: ['m'], sourceNoteId: 'n' })], notes: [note('n', { imageMediaId: 'm' })], media: [media('m', { pinIds: ['p'] })] });
    const account = uid(); authState.currentUser = { uid: account };
    const [{ migrateLegacyData }, db, target] = await Promise.all([import('./legacyRecovery'), import('./db'), import('./media')]);
    await migrateLegacyData(account);
    expect((await db.listPins(account))[0]).toMatchObject({ mediaIds: ['m'], sourceNoteId: 'n' });
    expect((await db.listNotes(account))[0]).toMatchObject({ imageMediaId: 'm' });
    expect((await target.listMediaRaw(account))[0]).toMatchObject({ pinIds: ['p'] });
  });

  it('14. identical ID collisions deduplicate', async () => {
    const old = pin(); await seedLegacy({ pins: [old] });
    const account = uid(); authState.currentUser = { uid: account };
    const [{ migrateLegacyData }, db] = await Promise.all([import('./legacyRecovery'), import('./db')]);
    await db.insertPinIfAbsent(account, old);
    await migrateLegacyData(account);
    expect(await db.listPins(account)).toHaveLength(1);
  });

  it('15. divergent ID collisions preserve both with a deterministic conflict ID', async () => {
    await seedLegacy({ pins: [pin('same', { name: 'Legacy' })] });
    const account = uid(); authState.currentUser = { uid: account };
    const [{ migrateLegacyData }, db] = await Promise.all([import('./legacyRecovery'), import('./db')]);
    await db.insertPinIfAbsent(account, pin('same', { name: 'Current' }));
    await migrateLegacyData(account);
    expect((await db.listPins(account)).map((item) => item.id).sort()).toEqual(['same', 'same__legacy_v1']);
  });

  it('15a. an existing deterministic conflict copy is reused on retry', async () => {
    const recovery = await import('./legacyRecovery');
    const source = { pins: [pin('same', { name: 'Legacy' })], notes: [], media: [] };
    const target = { pins: [pin('same', { name: 'Current' }), pin('same__legacy_v1', { name: 'Legacy' })], notes: [], media: [] };
    const planned = await recovery.planLegacyMigration(source, target);
    expect(planned.pins.map((item) => item.id)).toEqual(['same__legacy_v1']);
  });

  it('16. failed migration leaves all legacy source records intact', async () => {
    await seedLegacy({ pins: [pin()] });
    const account = uid(); authState.currentUser = { uid: account };
    const [{ migrateLegacyData, readLegacyDataset }, db] = await Promise.all([import('./legacyRecovery'), import('./db')]);
    const original = await readLegacyDataset();
    vi.spyOn(db, 'insertPinIfAbsent').mockRejectedValueOnce(new Error('injected local write failure'));
    await expect(migrateLegacyData(account)).rejects.toThrow('injected local write failure');
    expect(await readLegacyDataset()).toEqual(original);
  });

  it('17. retry after partial failure completes without duplicating already copied media', async () => {
    await seedLegacy({ pins: [pin('p', { mediaIds: ['m'] })], media: [media('m', { pinIds: ['p'] })] });
    const account = uid(); authState.currentUser = { uid: account };
    const [{ migrateLegacyData }, db, target] = await Promise.all([import('./legacyRecovery'), import('./db'), import('./media')]);
    const writeNote = vi.spyOn(db, 'insertPinIfAbsent').mockRejectedValueOnce(new Error('temporary write failure'));
    await expect(migrateLegacyData(account)).rejects.toThrow('temporary write failure');
    writeNote.mockRestore();
    await migrateLegacyData(account);
    expect(await db.listPins(account)).toHaveLength(1);
    expect(await target.listMediaRaw(account)).toHaveLength(1);
  });

  it('18. analytics is blocked while migration state is in progress', async () => {
    await seedLegacy({ pins: [pin()] });
    const account = uid(); authState.currentUser = { uid: account };
    const recovery = await import('./legacyRecovery');
    const { openDB: open } = await import('idb');
    const stateDb = await open(RECOVERY, 1);
    await stateDb.put('state', { key: 'state', migrationState: 'in_progress', migrationUid: account, dismissedUids: [] }); stateDb.close();
    expect(await recovery.isLegacyMigrationInProgress(account)).toBe(true);
  });

  it('19. verified migration clears the analytics gate', async () => {
    await seedLegacy({ pins: [pin()] });
    const account = uid(); authState.currentUser = { uid: account };
    const recovery = await import('./legacyRecovery');
    await recovery.migrateLegacyData(account);
    expect(await recovery.isLegacyMigrationInProgress(account)).toBe(false);
    expect((await recovery.getLegacyRecoveryStatus(account)).available).toBe(false);
  });

  it('20. UID B cannot list UID A migrated records', async () => {
    await seedLegacy({ pins: [pin()] });
    const accountA = uid(); authState.currentUser = { uid: accountA };
    const [{ migrateLegacyData }, db] = await Promise.all([import('./legacyRecovery'), import('./db')]);
    await migrateLegacyData(accountA);
    expect(await db.listPins(uid())).toEqual([]);
  });

  it('21. UID B cannot claim an already claimed legacy dataset', async () => {
    await seedLegacy({ pins: [pin()] });
    const accountA = uid(); authState.currentUser = { uid: accountA };
    const recovery = await import('./legacyRecovery');
    await recovery.migrateLegacyData(accountA);
    const accountB = uid(); authState.currentUser = { uid: accountB };
    await expect(recovery.migrateLegacyData(accountB)).rejects.toThrow(/already been claimed/i);
    const status = await recovery.getLegacyRecoveryStatus(accountB);
    expect(status.available).toBe(false);
    expect(status.counts).toEqual({ pins: 0, notes: 0, followups: 0, media: 0 });
  });

  it('22. sign-out during migration aborts before claim and preserves source', async () => {
    await seedLegacy({ pins: [pin()] });
    const account = uid(); authState.currentUser = { uid: account };
    const [{ migrateLegacyData, readLegacyDataset }, db] = await Promise.all([import('./legacyRecovery'), import('./db')]);
    const original = await readLegacyDataset();
    vi.spyOn(db, 'insertPinIfAbsent').mockImplementationOnce(async () => { authState.currentUser = null; return false; });
    await expect(migrateLegacyData(account)).rejects.toThrow(/account changed/i);
    expect(await readLegacyDataset()).toEqual(original);
  });

  it('23. account change during migration aborts safely', async () => {
    await seedLegacy({ pins: [pin()] });
    const account = uid(); authState.currentUser = { uid: account };
    const [{ migrateLegacyData, readLegacyDataset }, db, recovery] = await Promise.all([import('./legacyRecovery'), import('./db'), import('./legacyRecovery')]);
    const original = await readLegacyDataset();
    vi.spyOn(db, 'insertPinIfAbsent').mockImplementationOnce(async () => { authState.currentUser = { uid: 'different-user' }; return false; });
    await expect(migrateLegacyData(account)).rejects.toThrow(/account changed/i);
    expect(await readLegacyDataset()).toEqual(original);
    expect(await recovery.getLegacyRecoveryStatus(uid())).toMatchObject({ available: true });
  });

  it('24. migrated data excludes legacy organization and account attribution fields', async () => {
    await seedLegacy({ pins: [Object.assign(pin(), { organizationId: 'old-org', ownerUid: 'stale-owner', analyticsAttribution: { uid: 'stale' } })] });
    const account = uid(); authState.currentUser = { uid: account };
    const [{ migrateLegacyData }, db] = await Promise.all([import('./legacyRecovery'), import('./db')]);
    await migrateLegacyData(account);
    const copied = (await db.listPins(account))[0] as Pin & Record<string, unknown>;
    expect(copied).not.toHaveProperty('organizationId');
    expect(copied).not.toHaveProperty('ownerUid');
    expect(copied).not.toHaveProperty('analyticsAttribution');
  });
});
