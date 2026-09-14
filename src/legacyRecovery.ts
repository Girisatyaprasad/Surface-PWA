import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  insertNoteIfAbsent, insertPinIfAbsent,
  listNotes, listPins, type Note, type Pin,
} from './db';
import { insertMediaIfAbsent, listMediaRaw, type SurfaceMedia } from './media';
import { requireWorkspaceUid } from './localWorkspace';
import { getSurfaceFirebase } from './firebase';

const RECOVERY_DB = 'surface-pwa-legacy-recovery';
const RECOVERY_VERSION = 1;
const MIGRATION_VERSION = 1;
const LEGACY_RECORDS_DB = 'surface-pwa';
const LEGACY_MEDIA_DB = 'surface-pwa-media';

export type LegacyCounts = { pins: number; notes: number; followups: number; media: number };
export type LegacyRecoveryStatus = {
  counts: LegacyCounts;
  available: boolean;
  dismissed: boolean;
  prompt: boolean;
  locked: boolean;
};
export type LegacyMigrationState = 'not_started' | 'in_progress' | 'verified' | 'failed';
export type LegacyDataset = { pins: Pin[]; notes: Note[]; media: SurfaceMedia[] };
type RecoveryRecord = {
  key: 'state';
  migrationState: LegacyMigrationState;
  migrationVersion?: number;
  migrationUid?: string;
  claimedByUid?: string;
  claimedAt?: number;
  dismissedUids: string[];
};
interface RecoveryDb extends DBSchema { state: { key: string; value: RecoveryRecord } }
type OpenRecoveryDb = IDBPDatabase<RecoveryDb>;
let stateDb: Promise<OpenRecoveryDb> | undefined;

function recoveryDatabase(): Promise<OpenRecoveryDb> {
  stateDb ??= openDB<RecoveryDb>(RECOVERY_DB, RECOVERY_VERSION, {
    upgrade(db) { db.createObjectStore('state', { keyPath: 'key' }); },
  });
  return stateDb;
}

async function readState(): Promise<RecoveryRecord> {
  const db = await recoveryDatabase();
  return await db.get('state', 'state') ?? { key: 'state', migrationState: 'not_started', dismissedUids: [] };
}

async function writeState(value: RecoveryRecord): Promise<void> {
  await (await recoveryDatabase()).put('state', value);
}

function hasFollowUp(pin: Pin): boolean {
  return typeof pin.followUpAt === 'number' || Boolean(pin.followUpReason?.trim());
}

async function openExistingDatabase(name: string): Promise<IDBDatabase | null> {
  const factory = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> };
  if (factory.databases) {
    const entries = await factory.databases();
    if (!entries.some((entry) => entry.name === name)) return null;
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    let wasMissing = false;
    request.onupgradeneeded = (event) => {
      if ((event as IDBVersionChangeEvent).oldVersion === 0) {
        wasMissing = true;
        request.transaction?.abort();
      }
    };
    request.onsuccess = () => {
      if (!wasMissing) { resolve(request.result); return; }
      const created = request.result;
      created.close();
      const deletion = indexedDB.deleteDatabase(name);
      deletion.onsuccess = () => resolve(null);
      deletion.onerror = () => reject(deletion.error ?? new Error('Could not clean up an empty legacy database probe.'));
      deletion.onblocked = () => reject(new Error('Legacy database probe cleanup was blocked.'));
    };
    request.onerror = () => {
      if (wasMissing) resolve(null);
      else reject(request.error ?? new Error('Could not open legacy local data.'));
    };
    request.onblocked = () => reject(new Error('Legacy local data is busy in another tab.'));
  });
}

async function readStore<T>(database: IDBDatabase | null, storeName: string): Promise<T[]> {
  if (!database || !database.objectStoreNames.contains(storeName)) return [];
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error ?? new Error('Could not read legacy local data.'));
  });
}

async function countStore(database: IDBDatabase | null, storeName: string): Promise<number> {
  if (!database || !database.objectStoreNames.contains(storeName)) return 0;
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, 'readonly').objectStore(storeName).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not count legacy local data.'));
  });
}

async function countLegacyFollowups(database: IDBDatabase | null): Promise<number> {
  if (!database || !database.objectStoreNames.contains('pins')) return 0;
  return new Promise((resolve, reject) => {
    const request = database.transaction('pins', 'readonly').objectStore('pins').openCursor();
    let count = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(count); return; }
      const value = cursor.value as Partial<Pin>;
      if (typeof value.followUpAt === 'number' || Boolean(value.followUpReason?.trim())) count += 1;
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('Could not count legacy reminders.'));
  });
}

async function readLegacyCounts(): Promise<LegacyCounts> {
  const [recordsDb, mediaDb] = await Promise.all([
    openExistingDatabase(LEGACY_RECORDS_DB), openExistingDatabase(LEGACY_MEDIA_DB),
  ]);
  try {
    const [pins, notes, followups, media] = await Promise.all([
      countStore(recordsDb, 'pins'), countStore(recordsDb, 'notes'), countLegacyFollowups(recordsDb), countStore(mediaDb, 'media'),
    ]);
    return { pins, notes, followups, media };
  } finally {
    recordsDb?.close();
    mediaDb?.close();
  }
}

export async function readLegacyDataset(): Promise<LegacyDataset> {
  const [recordsDb, mediaDb] = await Promise.all([
    openExistingDatabase(LEGACY_RECORDS_DB), openExistingDatabase(LEGACY_MEDIA_DB),
  ]);
  try {
    const [pins, notes, media] = await Promise.all([
      readStore<Pin>(recordsDb, 'pins'), readStore<Note>(recordsDb, 'notes'), readStore<SurfaceMedia>(mediaDb, 'media'),
    ]);
    return { pins, notes, media };
  } finally {
    recordsDb?.close();
    mediaDb?.close();
  }
}

export function legacyCounts(dataset: LegacyDataset): LegacyCounts {
  return {
    pins: dataset.pins.length,
    notes: dataset.notes.length,
    followups: dataset.pins.filter(hasFollowUp).length,
    media: dataset.media.length,
  };
}

export async function getLegacyRecoveryStatus(uid: string): Promise<LegacyRecoveryStatus> {
  const ownerUid = requireWorkspaceUid(uid);
  const [counts, state] = await Promise.all([readLegacyCounts(), readState()]);
  const hasData = Object.values(counts).some((count) => count > 0);
  const claimed = Boolean(state.claimedByUid);
  const locked = state.migrationState === 'in_progress' && state.migrationUid !== ownerUid;
  const available = hasData && !claimed;
  const dismissed = state.dismissedUids.includes(ownerUid);
  return {
    counts: claimed && state.claimedByUid !== ownerUid ? { pins: 0, notes: 0, followups: 0, media: 0 } : counts,
    available, dismissed, prompt: available && !dismissed && !locked, locked,
  };
}

export async function dismissLegacyRecovery(uid: string): Promise<void> {
  const ownerUid = requireWorkspaceUid(uid);
  const current = await readState();
  if (current.claimedByUid) return;
  await writeState({ ...current, dismissedUids: [...new Set([...current.dismissedUids, ownerUid])] });
}

export async function isLegacyMigrationInProgress(uid: string): Promise<boolean> {
  const ownerUid = requireWorkspaceUid(uid);
  const state = await readState();
  return state.migrationState === 'in_progress' && state.migrationUid === ownerUid;
}

function copyId(baseId: string, suffix: number): string {
  return `${baseId}__legacy_v${MIGRATION_VERSION}${suffix > 1 ? `_${suffix}` : ''}`;
}

function compact<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

async function valuesEqual(left: unknown, right: unknown): Promise<boolean> {
  if (left === right) return true;
  if (left instanceof Blob || right instanceof Blob) {
    if (!(left instanceof Blob) || !(right instanceof Blob) || left.size !== right.size || left.type !== right.type) return false;
    const [a, b] = await Promise.all([left.arrayBuffer(), right.arrayBuffer()]);
    const x = new Uint8Array(a); const y = new Uint8Array(b);
    return x.length === y.length && x.every((value, index) => value === y[index]);
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) if (!await valuesEqual(left[index], right[index])) return false;
    return true;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const a = Object.keys(left as object).sort(); const b = Object.keys(right as object).sort();
    if (a.length !== b.length || a.some((key, index) => key !== b[index])) return false;
    for (const key of a) {
      if (!await valuesEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key])) return false;
    }
    return true;
  }
  return false;
}

export async function planLegacyMigration(source: LegacyDataset, target: LegacyDataset): Promise<LegacyDataset> {
  const ids = { pins: new Map<string, string>(), notes: new Map<string, string>(), media: new Map<string, string>() };
  const targets = {
    pins: new Map(target.pins.map((item) => [item.id, item])),
    notes: new Map(target.notes.map((item) => [item.id, item])),
    media: new Map(target.media.map((item) => [item.id, item])),
  };
  for (const item of source.pins) ids.pins.set(item.id, item.id);
  for (const item of source.notes) ids.notes.set(item.id, item.id);
  for (const item of source.media) ids.media.set(item.id, item.id);
  const sourceIds = {
    pins: new Set(source.pins.map((item) => item.id)),
    notes: new Set(source.notes.map((item) => item.id)),
    media: new Set(source.media.map((item) => item.id)),
  };
  const generatedIds = {
    pins: new Set<string>(),
    notes: new Set<string>(),
    media: new Set<string>(),
  };

  const transform = (kind: 'pins' | 'notes' | 'media', item: Pin | Note | SurfaceMedia): Pin | Note | SurfaceMedia => {
    const id = ids[kind].get(item.id) ?? item.id;
    if (kind === 'pins') {
      const pin = item as Pin;
      return compact({
        id, name: pin.name, phone: pin.phone, about: pin.about, locationLabel: pin.locationLabel, dateKey: pin.dateKey,
        followUpAt: pin.followUpAt, followUpReason: pin.followUpReason,
        ...(pin.mediaIds ? { mediaIds: pin.mediaIds.map((value) => ids.media.get(value) ?? value) } : {}),
        ...(pin.sourceNoteId ? { sourceNoteId: ids.notes.get(pin.sourceNoteId) ?? pin.sourceNoteId } : {}),
        createdAt: pin.createdAt, updatedAt: pin.updatedAt, revision: pin.revision,
        updatedByDeviceId: pin.updatedByDeviceId, deletedAt: pin.deletedAt,
      });
    }
    if (kind === 'notes') {
      const note = item as Note;
      return compact({
        id, name: note.name, phone: note.phone, body: note.body, locationLabel: note.locationLabel, dateKey: note.dateKey,
        ...(note.imageMediaId ? { imageMediaId: ids.media.get(note.imageMediaId) ?? note.imageMediaId } : {}),
        createdAt: note.createdAt, updatedAt: note.updatedAt, revision: note.revision,
        updatedByDeviceId: note.updatedByDeviceId, deletedAt: note.deletedAt,
      });
    }
    const media = item as SurfaceMedia;
    return compact({
      id, original: media.original, processed: media.processed, createdAt: media.createdAt, dateKey: media.dateKey,
      timeLabel: media.timeLabel, locationLabel: media.locationLabel, location: media.location, capture: media.capture,
      pinIds: (media.pinIds ?? []).map((value) => ids.pins.get(value) ?? value),
    });
  };
  const groups = [
    { kind: 'media' as const, records: source.media },
    { kind: 'notes' as const, records: source.notes },
    { kind: 'pins' as const, records: source.pins },
  ];
  for (let pass = 0; pass <= source.pins.length + source.notes.length + source.media.length; pass += 1) {
    let changed = false;
    for (const group of groups) {
      const idMap = ids[group.kind];
      const targetMap = targets[group.kind];
      for (const original of group.records) {
        const candidate = transform(group.kind, original) as typeof original;
        const existing = targetMap.get(candidate.id);
        if (!existing || await valuesEqual(existing, candidate)) continue;
        let suffix = 1;
        while (true) {
          const nextId = copyId(original.id, suffix++);
          const next = { ...candidate, id: nextId } as typeof original;
          const conflict = targetMap.get(nextId);
          if (conflict) {
            if (await valuesEqual(conflict, next)) {
              if (idMap.get(original.id) !== nextId) { idMap.set(original.id, nextId); changed = true; }
              break;
            }
            continue;
          }
          if (!sourceIds[group.kind].has(nextId) && !generatedIds[group.kind].has(nextId)) {
            if (idMap.get(original.id) !== nextId) { idMap.set(original.id, nextId); changed = true; }
            generatedIds[group.kind].add(nextId);
            break;
          }
        }
      }
    }
    if (!changed) break;
  }
  return {
    pins: source.pins.map((item) => transform('pins', item) as Pin),
    notes: source.notes.map((item) => transform('notes', item) as Note),
    media: source.media.map((item) => transform('media', item) as SurfaceMedia),
  };
}

export async function verifyLegacyMigration(expected: LegacyDataset, actual: LegacyDataset, workspace = actual): Promise<void> {
  if (expected.pins.length !== actual.pins.length || expected.notes.length !== actual.notes.length || expected.media.length !== actual.media.length) throw new Error('Legacy migration count verification failed.');
  const pins = new Map(workspace.pins.map((item) => [item.id, item]));
  const notes = new Map(workspace.notes.map((item) => [item.id, item]));
  const media = new Map(workspace.media.map((item) => [item.id, item]));
  for (const source of expected.pins) {
    const copy = pins.get(source.id);
    if (!copy || !await valuesEqual(copy, source)) throw new Error('Legacy PIN verification failed.');
    if ((source.mediaIds ?? []).some((id) => !media.has(id))) throw new Error('Legacy PIN media relationship verification failed.');
    if (source.sourceNoteId && !notes.has(source.sourceNoteId)) throw new Error('Legacy PIN Note relationship verification failed.');
  }
  for (const source of expected.notes) {
    const copy = notes.get(source.id);
    if (!copy || !await valuesEqual(copy, source)) throw new Error('Legacy Note verification failed.');
    if (source.imageMediaId && !media.has(source.imageMediaId)) throw new Error('Legacy Note media relationship verification failed.');
  }
  for (const source of expected.media) {
    const copy = media.get(source.id);
    if (!copy || !await valuesEqual(copy, source) || copy.original.size !== source.original.size || copy.processed.size !== source.processed.size) throw new Error('Legacy media verification failed.');
    if ((source.pinIds ?? []).some((id) => !pins.has(id))) throw new Error('Legacy media PIN relationship verification failed.');
  }
  const expectedFollowups = expected.pins.filter(hasFollowUp).length;
  const actualFollowups = actual.pins.filter(hasFollowUp).length;
  if (expectedFollowups !== actualFollowups) throw new Error('Legacy follow-up verification failed.');
}

async function requireActiveUid(uid: string): Promise<void> {
  if (getSurfaceFirebase().auth.currentUser?.uid !== uid) throw new Error('Signed-in account changed during legacy recovery.');
}

export async function migrateLegacyData(uid: string): Promise<LegacyCounts> {
  const ownerUid = requireWorkspaceUid(uid);
  const db = await recoveryDatabase();
  await requireActiveUid(ownerUid);
  const lock = db.transaction('state', 'readwrite');
  const state = await lock.store.get('state') ?? { key: 'state' as const, migrationState: 'not_started' as const, dismissedUids: [] };
  if (state.claimedByUid) { await lock.done; throw new Error('Legacy local data has already been claimed.'); }
  if (state.migrationState === 'in_progress' && state.migrationUid !== ownerUid) { await lock.done; throw new Error('Legacy local data recovery is already in progress.'); }
  await lock.store.put({ ...state, key: 'state', migrationState: 'in_progress', migrationUid: ownerUid, migrationVersion: MIGRATION_VERSION });
  await lock.done;
  try {
    await requireActiveUid(ownerUid);
    const source = await readLegacyDataset();
    const before: LegacyDataset = { pins: await listPins(ownerUid), notes: await listNotes(ownerUid), media: await listMediaRaw(ownerUid) };
    const plan = await planLegacyMigration(source, before);
    for (const item of plan.media) {
      await requireActiveUid(ownerUid);
      await insertMediaIfAbsent(ownerUid, item);
    }
    for (const item of plan.notes) {
      await requireActiveUid(ownerUid);
      await insertNoteIfAbsent(ownerUid, item);
    }
    for (const item of plan.pins) {
      await requireActiveUid(ownerUid);
      await insertPinIfAbsent(ownerUid, item);
    }

    await requireActiveUid(ownerUid);
    const actual: LegacyDataset = { pins: await listPins(ownerUid), notes: await listNotes(ownerUid), media: await listMediaRaw(ownerUid) };
    const migrated: LegacyDataset = {
      pins: plan.pins.map((item) => actual.pins.find((candidate) => candidate.id === item.id)!).filter(Boolean),
      notes: plan.notes.map((item) => actual.notes.find((candidate) => candidate.id === item.id)!).filter(Boolean),
      media: plan.media.map((item) => actual.media.find((candidate) => candidate.id === item.id)!).filter(Boolean),
    };
    await verifyLegacyMigration(plan, migrated, actual);
    await requireActiveUid(ownerUid);
    const latest = await readState();
    if (latest.claimedByUid || latest.migrationUid !== ownerUid || latest.migrationState !== 'in_progress') throw new Error('Legacy migration state changed before verification.');
    await requireActiveUid(ownerUid);
    await db.put('state', { ...latest, migrationState: 'verified', migrationVersion: MIGRATION_VERSION, claimedByUid: ownerUid, claimedAt: Date.now(), migrationUid: undefined });
    return legacyCounts(source);
  } catch (error) {
    try {
      const latest = await readState();
      if (!latest.claimedByUid && latest.migrationUid === ownerUid) {
        await db.put('state', { ...latest, migrationState: 'failed', migrationUid: undefined, migrationVersion: MIGRATION_VERSION });
      }
    } catch { /* The source remains unmodified; an interrupted state can be retried by the same UID. */ }
    throw error;
  }
}
