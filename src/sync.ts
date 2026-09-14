import { collection, deleteDoc, doc, getDocs, runTransaction, setDoc, type Firestore } from 'firebase/firestore';
import { getSurfaceFirebase } from './firebase';
import { listPins, pendingPinOperations, putPin, removePinOperation, retryPinOperation, type Pin } from './db';
import type { SurfaceEntitlement } from './entitlement';

const deviceId = globalThis.localStorage?.getItem('surface-pwa-device-id') ?? crypto.randomUUID();
globalThis.localStorage?.setItem('surface-pwa-device-id', deviceId);

export async function flushPinSync(entitlement: SurfaceEntitlement, uid: string): Promise<string> {
  const ownerUid = uid;
  if (entitlement.tier === 'FREE') return 'Free PINs stay on this device.';
  const { auth, firestore } = getSurfaceFirebase();
  if (!ownerUid || auth.currentUser?.uid !== ownerUid) return 'Sign in to sync PINs.';
  for (const operation of await pendingPinOperations(ownerUid)) {
    if (auth.currentUser?.uid !== ownerUid) return 'PIN sync paused after account change.';
    if (operation.kind !== 'UPSERT_PIN' && operation.kind !== 'DELETE_PIN') continue;
    try {
      const ref = doc(firestore, 'users', ownerUid, 'pins', operation.pinId);
      if (operation.kind === 'DELETE_PIN') await deleteDoc(ref);
      else if (operation.payload) await setPinWithRevision(firestore, ref, operation.payload as Pin, ownerUid);
      if (auth.currentUser?.uid !== ownerUid) return 'PIN sync paused after account change.';
      await removePinOperation(ownerUid, operation.id);
    } catch (error) {
      await retryPinOperation(ownerUid, operation, error instanceof Error ? error.message : 'Sync failed');
    }
  }
  return (await pendingPinOperations(ownerUid)).length ? 'PIN sync pending.' : 'PIN synced.';
}

export async function syncOnePin(entitlement: SurfaceEntitlement, pin: Pin, uid: string): Promise<string> {
  if (entitlement.tier === 'FREE') return 'Local only - cloud sync not eligible';
  const { auth, firestore } = getSurfaceFirebase();
  if (!uid || auth.currentUser?.uid !== uid) return 'Sign in to sync PINs.';
  try {
    await setPinWithRevision(firestore, doc(firestore, 'users', uid, 'pins', pin.id), pin, uid);
    return `Synced ${pin.id}`;
  } catch (error) {
    return error instanceof Error ? `Sync pending: ${error.message}` : 'Sync pending.';
  }
}

async function setPinWithRevision(firestore: Firestore, ref: ReturnType<typeof doc>, pin: Pin, uid: string) {
  await runTransaction(firestore, async (transaction) => {
    const current = await transaction.get(ref);
    const currentRevision = typeof current.data()?.revision === 'number' ? current.data()?.revision : 0;
    const nextRevision = Math.max(currentRevision + 1, pin.updatedAt);
    transaction.set(ref, { ...pin, uid, revision: nextRevision, updatedByDeviceId: deviceId, schemaVersion: 1 }, { merge: true });
  });
}

export async function hydratePins(entitlement: SurfaceEntitlement, uid: string): Promise<Pin[]> {
  const ownerUid = uid;
  const { auth, firestore } = getSurfaceFirebase();
  if (!ownerUid || auth.currentUser?.uid !== ownerUid) return [];
  if (entitlement.tier === 'FREE') return listPins(ownerUid);
  const snapshot = await getDocs(collection(firestore, 'users', ownerUid, 'pins'));
  if (auth.currentUser?.uid !== ownerUid) return [];
  for (const item of snapshot.docs) {
    const data = item.data();
    if (data.uid !== ownerUid || typeof data.name !== 'string') continue;
    await putPin(ownerUid, {
      id: item.id,
      name: data.name,
      phone: typeof data.phone === 'string' ? data.phone : '',
      about: typeof data.about === 'string' ? data.about : '',
      locationLabel: typeof data.locationLabel === 'string' ? data.locationLabel : '',
      dateKey: typeof data.dateKey === 'string' ? data.dateKey : undefined,
      followUpAt: typeof data.followUpAt === 'number' ? data.followUpAt : null,
      followUpReason: typeof data.followUpReason === 'string' ? data.followUpReason : '',
      createdAt: Number(data.createdAt) || Date.now(),
      updatedAt: Number(data.updatedAt) || Date.now()
    });
  }
  return auth.currentUser?.uid === ownerUid ? listPins(ownerUid) : [];
}
