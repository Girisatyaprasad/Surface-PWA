import { collection, deleteDoc, doc, getDocs, runTransaction, setDoc, type Firestore } from 'firebase/firestore';
import { deleteObject, getStorage, ref, uploadBytes, getBlob } from 'firebase/storage';
import { getSurfaceFirebase } from './firebase';
import { dueSyncOperations, getSyncOperation, listNotes, listSyncOperations, putNote, queueMediaOperation, queuePinOperation, removePinOperation, retryPinOperation, type Note } from './db';
import { isMediaDeleted, listMedia, putMedia, type SurfaceMedia } from './media';
import type { SurfaceEntitlement } from './entitlement';

let cachedDeviceId: string | null = null;
function deviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  cachedDeviceId = localStorage.getItem('surface-pwa-device-id') ?? crypto.randomUUID();
  localStorage.setItem('surface-pwa-device-id', cachedDeviceId);
  return cachedDeviceId;
}

function eligible(tier: SurfaceEntitlement['tier']) { return tier !== 'FREE'; }
function maxOnly(tier: SurfaceEntitlement['tier']) { return tier === 'MAX'; }
export const MAX_MEDIA_OBJECT_BYTES = 50 * 1024 * 1024;
const MAX_MEDIA_QUEUE = 250;
const MAX_MEDIA_HYDRATIONS_PER_PASS = 10;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif', 'image/bmp', 'image/tiff']);
const flushes = new Map<string, Promise<string>>();

export function validateCloudMedia(media: SurfaceMedia): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(media.id)) throw new Error('Unsupported media identifier.');
  for (const [label, blob] of [['original', media.original], ['processed', media.processed]] as const) {
    const type = blob.type.toLowerCase().split(';', 1)[0].trim();
    if (!ALLOWED_IMAGE_TYPES.has(type) || (label === 'processed' && type !== 'image/jpeg')) throw new Error('Unsupported image format for cloud backup.');
    if (blob.size <= 0 || blob.size > MAX_MEDIA_OBJECT_BYTES) throw new Error('Image exceeds the cloud backup size limit.');
  }
}

export async function queueNote(note: Note, entitlement: SurfaceEntitlement, uid: string): Promise<void> {
  if (!eligible(entitlement.tier)) return;
  await queuePinOperation(uid, { id: `note:${note.id}`, kind: 'UPSERT_NOTE', pinId: note.id, payload: note });
}

export async function queueNoteDelete(id: string, entitlement: SurfaceEntitlement, uid: string): Promise<void> {
  if (!eligible(entitlement.tier)) return;
  await queuePinOperation(uid, { id: `note:${id}`, kind: 'DELETE_NOTE', pinId: id, payload: { id, deletedAt: Date.now(), updatedByDeviceId: deviceId() } });
}

export async function queueMediaUpload(media: SurfaceMedia, entitlement: SurfaceEntitlement, uid: string): Promise<void> {
  if (!maxOnly(entitlement.tier)) return;
  validateCloudMedia(media);
  await queueMediaOperation(uid, { id: `media:${media.id}`, kind: 'UPSERT_MEDIA', pinId: media.id, payload: media }, MAX_MEDIA_QUEUE);
}

export async function queueMediaDeletion(mediaId: string, uid: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(mediaId)) throw new Error('Unsupported media identifier.');
  await queueMediaOperation(uid, { id: `media:${mediaId}`, kind: 'DELETE_MEDIA', pinId: mediaId, payload: { mediaId } }, MAX_MEDIA_QUEUE);
}

export function flushCloudSync(entitlement: SurfaceEntitlement, uid: string): Promise<string> {
  const active = flushes.get(uid);
  if (active) return active;
  const pending = flushCloudSyncNow(entitlement, uid).finally(() => { if (flushes.get(uid) === pending) flushes.delete(uid); });
  flushes.set(uid, pending);
  return pending;
}

async function flushCloudSyncNow(entitlement: SurfaceEntitlement, uid: string): Promise<string> {
  const { auth, firestore } = getSurfaceFirebase();
  const ownerUid = uid;
  if (!ownerUid || auth.currentUser?.uid !== ownerUid) return 'Sign in to sync Surface data.';
  for (const operation of await dueSyncOperations(ownerUid)) {
    if (auth.currentUser?.uid !== ownerUid) return 'Sync paused after account change.';
    if (operation.kind === 'UPSERT_PIN' || operation.kind === 'DELETE_PIN') continue;
    if ((operation.kind === 'UPSERT_NOTE' || operation.kind === 'DELETE_NOTE') && !eligible(entitlement.tier)) continue;
    if (operation.kind === 'UPSERT_MEDIA' && !maxOnly(entitlement.tier)) continue;
    try {
      if (operation.kind === 'UPSERT_NOTE' || operation.kind === 'DELETE_NOTE') {
        await writeRecord(firestore, doc(firestore, 'users', ownerUid, 'notes', operation.pinId), operation.payload ?? {}, ownerUid);
      } else if (operation.kind === 'UPSERT_MEDIA' || operation.kind === 'DELETE_MEDIA') {
        if (operation.kind === 'DELETE_MEDIA') {
          await deleteCloudMediaNow(ownerUid, operation.pinId, firestore);
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
    transaction.set(target, { ...value, uid, revision: Math.max(currentRevision + 1, Number(value.updatedAt) || Date.now()), updatedByDeviceId: deviceId(), schemaVersion: 1 }, { merge: true });
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
  if (await getSyncOperation(uid, `media:${media.id}`)) throw new Error('Media sync pending; the local copy is safe.');
}

async function uploadMediaNow(media: SurfaceMedia, uid: string, firestore: Firestore): Promise<void> {
  const { app, auth } = getSurfaceFirebase();
  const storage = getStorage(app);
  const originalPath = `users/${uid}/media/${media.id}/original`;
  const processedPath = `users/${uid}/media/${media.id}/processed`;
  validateCloudMedia(media);
  if (auth.currentUser?.uid !== uid) throw new Error('Account changed during media upload.');
  await uploadBytes(ref(storage, originalPath), media.original, { contentType: media.original.type });
  if (auth.currentUser?.uid !== uid) throw new Error('Account changed during media upload.');
  await uploadBytes(ref(storage, processedPath), media.processed, { contentType: media.processed.type });
  if (auth.currentUser?.uid !== uid) throw new Error('Account changed during media upload.');
  const location = media.location ? {
    latitude: media.location.latitude,
    longitude: media.location.longitude,
    timestamp: media.location.timestamp,
    ...(media.location.accuracy === undefined ? {} : { accuracy: media.location.accuracy }),
    ...(media.location.locality ? { locality: media.location.locality } : {}),
    ...(media.location.district ? { district: media.location.district } : {}),
    ...(media.location.state ? { state: media.location.state } : {}),
  } : null;
  await setDoc(doc(firestore, 'users', uid, 'media', media.id), {
    uid, mediaId: media.id, type: media.capture ? 'capture' : 'gallery', originalPath, processedPath,
    originalMimeType: media.original.type, originalSize: media.original.size,
    mimeType: media.processed.type, size: media.processed.size,
    createdAt: media.createdAt, updatedAt: media.createdAt, dateKey: media.dateKey,
    timeLabel: media.timeLabel, locationLabel: media.locationLabel ?? '', location,
    capture: media.capture, pinIds: media.pinIds ?? [], revision: media.createdAt,
    updatedByDeviceId: deviceId(),
  }, { merge: true });
}

async function deleteCloudMediaNow(uid: string, mediaId: string, firestore: Firestore): Promise<void> {
  const { app, auth } = getSurfaceFirebase();
  if (auth.currentUser?.uid !== uid) throw new Error('Account changed during media deletion.');
  const storage = getStorage(app);
  for (const variant of ['original', 'processed'] as const) {
    try { await deleteObject(ref(storage, `users/${uid}/media/${mediaId}/${variant}`)); }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code !== 'storage/object-not-found') throw error;
    }
    if (auth.currentUser?.uid !== uid) throw new Error('Account changed during media deletion.');
  }
  try { await deleteDoc(doc(firestore, 'users', uid, 'media', mediaId)); }
  catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (code !== 'not-found') throw error;
  }
  if (auth.currentUser?.uid !== uid) throw new Error('Account changed during media deletion.');
}

export async function hydrateMediaMetadata(entitlement: SurfaceEntitlement, uid: string): Promise<boolean> {
  if (!maxOnly(entitlement.tier)) return false;
  const { auth, firestore } = getSurfaceFirebase();
  if (!uid || auth.currentUser?.uid !== uid) return false;
  const local = await listMedia(uid);
  const snapshot = await getDocs(collection(firestore, 'users', uid, 'media'));
  if (auth.currentUser?.uid !== uid) return false;
  const localById = new Map(local.map((entry) => [entry.id, entry]));
  const remote: SurfaceMedia[] = [];
  for (const item of snapshot.docs) {
    const value = item.data();
    if (value.uid !== uid || value.mediaId !== item.id || value.deletedAt || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id) || await isMediaDeleted(uid, item.id)) continue;
    const originalPath = `users/${uid}/media/${item.id}/original`;
    const processedPath = `users/${uid}/media/${item.id}/processed`;
    if (value.originalPath !== originalPath || value.processedPath !== processedPath ||
        !ALLOWED_IMAGE_TYPES.has(String(value.originalMimeType ?? '')) || value.mimeType !== 'image/jpeg' ||
        !Number.isInteger(value.originalSize) || value.originalSize <= 0 || value.originalSize > MAX_MEDIA_OBJECT_BYTES ||
        !Number.isInteger(value.size) || value.size <= 0 || value.size > MAX_MEDIA_OBJECT_BYTES) continue;
    const existing = localById.get(item.id);
    if (existing && !existing.remoteOnly && existing.original.size > 0 && existing.processed.size > 0) continue;
    const rawLocation = value.location;
    const location = rawLocation && typeof rawLocation === 'object' &&
      Number.isFinite(rawLocation.latitude) && rawLocation.latitude >= -90 && rawLocation.latitude <= 90 &&
      Number.isFinite(rawLocation.longitude) && rawLocation.longitude >= -180 && rawLocation.longitude <= 180 &&
      Number.isFinite(rawLocation.timestamp)
      ? {
          latitude: rawLocation.latitude, longitude: rawLocation.longitude, timestamp: rawLocation.timestamp,
          ...(Number.isFinite(rawLocation.accuracy) && rawLocation.accuracy >= 0 ? { accuracy: rawLocation.accuracy } : {}),
          ...(typeof rawLocation.locality === 'string' ? { locality: rawLocation.locality } : {}),
          ...(typeof rawLocation.district === 'string' ? { district: rawLocation.district } : {}),
          ...(typeof rawLocation.state === 'string' ? { state: rawLocation.state } : {}),
        }
      : undefined;
    const media: SurfaceMedia = existing
      ? { ...existing, createdAt: Number(value.createdAt) || existing.createdAt, dateKey: String(value.dateKey ?? existing.dateKey), timeLabel: String(value.timeLabel ?? existing.timeLabel), locationLabel: String(value.locationLabel ?? existing.locationLabel ?? ''), location: location ?? existing.location, capture: value.type === 'capture', pinIds: Array.isArray(value.pinIds) ? value.pinIds.filter((id): id is string => typeof id === 'string') : existing.pinIds, originalPath, processedPath, remoteOnly: true }
      : { id: item.id, original: new Blob(), processed: new Blob(), createdAt: Number(value.createdAt) || Date.now(), dateKey: String(value.dateKey ?? ''), timeLabel: String(value.timeLabel ?? ''), locationLabel: String(value.locationLabel ?? ''), location, capture: value.type === 'capture', pinIds: Array.isArray(value.pinIds) ? value.pinIds.filter((id): id is string => typeof id === 'string') : [], originalPath, processedPath, remoteOnly: true };
    if (!existing) await putMedia(uid, media);
    remote.push(media);
  }
  for (const media of remote.slice(0, MAX_MEDIA_HYDRATIONS_PER_PASS)) {
    if (auth.currentUser?.uid !== uid) return false;
    try { await hydrateMediaBlob(uid, media, entitlement); } catch { /* A failed object is retried on the next pass. */ }
  }
  return remote.length > MAX_MEDIA_HYDRATIONS_PER_PASS;
}

export async function hydrateMediaBlob(uid: string, media: SurfaceMedia, entitlement: SurfaceEntitlement): Promise<SurfaceMedia> {
  if (!maxOnly(entitlement.tier) || !media.remoteOnly || !media.originalPath || !media.processedPath) return media;
  const { app, auth } = getSurfaceFirebase();
  if (!uid || auth.currentUser?.uid !== uid || await isMediaDeleted(uid, media.id) || media.originalPath !== `users/${uid}/media/${media.id}/original` || media.processedPath !== `users/${uid}/media/${media.id}/processed`) return media;
  const storage = getStorage(app);
  const [original, processed] = await Promise.all([
    getBlob(ref(storage, media.originalPath), MAX_MEDIA_OBJECT_BYTES),
    getBlob(ref(storage, media.processedPath), MAX_MEDIA_OBJECT_BYTES),
  ]);
  if (auth.currentUser?.uid !== uid || await isMediaDeleted(uid, media.id)) return media;
  validateCloudMedia({ ...media, original, processed });
  const updated = { ...media, original, processed, remoteOnly: false };
  await putMedia(uid, updated);
  return updated;
}
