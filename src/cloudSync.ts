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

export async function queueNote(note: Note, entitlement: SurfaceEntitlement, uid: string): Promise<void> {
  if (!eligible(entitlement.tier)) return;
  await queuePinOperation(uid, { id: `note:${note.id}`, kind: 'UPSERT_NOTE', pinId: note.id, payload: note });
}

export async function queueNoteDelete(id: string, entitlement: SurfaceEntitlement, uid: string): Promise<void> {
  if (!eligible(entitlement.tier)) return;
  await queuePinOperation(uid, { id: `note:${id}`, kind: 'DELETE_NOTE', pinId: id, payload: { id, deletedAt: Date.now(), updatedByDeviceId: deviceId } });
}

export async function queueMediaUpload(media: SurfaceMedia, entitlement: SurfaceEntitlement, uid: string): Promise<void> {
  if (!maxOnly(entitlement.tier)) return;
  await queuePinOperation(uid, { id: `media:${media.id}`, kind: 'UPSERT_MEDIA', pinId: media.id, payload: media });
}

export async function flushCloudSync(entitlement: SurfaceEntitlement, uid: string): Promise<string> {
  if (!eligible(entitlement.tier)) return 'Local only - cloud sync not eligible';
  const { auth, firestore } = getSurfaceFirebase();
  const ownerUid = uid;
  if (!ownerUid || auth.currentUser?.uid !== ownerUid) return 'Sign in to sync Surface data.';
  for (const operation of await listSyncOperations(ownerUid)) {
    if (auth.currentUser?.uid !== ownerUid) return 'Sync paused after account change.';
    if (operation.kind === 'UPSERT_PIN' || operation.kind === 'DELETE_PIN') continue;
    try {
      if (operation.kind === 'UPSERT_NOTE' || operation.kind === 'DELETE_NOTE') {
        await writeRecord(firestore, doc(firestore, 'users', ownerUid, 'notes', operation.pinId), operation.payload ?? {}, ownerUid);
      } else if (operation.kind === 'UPSERT_MEDIA' || operation.kind === 'DELETE_MEDIA') {
        if (operation.kind === 'DELETE_MEDIA') {
          await setDoc(doc(firestore, 'users', ownerUid, 'media', operation.pinId), { uid: ownerUid, mediaId: operation.pinId, deletedAt: Date.now(), updatedByDeviceId: deviceId }, { merge: true });
        } else {
          const media = operation.payload as SurfaceMedia;
          await uploadMediaNow(media, ownerUid, firestore);
        }
      }
      if (auth.currentUser?.uid !== ownerUid) return 'Sync paused after account change.';
      await removePinOperation(ownerUid, operation.id);
    } catch (error) {
      await retryPinOperation(ownerUid, operation, error instanceof Error ? error.message : 'Sync failed');
    }
  }
  return (await listSyncOperations(ownerUid)).length ? 'Changes pending.' : '';
}

async function writeRecord(firestore: Firestore, target: ReturnType<typeof doc>, payload: unknown, uid: string) {
  await runTransaction(firestore, async (transaction) => {
    const current = await transaction.get(target);
    const currentRevision = Number(current.data()?.revision) || 0;
    const value = payload as Record<string, unknown>;
    transaction.set(target, { ...value, uid, revision: Math.max(currentRevision + 1, Number(value.updatedAt) || Date.now()), updatedByDeviceId: deviceId, schemaVersion: 1 }, { merge: true });
  });
}

export async function hydrateNotes(entitlement: SurfaceEntitlement, uid: string): Promise<Note[]> {
  const { auth, firestore } = getSurfaceFirebase();
  const ownerUid = uid;
  if (!ownerUid || auth.currentUser?.uid !== ownerUid) return [];
  const local = await listNotes(ownerUid);
  if (auth.currentUser?.uid !== ownerUid) return [];
  if (!eligible(entitlement.tier)) return local;
  const snapshot = await getDocs(collection(firestore, 'users', ownerUid, 'notes'));
  if (auth.currentUser?.uid !== ownerUid) return [];
  for (const item of snapshot.docs) {
    const value = item.data();
    if (value.uid !== ownerUid || value.deletedAt) continue;
    await putNote(ownerUid, { id: item.id, name: String(value.name ?? ''), phone: String(value.phone ?? ''), body: String(value.body ?? ''), locationLabel: String(value.locationLabel ?? ''), dateKey: typeof value.dateKey === 'string' ? value.dateKey : undefined, createdAt: Number(value.createdAt) || Date.now(), updatedAt: Number(value.updatedAt) || Date.now(), revision: Number(value.revision) || undefined, updatedByDeviceId: String(value.updatedByDeviceId ?? '') });
  }
  return auth.currentUser?.uid === ownerUid ? listNotes(ownerUid) : [];
}

export async function uploadMedia(media: SurfaceMedia, entitlement: SurfaceEntitlement, uid: string): Promise<void> {
  if (!maxOnly(entitlement.tier)) return;
  const { auth, firestore } = getSurfaceFirebase();
  if (!uid || auth.currentUser?.uid !== uid) return;
  await queueMediaUpload(media, entitlement, uid);
  await flushCloudSync(entitlement, uid);
}

async function uploadMediaNow(media: SurfaceMedia, uid: string, firestore: Firestore): Promise<void> {
  const storage = getStorage();
  const originalPath = `users/${uid}/media/${media.id}/original`;
  const processedPath = `users/${uid}/media/${media.id}/processed`;
  await uploadBytes(ref(storage, originalPath), media.original, { contentType: media.original.type });
  await uploadBytes(ref(storage, processedPath), media.processed, { contentType: media.processed.type });
  await setDoc(doc(firestore, 'users', uid, 'media', media.id), { uid, mediaId: media.id, type: media.capture ? 'capture' : 'gallery', originalPath, processedPath, mimeType: media.processed.type, size: media.processed.size, createdAt: media.createdAt, updatedAt: media.createdAt, dateKey: media.dateKey, timeLabel: media.timeLabel, locationLabel: media.locationLabel ?? '', capture: media.capture, pinIds: media.pinIds ?? [], revision: media.createdAt, updatedByDeviceId: deviceId }, { merge: true });
}

export async function hydrateMediaMetadata(entitlement: SurfaceEntitlement, uid: string): Promise<void> {
  if (!maxOnly(entitlement.tier)) return;
  const { auth, firestore } = getSurfaceFirebase();
  if (!uid || auth.currentUser?.uid !== uid) return;
  const local = await listMedia(uid);
  const snapshot = await getDocs(collection(firestore, 'users', uid, 'media'));
  if (auth.currentUser?.uid !== uid) return;
  for (const item of snapshot.docs) {
    const value = item.data();
    if (value.uid !== uid || value.deletedAt || local.some((entry) => entry.id === item.id)) continue;
    await putMedia(uid, { id: item.id, original: new Blob(), processed: new Blob(), createdAt: Number(value.createdAt) || Date.now(), dateKey: String(value.dateKey ?? ''), timeLabel: String(value.timeLabel ?? ''), locationLabel: String(value.locationLabel ?? ''), capture: value.type === 'capture', pinIds: Array.isArray(value.pinIds) ? value.pinIds.filter((id): id is string => typeof id === 'string') : [], originalPath: String(value.originalPath ?? ''), processedPath: String(value.processedPath ?? ''), remoteOnly: true });
  }
}

export async function hydrateMediaBlob(uid: string, media: SurfaceMedia): Promise<SurfaceMedia> {
  if (!media.remoteOnly || !media.processedPath) return media;
  const blob = await getBlob(ref(getStorage(), media.processedPath));
  const updated = { ...media, original: blob, processed: blob, remoteOnly: false };
  await putMedia(uid, updated);
  return updated;
}
