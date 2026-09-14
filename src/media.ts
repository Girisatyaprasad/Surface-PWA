import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { formatCoordinateGeotag, type SurfaceLocation } from './location';
import { requireWorkspaceUid, verifyWorkspaceOwner, workspaceDatabaseName } from './localWorkspace';

export type SurfaceMedia = { id: string; original: Blob; processed: Blob; createdAt: number; dateKey: string; timeLabel: string; locationLabel?: string; location?: SurfaceLocation; capture: boolean; pinIds?: string[]; originalPath?: string; processedPath?: string; remoteOnly?: boolean };
interface MediaDb extends DBSchema {
  workspaceMetadata: { key: string; value: { key: 'ownerUid'; uid: string } };
  media: { key: string; value: SurfaceMedia; indexes: { 'by-created': number } };
}
const databases = new Map<string, Promise<IDBPDatabase<MediaDb>>>();
async function databaseFor(uid: string): Promise<IDBPDatabase<MediaDb>> {
  const ownerUid = requireWorkspaceUid(uid);
  let pending = databases.get(ownerUid);
  if (!pending) {
    pending = openDB<MediaDb>(workspaceDatabaseName('media', ownerUid), 1, { upgrade(database) {
      database.createObjectStore('workspaceMetadata', { keyPath: 'key' });
      const store = database.createObjectStore('media', { keyPath: 'id' });
      store.createIndex('by-created', 'createdAt');
    } }).then(async (database) => {
      const metadata = await database.get('workspaceMetadata', 'ownerUid');
      verifyWorkspaceOwner(ownerUid, metadata?.uid, await database.count('media') > 0);
      if (!metadata) await database.put('workspaceMetadata', { key: 'ownerUid', uid: ownerUid });
      return database;
    });
    databases.set(ownerUid, pending);
    pending.catch(() => databases.delete(ownerUid));
  }
  return pending;
}
export async function listMedia(uid: string): Promise<SurfaceMedia[]> {
  const database = await databaseFor(uid);
  const items = (await database.getAllFromIndex('media', 'by-created')).reverse();
  return Promise.all(items.map(async (item) => {
    if (!item.location || item.locationLabel || item.remoteOnly || item.original.size === 0) return item;
    const locationLabel = formatCoordinateGeotag(item.location);
    if (!locationLabel) return item;
    const migrated = { ...item, locationLabel, processed: await burnSurfaceMetadata(item.original, locationLabel, item.createdAt) };
    await database.put('media', migrated);
    return migrated;
  }));
}
export async function listMediaRaw(uid: string): Promise<SurfaceMedia[]> {
  return (await databaseFor(uid)).getAllFromIndex('media', 'by-created').then((items) => items.reverse());
}
export async function getMedia(uid: string, id: string): Promise<SurfaceMedia | undefined> { return (await databaseFor(uid)).get('media', id); }
export async function saveMedia(uid: string, file: Blob, location?: SurfaceLocation | null, capture = true): Promise<SurfaceMedia> {
  const now = Date.now();
  const locationLabel = formatCoordinateGeotag(location);
  const item: SurfaceMedia = {
    id: crypto.randomUUID(), original: file, processed: await burnSurfaceMetadata(file, locationLabel, now),
    createdAt: now, dateKey: new Date(now).toLocaleDateString('en-GB'),
    timeLabel: new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    locationLabel, location: location ? { ...location } : undefined, capture, pinIds: [],
  };
  try {
    await (await databaseFor(uid)).put('media', item);
  } catch (error) {
    console.info('[SurfaceCamera] PERSISTENCE_FAILED', {
      storage: 'IndexedDB', hasLocation: Boolean(item.location),
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    throw error;
  }
  console.info('[SurfaceCamera] PERSISTENCE_STORED', {
    storage: 'IndexedDB', hasLocation: Boolean(item.location), hasLocationLabel: Boolean(item.locationLabel),
    locationAccuracyMeters: item.location?.accuracy ?? null,
  });
  return item;
}
export async function deleteMedia(uid: string, id: string): Promise<void> { await (await databaseFor(uid)).delete('media', id); }
export async function putMedia(uid: string, item: SurfaceMedia): Promise<void> { await (await databaseFor(uid)).put('media', item); }
export async function insertMediaIfAbsent(uid: string, item: SurfaceMedia): Promise<boolean> {
  const tx = (await databaseFor(uid)).transaction('media', 'readwrite');
  if (await tx.store.get(item.id)) { await tx.done; return false; }
  await tx.store.add(item);
  await tx.done;
  return true;
}
export async function closeLocalMediaWorkspace(uid: string): Promise<void> {
  const ownerUid = requireWorkspaceUid(uid);
  const pending = databases.get(ownerUid);
  if (!pending) return;
  databases.delete(ownerUid);
  (await pending).close();
}
export async function deleteLocalMediaWorkspace(uid: string): Promise<void> {
  const ownerUid = requireWorkspaceUid(uid);
  await closeLocalMediaWorkspace(ownerUid);
  await deleteDB(workspaceDatabaseName('media', ownerUid));
}
export function objectUrl(blob: Blob): string { return URL.createObjectURL(blob); }
export function mediaDisplayBlob(item: Pick<SurfaceMedia, 'processed'>): Blob { return item.processed; }

export class GeotagRenderError extends Error {
  readonly code = 'GEOTAG_RENDER_FAILED';
  constructor() { super('Surface could not render the capture geotag.'); this.name = 'GeotagRenderError'; }
}

async function burnSurfaceMetadata(file: Blob, location: string, capturedAt: number): Promise<Blob> {
  let image: ImageBitmap | undefined;
  try {
    image = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas_context_unavailable');
    context.drawImage(image, 0, 0);
    drawSurfaceMetadataOverlay(context, canvas.width, canvas.height, capturedAt, location);
    const processed = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('canvas_encode_failed')), 'image/jpeg', .98));
    console.info('[SurfaceCamera] METADATA_BURN', { sourceWidth: image.width, sourceHeight: image.height, canvasWidth: canvas.width, canvasHeight: canvas.height, hasLocationLabel: Boolean(location), mimeType: processed.type, blobSize: processed.size, quality: .98 });
    return processed;
  } catch (error) {
    console.info('[SurfaceCamera] METADATA_BURN_FAILED', {
      hasLocationLabel: Boolean(location),
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    if (location) throw new GeotagRenderError();
    return file;
  } finally {
    try { image?.close(); } catch { /* bitmap cleanup is best-effort */ }
  }
}

export function drawSurfaceMetadataOverlay(context: CanvasRenderingContext2D, width: number, height: number, capturedAt: number, location: string): void {
  const fontSize = Math.max(14, Math.round(width / 34));
  const bottom = height - Math.max(14, Math.round(fontSize * .35));
  const lineGap = Math.round(fontSize * 1.2);
  const bandHeight = Math.max(64, Math.round(fontSize * 2.6 + 36));
  context.fillStyle = 'rgba(0,0,0,.58)';
  context.fillRect(0, height - bandHeight, width, bandHeight);
  context.fillStyle = '#fff';
  context.font = `${fontSize}px sans-serif`;
  const date = new Date(capturedAt);
  context.fillText(`${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}  ${date.toLocaleDateString('en-GB')}`, 18, bottom - (location ? lineGap : 0), width - 36);
  if (location) context.fillText(location, 18, bottom, width - 36);
}
