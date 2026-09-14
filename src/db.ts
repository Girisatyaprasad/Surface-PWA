import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { requireWorkspaceUid, verifyWorkspaceOwner, workspaceDatabaseName } from './localWorkspace';

export type Pin = {
  id: string;
  name: string;
  phone: string;
  about: string;
  locationLabel?: string;
  dateKey?: string;
  followUpAt?: number | null;
  followUpReason?: string;
  mediaIds?: string[];
  sourceNoteId?: string;
  createdAt: number;
  updatedAt: number;
  revision?: number;
  updatedByDeviceId?: string;
  deletedAt?: number | null;
};
export type Note = { id: string; name: string; phone: string; body: string; locationLabel?: string; dateKey?: string; imageMediaId?: string; createdAt: number; updatedAt: number; revision?: number; updatedByDeviceId?: string; deletedAt?: number | null };

interface SurfaceDb extends DBSchema {
  workspaceMetadata: { key: string; value: { key: 'ownerUid'; uid: string } };
  pins: { key: string; value: Pin; indexes: { 'by-updated': number } };
  notes: { key: string; value: Note; indexes: { 'by-updated': number } };
  syncOperations: {
    key: string;
    value: { id: string; kind: 'UPSERT_PIN' | 'DELETE_PIN' | 'UPSERT_NOTE' | 'DELETE_NOTE' | 'UPSERT_MEDIA' | 'DELETE_MEDIA'; pinId: string; payload?: unknown; attempts: number; nextAttemptAt: number; lastError?: string };
    indexes: { 'by-next-attempt': number };
  };
  analyticsActivity: { key: string; value: { day: string; activityCount: number; peopleAdded: number; notesCreated: number; capturesCreated: number } };
  analyticsOutbox: { key: string; value: { ownerUid: string; attempts: number; nextAttemptAt: number }; indexes: { 'by-next-attempt': number } };
  iisOutbox: { key: string; value: { ownerUid: string; insightId: string; envelope: unknown; attempts: number; nextAttemptAt: number; stateKey: string }; indexes: { 'by-next-attempt': number } };
  iisStates: { key: string; value: { ownerUid: string; stateKey: string; fingerprint: string; submittedAt: number } };
}

const databases = new Map<string, Promise<IDBPDatabase<SurfaceDb>>>();

async function databaseFor(uid: string): Promise<IDBPDatabase<SurfaceDb>> {
  const ownerUid = requireWorkspaceUid(uid);
  let pending = databases.get(ownerUid);
  if (!pending) {
    pending = openDB<SurfaceDb>(workspaceDatabaseName('records', ownerUid), 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('workspaceMetadata')) db.createObjectStore('workspaceMetadata', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('pins')) { const pins = db.createObjectStore('pins', { keyPath: 'id' }); pins.createIndex('by-updated', 'updatedAt'); }
        if (!db.objectStoreNames.contains('notes')) { const notes = db.createObjectStore('notes', { keyPath: 'id' }); notes.createIndex('by-updated', 'updatedAt'); }
        if (!db.objectStoreNames.contains('syncOperations')) { const operations = db.createObjectStore('syncOperations', { keyPath: 'id' }); operations.createIndex('by-next-attempt', 'nextAttemptAt'); }
        if (!db.objectStoreNames.contains('analyticsActivity')) db.createObjectStore('analyticsActivity', { keyPath: 'day' });
        if (!db.objectStoreNames.contains('analyticsOutbox')) { const outbox = db.createObjectStore('analyticsOutbox', { keyPath: 'ownerUid' }); outbox.createIndex('by-next-attempt', 'nextAttemptAt'); }
        if (!db.objectStoreNames.contains('iisOutbox')) { const outbox = db.createObjectStore('iisOutbox', { keyPath: 'insightId' }); outbox.createIndex('by-next-attempt', 'nextAttemptAt'); }
        if (!db.objectStoreNames.contains('iisStates')) db.createObjectStore('iisStates', { keyPath: 'stateKey' });
      },
    }).then(async (db) => {
      const metadata = await db.get('workspaceMetadata', 'ownerUid');
      const containsData = (await Promise.all(
        (['pins', 'notes', 'syncOperations', 'analyticsActivity', 'analyticsOutbox', 'iisOutbox', 'iisStates'] as const).map((store) => db.count(store)),
      )).some((count) => count > 0);
      verifyWorkspaceOwner(ownerUid, metadata?.uid, containsData);
      if (!metadata) await db.put('workspaceMetadata', { key: 'ownerUid', uid: ownerUid });
      return db;
    });
    databases.set(ownerUid, pending);
    pending.catch(() => databases.delete(ownerUid));
  }
  return pending;
}

export type LocalAnalyticsActivity = SurfaceDb['analyticsActivity']['value'];
export type PendingAnalyticsSnapshot = SurfaceDb['analyticsOutbox']['value'];
export type SyncOperation = SurfaceDb['syncOperations']['value'];

export class MediaSyncQueueFullError extends Error {
  constructor() { super('Cloud media queue is full; the local copy is safe.'); this.name = 'MediaSyncQueueFullError'; }
}
export type PendingIisInsight = SurfaceDb['iisOutbox']['value'];
const MAX_PENDING_IIS_INSIGHTS = 100;

export async function queueIisInsight(uid: string, insightId: string, stateKey: string, envelope: unknown, now = Date.now()): Promise<void> {
  const ownerUid = requireWorkspaceUid(uid);
  const db = await databaseFor(ownerUid);
  const tx = db.transaction('iisOutbox', 'readwrite');
  const queued = await tx.store.getAll();
  const existing = queued.find((item) => item.insightId === insightId && item.ownerUid === ownerUid);
  for (const item of queued) if (item.ownerUid === ownerUid && item.stateKey === stateKey && item.insightId !== insightId) await tx.store.delete(item.insightId);
  await tx.store.put({ ownerUid, insightId, stateKey, envelope, attempts: existing?.attempts ?? 0, nextAttemptAt: now });
  const newest = (await tx.store.getAll())
    .filter((item) => item.ownerUid === ownerUid)
    .sort((a, b) => envelopeTime(b.envelope) - envelopeTime(a.envelope));
  for (const item of newest.slice(MAX_PENDING_IIS_INSIGHTS)) await tx.store.delete(item.insightId);
  await tx.done;
}
export async function wasIisStateSubmitted(uid: string, stateKey: string, fingerprint: string): Promise<boolean> {
  const ownerUid = requireWorkspaceUid(uid);
  const state = await (await databaseFor(ownerUid)).get('iisStates', stateKey);
  return state?.ownerUid === ownerUid && state.fingerprint === fingerprint;
}
export async function markIisStateSubmitted(uid: string, stateKey: string, fingerprint: string, now = Date.now()): Promise<void> {
  const ownerUid = requireWorkspaceUid(uid);
  const db = await databaseFor(ownerUid);
  const tx = db.transaction('iisStates', 'readwrite');
  await tx.store.put({ ownerUid, stateKey, fingerprint, submittedAt: now });
  const items = (await tx.store.getAll()).filter((item) => item.ownerUid === ownerUid).sort((a, b) => b.submittedAt - a.submittedAt);
  for (const item of items.slice(500)) await tx.store.delete(item.stateKey);
  await tx.done;
}
export async function pendingIisStateKeys(uid: string): Promise<string[]> {
  const ownerUid = requireWorkspaceUid(uid);
  return (await (await databaseFor(ownerUid)).getAll('iisOutbox')).map((item) => item.stateKey);
}
export async function dueIisInsights(uid: string, now = Date.now()): Promise<PendingIisInsight[]> {
  const ownerUid = requireWorkspaceUid(uid);
  return (await (await databaseFor(ownerUid)).getAllFromIndex('iisOutbox', 'by-next-attempt', IDBKeyRange.upperBound(now))).filter((item) => item.ownerUid === ownerUid);
}
export async function removeIisInsight(uid: string, insightId: string): Promise<void> {
  const ownerUid = requireWorkspaceUid(uid);
  const db = await databaseFor(ownerUid);
  const current = await db.get('iisOutbox', insightId);
  if (current?.ownerUid === ownerUid) await db.delete('iisOutbox', insightId);
}
export async function retryIisInsight(uid: string, item: PendingIisInsight, now = Date.now()): Promise<void> {
  const ownerUid = requireWorkspaceUid(uid);
  if (item.ownerUid !== ownerUid) throw new Error('IIS queue ownership mismatch.');
  const attempts = item.attempts + 1;
  await (await databaseFor(ownerUid)).put('iisOutbox', { ...item, attempts, nextAttemptAt: now + Math.min(3_600_000, 5_000 * 2 ** Math.min(attempts, 9)) });
}
export async function clearIisOutbox(uid: string): Promise<void> {
  const ownerUid = requireWorkspaceUid(uid);
  const db = await databaseFor(ownerUid);
  const tx = db.transaction('iisOutbox', 'readwrite');
  for (const item of await tx.store.getAll()) if (item.ownerUid === ownerUid) await tx.store.delete(item.insightId);
  await tx.done;
}

function envelopeTime(value: unknown): number {
  if (value && typeof value === 'object' && 'generatedAt' in value && typeof value.generatedAt === 'number' && Number.isFinite(value.generatedAt)) return value.generatedAt;
  return 0;
}

export async function recordLocalAnalyticsActivity(uid: string, kind: 'pin_created' | 'pin_updated' | 'followup_activity' | 'note_created' | 'capture_created', at = Date.now()): Promise<void> {
  const day = new Date(at).toISOString().slice(0, 10);
  const database = await databaseFor(uid);
  const tx = database.transaction('analyticsActivity', 'readwrite');
  const current = await tx.store.get(day) ?? { day, activityCount: 0, peopleAdded: 0, notesCreated: 0, capturesCreated: 0 };
  current.activityCount += 1;
  if (kind === 'pin_created') current.peopleAdded += 1;
  if (kind === 'note_created') current.notesCreated += 1;
  if (kind === 'capture_created') current.capturesCreated += 1;
  await tx.store.put(current);
  const oldest = new Date(at - 400 * 86_400_000).toISOString().slice(0, 10);
  for (const item of await tx.store.getAll()) if (item.day < oldest) await tx.store.delete(item.day);
  await tx.done;
}

export async function listLocalAnalyticsActivity(uid: string, startDay: string, endDay: string): Promise<LocalAnalyticsActivity[]> {
  return (await (await databaseFor(uid)).getAll('analyticsActivity')).filter((item) => item.day >= startDay && item.day <= endDay);
}
export async function queueAnalyticsSnapshot(uid: string, now = Date.now()): Promise<void> {
  const ownerUid = requireWorkspaceUid(uid);
  await (await databaseFor(ownerUid)).put('analyticsOutbox', { ownerUid, attempts: 0, nextAttemptAt: now });
}
export async function dueAnalyticsSnapshots(uid: string, now = Date.now()): Promise<PendingAnalyticsSnapshot[]> {
  const ownerUid = requireWorkspaceUid(uid);
  return (await databaseFor(ownerUid)).getAllFromIndex('analyticsOutbox', 'by-next-attempt', IDBKeyRange.upperBound(now));
}
export async function removeAnalyticsSnapshot(uid: string): Promise<void> {
  const ownerUid = requireWorkspaceUid(uid);
  await (await databaseFor(ownerUid)).delete('analyticsOutbox', ownerUid);
}
export async function retryAnalyticsSnapshot(uid: string, item: PendingAnalyticsSnapshot, now = Date.now()): Promise<void> {
  if (item.ownerUid !== requireWorkspaceUid(uid)) throw new Error('Analytics queue ownership mismatch.');
  const attempts = item.attempts + 1;
  await (await databaseFor(uid)).put('analyticsOutbox', { ...item, attempts, nextAttemptAt: now + Math.min(3_600_000, 5_000 * 2 ** Math.min(attempts, 9)) });
}

export async function listPins(uid: string): Promise<Pin[]> { return (await databaseFor(uid)).getAllFromIndex('pins', 'by-updated').then((pins) => pins.reverse()); }
export async function listNotes(uid: string): Promise<Note[]> { return (await databaseFor(uid)).getAllFromIndex('notes', 'by-updated').then((notes) => notes.reverse()); }
export async function createNote(uid: string, name: string, phone: string, body: string, locationLabel = ''): Promise<Note> {
  const now = Date.now();
  const note: Note = { id: crypto.randomUUID(), name: name.trim(), phone: phone.trim(), body: body.trim(), locationLabel: locationLabel.trim(), dateKey: new Date(now).toLocaleDateString('en-GB'), createdAt: now, updatedAt: now };
  await (await databaseFor(uid)).put('notes', note);
  return note;
}
export async function putNote(uid: string, note: Note): Promise<void> { await (await databaseFor(uid)).put('notes', note); }
export async function insertNoteIfAbsent(uid: string, note: Note): Promise<boolean> {
  const tx = (await databaseFor(uid)).transaction('notes', 'readwrite');
  if (await tx.store.get(note.id)) { await tx.done; return false; }
  await tx.store.add(note);
  await tx.done;
  return true;
}
export async function deleteLocalNote(uid: string, id: string): Promise<void> { await (await databaseFor(uid)).delete('notes', id); }
export async function createPin(uid: string, name: string, about: string, phone = '', locationLabel = ''): Promise<Pin> {
  const now = Date.now();
  const pin: Pin = { id: crypto.randomUUID(), name: name.trim(), phone: phone.trim(), about: about.trim(), locationLabel: locationLabel.trim(), dateKey: new Date(now).toLocaleDateString('en-GB'), followUpAt: null, followUpReason: '', mediaIds: [], createdAt: now, updatedAt: now };
  await (await databaseFor(uid)).put('pins', pin);
  return pin;
}
export async function putPin(uid: string, pin: Pin): Promise<void> { await (await databaseFor(uid)).put('pins', pin); }
export async function insertPinIfAbsent(uid: string, pin: Pin): Promise<boolean> {
  const tx = (await databaseFor(uid)).transaction('pins', 'readwrite');
  if (await tx.store.get(pin.id)) { await tx.done; return false; }
  await tx.store.add(pin);
  await tx.done;
  return true;
}
export async function queuePinOperation(uid: string, operation: Omit<SyncOperation, 'attempts' | 'nextAttemptAt'>): Promise<void> {
  await (await databaseFor(uid)).put('syncOperations', { ...operation, attempts: 0, nextAttemptAt: Date.now() });
}
export async function queueMediaOperation(uid: string, operation: Omit<SyncOperation, 'attempts' | 'nextAttemptAt'>, maxPending = 250, maxBytes = 250 * 1024 * 1024): Promise<void> {
  const db = await databaseFor(uid);
  const tx = db.transaction('syncOperations', 'readwrite');
  const existing = await tx.store.get(operation.id);
  const pending = await tx.store.getAll();
  const mediaPending = pending.filter((item) => (item.kind === 'UPSERT_MEDIA' || item.kind === 'DELETE_MEDIA') && item.id !== operation.id);
  const pendingBytes = mediaPending.reduce((total, item) => {
    const payload = item.payload as { original?: Blob; processed?: Blob } | undefined;
    return total + (payload?.original?.size ?? 0) + (payload?.processed?.size ?? 0);
  }, 0);
  const payload = operation.payload as { original?: Blob; processed?: Blob } | undefined;
  const addedBytes = (payload?.original?.size ?? 0) + (payload?.processed?.size ?? 0);
  const currentMediaCount = mediaPending.length + (existing && (existing.kind === 'UPSERT_MEDIA' || existing.kind === 'DELETE_MEDIA') ? 1 : 0);
  if ((!existing && currentMediaCount >= maxPending) || pendingBytes + addedBytes > maxBytes) {
    await tx.done;
    throw new MediaSyncQueueFullError();
  }
  await tx.store.put({ ...operation, attempts: existing?.attempts ?? 0, nextAttemptAt: Date.now() });
  await tx.done;
}
export async function listSyncOperations(uid: string): Promise<SyncOperation[]> { return (await databaseFor(uid)).getAll('syncOperations'); }
export async function dueSyncOperations(uid: string, now = Date.now(), limit = 50): Promise<SyncOperation[]> {
  return (await databaseFor(uid)).getAllFromIndex('syncOperations', 'by-next-attempt', IDBKeyRange.upperBound(now), limit);
}
export async function getSyncOperation(uid: string, id: string): Promise<SyncOperation | undefined> { return (await databaseFor(uid)).get('syncOperations', id); }
export async function pendingPinOperations(uid: string): Promise<SyncOperation[]> {
  return (await databaseFor(uid)).getAllFromIndex('syncOperations', 'by-next-attempt', IDBKeyRange.upperBound(Date.now()));
}
export async function removePinOperation(uid: string, id: string): Promise<void> { await (await databaseFor(uid)).delete('syncOperations', id); }
export async function pendingPinOperationCount(uid: string): Promise<number> { return (await databaseFor(uid)).count('syncOperations'); }
export async function deleteLocalPin(uid: string, id: string): Promise<void> { await (await databaseFor(uid)).delete('pins', id); }
export async function makePendingOperationsRetryable(uid: string): Promise<void> {
  const db = await databaseFor(uid);
  const operations = await db.getAll('syncOperations');
  const tx = db.transaction('syncOperations', 'readwrite');
  await Promise.all(operations.map((operation) => tx.store.put({ ...operation, nextAttemptAt: Date.now(), lastError: 'Manual retry requested' })));
  await tx.done;
}
export async function retryPinOperation(uid: string, operation: SyncOperation, error: string): Promise<void> {
  const attempts = operation.attempts + 1;
  await (await databaseFor(uid)).put('syncOperations', { ...operation, attempts, lastError: error, nextAttemptAt: Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6)) });
}

export async function closeLocalRecordsWorkspace(uid: string): Promise<void> {
  const ownerUid = requireWorkspaceUid(uid);
  const pending = databases.get(ownerUid);
  if (!pending) return;
  databases.delete(ownerUid);
  (await pending).close();
}
export async function deleteLocalRecordsWorkspace(uid: string): Promise<void> {
  const ownerUid = requireWorkspaceUid(uid);
  await closeLocalRecordsWorkspace(ownerUid);
  await deleteDB(workspaceDatabaseName('records', ownerUid));
}
