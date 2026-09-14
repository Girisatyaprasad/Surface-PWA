import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  currentUid: 'max-owner' as string | null,
  operations: new Map<string, any>(),
  localMedia: new Map<string, any>(),
  remoteMedia: new Map<string, any>(),
  uploaded: new Map<string, { blob: Blob; contentType: string }>(),
  objects: new Map<string, Blob>(),
  metadata: new Map<string, any>(),
  afterBlobRead: null as null | (() => void),
}));

vi.mock('./firebase', () => ({ getSurfaceFirebase: () => ({ app: {}, auth: { get currentUser() { return state.currentUid ? { uid: state.currentUid } : null; } }, firestore: {} }) }));
vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(() => ({})),
  ref: vi.fn((_storage: unknown, fullPath: string) => ({ fullPath })),
  uploadBytes: vi.fn(async (reference: { fullPath: string }, blob: Blob, metadata: { contentType: string }) => { state.uploaded.set(reference.fullPath, { blob, contentType: metadata.contentType }); }),
  getBlob: vi.fn(async (reference: { fullPath: string }) => {
    const blob = state.objects.get(reference.fullPath);
    if (!blob) throw new Error('Object not found');
    state.afterBlobRead?.();
    return blob;
  }),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  getDocs: vi.fn(async (target: { path: string }) => ({ docs: [...state.remoteMedia.entries()].filter(([path]) => path.startsWith(`${target.path}/`)).map(([path, value]) => ({ id: path.split('/').at(-1), data: () => value })) })),
  runTransaction: vi.fn(),
  setDoc: vi.fn(async (target: { path: string }, value: unknown) => { state.metadata.set(target.path, value); }),
}));
vi.mock('./db', () => ({
  dueSyncOperations: vi.fn(async () => [...state.operations.values()].filter((item) => item.nextAttemptAt <= Date.now())),
  getSyncOperation: vi.fn(async (_uid: string, id: string) => state.operations.get(id)),
  listNotes: vi.fn(async () => []),
  listSyncOperations: vi.fn(async () => [...state.operations.values()]),
  putNote: vi.fn(),
  queueMediaOperation: vi.fn(async (_uid: string, operation: any) => { state.operations.set(operation.id, { ...operation, attempts: 0, nextAttemptAt: Date.now() }); }),
  queuePinOperation: vi.fn(),
  removePinOperation: vi.fn(async (_uid: string, id: string) => { state.operations.delete(id); }),
  retryPinOperation: vi.fn(async (_uid: string, operation: any) => { state.operations.set(operation.id, { ...operation, attempts: operation.attempts + 1, nextAttemptAt: Date.now() + 60_000 }); }),
}));
vi.mock('./media', () => ({
  listMedia: vi.fn(async () => [...state.localMedia.values()]),
  putMedia: vi.fn(async (_uid: string, item: any) => { state.localMedia.set(item.id, item); }),
}));

import { flushCloudSync, hydrateMediaBlob, hydrateMediaMetadata, uploadMedia, validateCloudMedia } from './cloudSync';
import type { SurfaceEntitlement } from './entitlement';
import type { SurfaceMedia } from './media';

const max: SurfaceEntitlement = { tier: 'MAX', proStatus: 'PRO_ACTIVE', planId: 'surface_max_1period', expiresAt: null };
const pro: SurfaceEntitlement = { tier: 'PRO', proStatus: 'PRO_ACTIVE', planId: 'surface_pro_1period', expiresAt: null };
const free: SurfaceEntitlement = { tier: 'FREE', proStatus: 'UNPAID', planId: null, expiresAt: null };
function media(id = 'media-1', original = new Blob(['original'], { type: 'image/png' }), processed = new Blob(['processed'], { type: 'image/jpeg' })): SurfaceMedia {
  return { id, original, processed, createdAt: 10, dateKey: '14/09/2026', timeLabel: '10:00 am', locationLabel: '', capture: true, pinIds: [] };
}

describe('Max cloud media pipeline', () => {
  beforeEach(() => {
    state.currentUid = 'max-owner'; state.operations.clear(); state.localMedia.clear(); state.remoteMedia.clear();
    state.uploaded.clear(); state.objects.clear(); state.metadata.clear(); state.afterBlobRead = null;
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  });

  it('keeps valid raster originals and the processed JPEG within the upload bounds', () => {
    expect(() => validateCloudMedia(media())).not.toThrow();
  });

  it('rejects unsafe SVG originals', () => {
    expect(() => validateCloudMedia(media('svg', new Blob(['<svg/>'], { type: 'image/svg+xml' })))).toThrow(/unsupported image format/i);
  });

  it('rejects non-JPEG processed renditions', () => {
    expect(() => validateCloudMedia(media('bad', undefined, new Blob(['processed'], { type: 'image/png' })))).toThrow(/unsupported image format/i);
  });

  it('rejects media identifiers that could escape the owner path', () => {
    expect(() => validateCloudMedia(media('../other'))).toThrow(/identifier/i);
  });

  it('rejects empty and over-limit image blobs before queueing', () => {
    expect(() => validateCloudMedia(media('empty', new Blob([], { type: 'image/jpeg' })))).toThrow(/size limit/i);
    expect(() => validateCloudMedia(media('large', new Blob([new Uint8Array(50 * 1024 * 1024 + 1)], { type: 'image/jpeg' })))).toThrow(/size limit/i);
  });

  it('does not enqueue or upload Free media', async () => {
    await uploadMedia(media(), free, 'max-owner');
    expect(state.operations.size).toBe(0); expect(state.uploaded.size).toBe(0);
  });

  it('does not enqueue or upload Pro media', async () => {
    await uploadMedia(media(), pro, 'max-owner');
    expect(state.operations.size).toBe(0); expect(state.uploaded.size).toBe(0);
  });

  it('uploads original and processed blobs to separate owner paths for Max', async () => {
    const item = media();
    await uploadMedia(item, max, 'max-owner');
    expect([...state.uploaded.keys()].sort()).toEqual(['users/max-owner/media/media-1/original', 'users/max-owner/media/media-1/processed']);
    expect(state.uploaded.get('users/max-owner/media/media-1/original')?.blob).toBe(item.original);
    expect(state.uploaded.get('users/max-owner/media/media-1/processed')?.blob).toBe(item.processed);
  });

  it('writes owner-scoped metadata only after both objects upload', async () => {
    await uploadMedia(media(), max, 'max-owner');
    expect(state.metadata.get('users/max-owner/media/media-1')).toMatchObject({ uid: 'max-owner', mediaId: 'media-1', type: 'capture', mimeType: 'image/jpeg', originalPath: 'users/max-owner/media/media-1/original', processedPath: 'users/max-owner/media/media-1/processed' });
  });

  it('does not upload after Firebase account ownership changes', async () => {
    state.currentUid = 'another-user';
    await uploadMedia(media(), max, 'max-owner');
    expect(state.operations.size).toBe(0); expect(state.uploaded.size).toBe(0);
  });

  it('hydrates original and processed blobs as distinct local representations', async () => {
    const original = new Blob(['raw-original'], { type: 'image/png' });
    const processed = new Blob(['burned-processed'], { type: 'image/jpeg' });
    state.objects.set('users/max-owner/media/media-1/original', original);
    state.objects.set('users/max-owner/media/media-1/processed', processed);
    const remote = { ...media(), original: new Blob(), processed: new Blob(), originalPath: 'users/max-owner/media/media-1/original', processedPath: 'users/max-owner/media/media-1/processed', remoteOnly: true };
    const result = await hydrateMediaBlob('max-owner', remote, max);
    expect(result.original).toBe(original); expect(result.processed).toBe(processed); expect(result.remoteOnly).toBe(false);
    expect(state.localMedia.get('media-1')).toEqual(result);
  });

  it('does not hydrate media for Free or Pro', async () => {
    const remote = { ...media(), originalPath: 'users/max-owner/media/media-1/original', processedPath: 'users/max-owner/media/media-1/processed', remoteOnly: true };
    await hydrateMediaBlob('max-owner', remote, pro);
    await hydrateMediaBlob('max-owner', remote, free);
    expect(state.localMedia.size).toBe(0);
  });

  it('stops hydration if the account changes while objects are downloading', async () => {
    const remote = { ...media(), originalPath: 'users/max-owner/media/media-1/original', processedPath: 'users/max-owner/media/media-1/processed', remoteOnly: true };
    state.objects.set(remote.originalPath!, new Blob(['raw'], { type: 'image/jpeg' }));
    state.objects.set(remote.processedPath!, new Blob(['processed'], { type: 'image/jpeg' }));
    state.afterBlobRead = () => { state.currentUid = 'other-user'; };
    await hydrateMediaBlob('max-owner', remote, max);
    expect(state.localMedia.size).toBe(0);
  });

  it('discovers remote metadata and hydrates both image variants into local media', async () => {
    const id = 'remote-1';
    const originalPath = `users/max-owner/media/${id}/original`;
    const processedPath = `users/max-owner/media/${id}/processed`;
    const original = new Blob(['raw'], { type: 'image/png' });
    const processed = new Blob(['rendered'], { type: 'image/jpeg' });
    state.objects.set(originalPath, original); state.objects.set(processedPath, processed);
    state.remoteMedia.set(`users/max-owner/media/${id}`, { uid: 'max-owner', mediaId: id, type: 'gallery', originalPath, processedPath, originalMimeType: 'image/png', originalSize: 3, mimeType: 'image/jpeg', size: 8, createdAt: 100, dateKey: '14/09/2026', timeLabel: '10:00 am', locationLabel: '', location: null, pinIds: [], capture: false });
    await hydrateMediaMetadata(max, 'max-owner');
    expect(state.localMedia.get(id)).toMatchObject({ original, processed, remoteOnly: false, capture: false });
  });

  it('ignores metadata whose object paths do not match the signed-in owner and media ID', async () => {
    state.remoteMedia.set('users/max-owner/media/remote-1', { uid: 'max-owner', mediaId: 'remote-1', originalPath: 'users/victim/media/remote-1/original', processedPath: 'users/victim/media/remote-1/processed', mimeType: 'image/jpeg' });
    await hydrateMediaMetadata(max, 'max-owner');
    expect(state.localMedia.size).toBe(0);
  });

  it('honors scheduled retry time instead of retrying every queued media operation immediately', async () => {
    state.operations.set('media:later', { id: 'media:later', kind: 'UPSERT_MEDIA', pinId: 'later', payload: media('later'), attempts: 2, nextAttemptAt: Date.now() + 60_000 });
    await flushCloudSync(max, 'max-owner');
    expect(state.uploaded.size).toBe(0); expect(state.operations.has('media:later')).toBe(true);
  });
});
