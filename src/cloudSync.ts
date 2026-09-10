import { collection, doc, getDocs, runTransaction, setDoc, type Firestore } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getBlob } from 'firebase/storage';
import { getSurfaceFirebase } from './firebase';
import { listNotes, listSyncOperations, putNote, queuePinOperation, removePinOperation, retryPinOperation, type Note } from './db';
import { listMedia, putMedia, type SurfaceMedia } from './media';
import type { SurfaceEntitlement } from './entitlement';

const deviceId = localStorage.getItem('surface-pwa-device-id') ?? crypto.randomUUID();
localStorage.setItem('surface-pwa-device-id', deviceId);

function eligible(tier: SurfaceEntitlement['tier']) { return tier !== 'FREE'; }
function maxOnly(tier: SurfaceEntitlement['tier']) { return tier === 'MAX'; }

export async function queueNote(note: Note, entitlement: SurfaceEntitlement): Promise<void> {
  if (!eligible(entitlement.tier)) return;
  await queuePinOperation({ id: `note:${note.id}`, kind: 'UPSERT_NOTE', pinId: note.id, payload: note });
}

export async function queueNoteDelete(id: string, entitlement: SurfaceEntitlement): Promise<void> {
  if (!eligible(entitlement.tier)) return;
  await queuePinOperation({ id: `note:${id}`, kind: 'DELETE_NOTE', pinId: id, payload: { id, deletedAt: Date.now(), updatedByDeviceId: deviceId } });
}

export async function queueMediaUpload(media: SurfaceMedia, entitlement: SurfaceEntitlement): Promise<void> {
  if (!maxOnly(entitlement.tier)) return;
  await queuePinOperation({ id: `media:${media.id}`, kind: 'UPSERT_MEDIA', pinId: media.id, payload: media });
}

export async function flushCloudSync(entitlement: SurfaceEntitlement): Promise<string> {
  if (!eligible(entitlement.tier)) return 'Local only - cloud sync not eligible';
  const { auth, firestore } = getSurfaceFirebase();
  const uid = auth.currentUser?.uid;
  if (!uid) return 'Sign in to sync Surface data.';
  for (const operation of await listSyncOperations()) {
    if (operation.kind === 'UPSERT_PIN' || operation.kind === 'DELETE_PIN') continue;
    try {
      if (operation.kind === 'UPSERT_NOTE' || operation.kind === 'DELETE_NOTE') {
        await writeRecord(firestore, doc(firestore, 'users', uid, 'notes', operation.pinId), operation.payload ?? {}, uid);
      } else if (operation.kind === 'UPSERT_MEDIA' || operation.kind === 'DELETE_MEDIA') {
        if (operation.kind === 'DELETE_MEDIA') {
          await setDoc(doc(firestore, 'users', uid, 'media', operation.pinId), { uid, mediaId: operation.pinId, deletedAt: Date.now(), updatedByDeviceId: deviceId }, { merge: true });
        } else {
          const media = operation.payload as SurfaceMedia;
          await uploadMediaNow(media, uid, firestore);
        }
      }
      await removePinOperation(operation.id);
    } catch (error) {
      await retryPinOperation(operation, error instanceof Error ? error.message : 'Sync failed');
    }
  }
  return (await listSyncOperations()).length ? 'Changes pending.' : '';
}

async function writeRecord(firestore: Firestore, target: ReturnType<typeof doc>, payload: unknown, uid: string) {
  await runTransaction(firestore, async (transaction) => {
    const current = await transaction.get(target);
    const currentRevision = Number(current.data()?.revision) || 0;
    const value = payload as Record<string, unknown>;
    transaction.set(target, { ...value, uid, revision: Math.max(currentRevision + 1, Number(value.updatedAt) || Date.now()), updatedByDeviceId: deviceId, schemaVersion: 1 }, { merge: true });
  });
}

export async function hydrateNotes(entitlement: SurfaceEntitlement): Promise<Note[]> {
  const local = await listNotes();
  if (!eligible(entitlement.tier)) return local;
  const { auth, firestore } = getSurfaceFirebase();
  const uid = auth.currentUser?.uid;
  if (!uid) return local;
  const snapshot = await getDocs(collection(firestore, 'users', uid, 'notes'));
  for (const item of snapshot.docs) {
    const value = item.data();
    if (value.uid !== uid || value.deletedAt) continue;
    await putNote({ id: item.id, name: String(value.name ?? ''), phone: String(value.phone ?? ''), body: String(value.body ?? ''), locationLabel: String(value.locationLabel ?? ''), dateKey: typeof value.dateKey === 'string' ? value.dateKey : undefined, createdAt: Number(value.createdAt) || Date.now(), updatedAt: Number(value.updatedAt) || Date.now(), revision: Number(value.revision) || undefined, updatedByDeviceId: String(value.updatedByDeviceId ?? '') });
  }
  return listNotes();
}

export async function uploadMedia(media: SurfaceMedia, entitlement: SurfaceEntitlement): Promise<void> {
  if (!maxOnly(entitlement.tier)) return;
  const { auth, firestore } = getSurfaceFirebase();
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await queueMediaUpload(media, entitlement);
  await flushCloudSync(entitlement);
}

async function uploadMediaNow(media: SurfaceMedia, uid: string, firestore: Firestore): Promise<void> {
  const storage = getStorage();
  const originalPath = `users/${uid}/media/${media.id}/original`;
  const processedPath = `users/${uid}/media/${media.id}/processed`;
  await uploadBytes(ref(storage, originalPath), media.original, { contentType: media.original.type });
  await uploadBytes(ref(storage, processedPath), media.processed, { contentType: media.processed.type });
  await setDoc(doc(firestore, 'users', uid, 'media', media.id), { uid, mediaId: media.id, type: media.capture ? 'capture' : 'gallery', originalPath, processedPath, mimeType: media.processed.type, size: media.processed.size, createdAt: media.createdAt, updatedAt: media.createdAt, dateKey: media.dateKey, timeLabel: media.timeLabel, locationLabel: media.locationLabel ?? '', capture: media.capture, pinIds: media.pinIds ?? [], revision: media.createdAt, updatedByDeviceId: deviceId }, { merge: true });
}

export async function hydrateMediaMetadata(entitlement: SurfaceEntitlement): Promise<void> {
  if (!maxOnly(entitlement.tier)) return;
  const { auth, firestore } = getSurfaceFirebase();
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const local = await listMedia();
  const snapshot = await getDocs(collection(firestore, 'users', uid, 'media'));
  for (const item of snapshot.docs) {
    const value = item.data();
    if (value.uid !== uid || value.deletedAt || local.some((entry) => entry.id === item.id)) continue;
    await putMedia({ id: item.id, original: new Blob(), processed: new Blob(), createdAt: Number(value.createdAt) || Date.now(), dateKey: String(value.dateKey ?? ''), timeLabel: String(value.timeLabel ?? ''), locationLabel: String(value.locationLabel ?? ''), capture: value.type === 'capture', pinIds: Array.isArray(value.pinIds) ? value.pinIds.filter((id): id is string => typeof id === 'string') : [], originalPath: String(value.originalPath ?? ''), processedPath: String(value.processedPath ?? ''), remoteOnly: true });
  }
}

export async function hydrateMediaBlob(media: SurfaceMedia): Promise<SurfaceMedia> {
  if (!media.remoteOnly || !media.processedPath) return media;
  const blob = await getBlob(ref(getStorage(), media.processedPath));
  const updated = { ...media, original: blob, processed: blob, remoteOnly: false };
  await putMedia(updated);
  return updated;
}
