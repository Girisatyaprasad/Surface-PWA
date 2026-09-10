import { openDB, type DBSchema } from 'idb';

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
  /** The existing note used as the source when this PIN was created. */
  sourceNoteId?: string;
  createdAt: number;
  updatedAt: number;
  revision?: number;
  updatedByDeviceId?: string;
  deletedAt?: number | null;
};
export type Note = { id: string; name: string; phone: string; body: string; locationLabel?: string; dateKey?: string; imageMediaId?: string; createdAt: number; updatedAt: number; revision?: number; updatedByDeviceId?: string; deletedAt?: number | null };

interface SurfaceDb extends DBSchema {
  pins: {
    key: string;
    value: Pin;
    indexes: { 'by-updated': number };
  };
  notes: {
    key: string;
    value: Note;
    indexes: { 'by-updated': number };
  };
  syncOperations: {
    key: string;
    value: { id: string; kind: 'UPSERT_PIN' | 'DELETE_PIN' | 'UPSERT_NOTE' | 'DELETE_NOTE' | 'UPSERT_MEDIA' | 'DELETE_MEDIA'; pinId: string; payload?: unknown; attempts: number; nextAttemptAt: number; lastError?: string };
    indexes: { 'by-next-attempt': number };
  };
}

const dbPromise = openDB<SurfaceDb>('surface-pwa', 3, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('pins')) {
      const pins = db.createObjectStore('pins', { keyPath: 'id' });
      pins.createIndex('by-updated', 'updatedAt');
    }
    if (!db.objectStoreNames.contains('notes')) {
      const notes = db.createObjectStore('notes', { keyPath: 'id' });
      notes.createIndex('by-updated', 'updatedAt');
    }
    if (!db.objectStoreNames.contains('syncOperations')) {
      const operations = db.createObjectStore('syncOperations', { keyPath: 'id' });
      operations.createIndex('by-next-attempt', 'nextAttemptAt');
    }
  },
});

export async function listPins(): Promise<Pin[]> {
  return (await dbPromise).getAllFromIndex('pins', 'by-updated').then((pins) => pins.reverse());
}

export async function listNotes(): Promise<Note[]> {
  return (await dbPromise).getAllFromIndex('notes', 'by-updated').then((notes) => notes.reverse());
}

export async function createNote(name: string, phone: string, body: string, locationLabel = ''): Promise<Note> {
  const now = Date.now();
  const note: Note = { id: crypto.randomUUID(), name: name.trim(), phone: phone.trim(), body: body.trim(), locationLabel: locationLabel.trim(), dateKey: new Date(now).toLocaleDateString('en-GB'), createdAt: now, updatedAt: now };
  await (await dbPromise).put('notes', note);
  return note;
}

export async function putNote(note: Note): Promise<void> { await (await dbPromise).put('notes', note); }
export async function deleteLocalNote(id: string): Promise<void> { await (await dbPromise).delete('notes', id); }

export async function createPin(name: string, about: string, phone = '', locationLabel = ''): Promise<Pin> {
  const now = Date.now();
  const pin: Pin = { id: crypto.randomUUID(), name: name.trim(), phone: phone.trim(), about: about.trim(), locationLabel: locationLabel.trim(), dateKey: new Date(now).toLocaleDateString('en-GB'), followUpAt: null, followUpReason: '', mediaIds: [], createdAt: now, updatedAt: now };
  await (await dbPromise).put('pins', pin);
  return pin;
}

export async function putPin(pin: Pin): Promise<void> {
  await (await dbPromise).put('pins', pin);
}

export async function queuePinOperation(operation: Omit<SurfaceDb['syncOperations']['value'], 'attempts' | 'nextAttemptAt'>): Promise<void> {
  await (await dbPromise).put('syncOperations', { ...operation, attempts: 0, nextAttemptAt: Date.now() });
}
export async function listSyncOperations(): Promise<SurfaceDb['syncOperations']['value'][]> { return (await dbPromise).getAll('syncOperations'); }

export async function pendingPinOperations(): Promise<SurfaceDb['syncOperations']['value'][]> {
  return (await dbPromise).getAllFromIndex('syncOperations', 'by-next-attempt', IDBKeyRange.upperBound(Date.now()));
}

export async function removePinOperation(id: string): Promise<void> {
  await (await dbPromise).delete('syncOperations', id);
}

export async function pendingPinOperationCount(): Promise<number> {
  return (await dbPromise).count('syncOperations');
}

export async function deleteLocalPin(id: string): Promise<void> {
  await (await dbPromise).delete('pins', id);
}

export async function makePendingOperationsRetryable(): Promise<void> {
  const db = await dbPromise;
  const operations = await db.getAll('syncOperations');
  const tx = db.transaction('syncOperations', 'readwrite');
  await Promise.all(operations.map((operation) => tx.store.put({ ...operation, nextAttemptAt: Date.now(), lastError: 'Manual retry requested' })));
  await tx.done;
}

export async function retryPinOperation(operation: SurfaceDb['syncOperations']['value'], error: string): Promise<void> {
  const attempts = operation.attempts + 1;
  await (await dbPromise).put('syncOperations', { ...operation, attempts, lastError: error, nextAttemptAt: Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6)) });
}
