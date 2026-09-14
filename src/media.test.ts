import { beforeEach, describe, expect, it, vi } from 'vitest';

const { records, databaseStores } = vi.hoisted(() => ({ records: new Map<string, unknown>(), databaseStores: new Map<string, Map<string, Map<string, unknown>>>() }));
vi.mock('idb', () => ({
  openDB: async (name: string) => {
    const stores = databaseStores.get(name) ?? new Map<string, Map<string, unknown>>();
    databaseStores.set(name, stores);
    const store = (storeName: string) => { const values = stores.get(storeName) ?? new Map<string, unknown>(); stores.set(storeName, values); return values; };
    return {
      put: async (storeName: string, value: { id?: string; key?: string }) => { store(storeName).set(String(value.key ?? value.id), value); records.set(`${name}:${storeName}:${value.key ?? value.id}`, value); },
      get: async (storeName: string, id: string) => store(storeName).get(id),
      getAllFromIndex: async (storeName: string) => [...store(storeName).values()],
      count: async (storeName: string) => store(storeName).size,
      delete: async (storeName: string, id: string) => { store(storeName).delete(id); records.delete(`${name}:${storeName}:${id}`); },
      close: () => undefined,
    };
  },
  deleteDB: async (name: string) => { databaseStores.delete(name); },
}));

import { GeotagRenderError, getMedia, listMedia, putMedia, saveMedia } from './media';
import { acquireSurfaceLocation } from './location';

function stubImageRenderer() {
  const fillText = vi.fn();
  const context = { drawImage: vi.fn(), fillRect: vi.fn(), fillText, fillStyle: '', font: '' } as unknown as CanvasRenderingContext2D;
  const processed = new Blob(['processed'], { type: 'image/jpeg' });
  const getContext = vi.fn(() => context);
  const encode = vi.fn((callback: BlobCallback) => callback(processed));
  const canvas = {
    width: 0,
    height: 0,
    getContext,
    toBlob: encode,
  } as unknown as HTMLCanvasElement;
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1200, height: 800, close: vi.fn() })));
  return { context, fillText, processed, getContext, encode };
}

describe('capture media location metadata', () => {
  beforeEach(() => { records.clear(); databaseStores.clear(); vi.unstubAllGlobals(); });

  it('burns the coordinate geotag into the processed image while preserving the original and raw metadata', async () => {
    const renderer = stubImageRenderer();
    const original = new Blob(['original'], { type: 'image/jpeg' });
    const location = { latitude: 16.5, longitude: 80.6, timestamp: Date.now(), accuracy: 24 };
    const saved = await saveMedia('media-user-1', original, location, true);
    const persisted = await getMedia('media-user-1', saved.id);

    expect(saved.original).toBe(original);
    expect(saved.processed).toBe(renderer.processed);
    expect(renderer.context.drawImage).toHaveBeenCalledTimes(1);
    expect(renderer.fillText).toHaveBeenCalledWith('16.50000° N · 80.60000° E · ±24 m', 18, expect.any(Number), 1164);
    expect(persisted?.location).toEqual(location);
    expect(persisted?.locationLabel).toBe('16.50000° N · 80.60000° E · ±24 m');
    expect(persisted?.capture).toBe(true);
    expect(persisted?.original).toBe(original);
    expect(persisted?.processed).toBe(renderer.processed);
  });

  it('persists a capture normally when location is absent, with no unavailable label', async () => {
    const saved = await saveMedia('media-user-2', new Blob(['image']), null, true);
    const persisted = await getMedia('media-user-2', saved.id);

    expect(persisted?.capture).toBe(true);
    expect(persisted?.location).toBeUndefined();
    expect(persisted?.locationLabel).toBe('');
  });

  it('keeps Gallery/Captures blobs and PIN media relationships inside the owning UID database', async () => {
    stubImageRenderer();
    const itemA = await saveMedia('media-owner-A', new Blob(['a']), null, true);
    const itemB = await saveMedia('media-owner-B', new Blob(['b']), null, true);
    await putMedia('media-owner-A', { ...itemA, pinIds: ['pin-A'] });

    expect((await listMedia('media-owner-A')).map((item) => item.id)).toEqual([itemA.id]);
    expect((await getMedia('media-owner-B', itemA.id))).toBeUndefined();
    expect((await listMedia('media-owner-B')).map((item) => item.id)).toEqual([itemB.id]);
    expect((await getMedia('media-owner-A', itemA.id))?.pinIds).toEqual(['pin-A']);
  });

  it('rejects a populated media workspace without a UID owner marker', async () => {
    const databaseName = 'surface-pwa-media-user-media-ambiguous';
    databaseStores.set(databaseName, new Map([
      ['media', new Map([['unowned-media', { id: 'unowned-media', original: new Blob(['private']), processed: new Blob(['private']) }]])],
    ]));

    await expect(listMedia('media-ambiguous')).rejects.toThrow(/ownership is ambiguous/i);
    expect(databaseStores.get(databaseName)?.get('media')?.has('unowned-media')).toBe(true);
    expect(databaseStores.get(databaseName)?.get('workspaceMetadata')?.has('ownerUid') ?? false).toBe(false);
  });

  it('continues saving after location permission is denied without adding an unavailable label', async () => {
    const result = await acquireSurfaceLocation({
      geolocation: { getCurrentPosition: vi.fn() },
      queryPermission: async () => 'denied',
      secureContext: true,
      storage: null,
    });
    const saved = await saveMedia('media-user-3', new Blob(['capture']), result.location, true);
    const persisted = await getMedia('media-user-3', saved.id);

    expect(result.location).toBeNull();
    expect(persisted?.capture).toBe(true);
    expect(persisted?.locationLabel).toBe('');
  });

  it('does not silently store an untagged original when geotag rendering fails', async () => {
    const renderer = stubImageRenderer();
    renderer.getContext.mockReturnValue(null as unknown as CanvasRenderingContext2D);
    const original = new Blob(['original'], { type: 'image/jpeg' });
    const location = { latitude: 16.5, longitude: 80.6, timestamp: Date.now(), accuracy: 24 };

    await expect(saveMedia('media-user-4', original, location, true)).rejects.toBeInstanceOf(GeotagRenderError);
    expect([...records.keys()].filter((key) => key.includes(':media:')).length).toBe(0);
  });

  it('treats a null canvas encoding result as a geotag render failure', async () => {
    const renderer = stubImageRenderer();
    renderer.encode.mockImplementation((callback) => callback(null));
    const location = { latitude: 16.5, longitude: 80.6, timestamp: Date.now(), accuracy: 24 };

    await expect(saveMedia('media-user-5', new Blob(['original']), location, true)).rejects.toBeInstanceOf(GeotagRenderError);
    expect([...records.keys()].filter((key) => key.includes(':media:')).length).toBe(0);
  });

  it('hydrates legacy captures with persisted coordinates and burns their label once on reload', async () => {
    const renderer = stubImageRenderer();
    const original = new Blob(['legacy-original'], { type: 'image/jpeg' });
    const legacy = {
      id: 'legacy-capture', original, processed: new Blob(['old-render']), createdAt: Date.now(),
      dateKey: '14/09/2026', timeLabel: '8:10 pm', capture: true,
      location: { latitude: 16.81042, longitude: 80.82171, timestamp: Date.now(), accuracy: 18 },
      locationLabel: '',
    };
    const databaseName = 'surface-pwa-media-user-media-user-6';
    const store = databaseStores.get(databaseName) ?? new Map<string, Map<string, unknown>>();
    databaseStores.set(databaseName, store);
    store.set('workspaceMetadata', new Map([['ownerUid', { key: 'ownerUid', uid: 'media-user-6' }]]));
    const mediaStore = store.get('media') ?? new Map<string, unknown>();
    store.set('media', mediaStore);
    mediaStore.set(legacy.id, legacy);

    const reopened = await listMedia('media-user-6');
    const persisted = await getMedia('media-user-6', legacy.id);

    expect(reopened[0].locationLabel).toBe('16.81042° N · 80.82171° E · ±18 m');
    expect(reopened[0].processed).toBe(renderer.processed);
    expect(persisted?.original).toBe(original);
    expect(persisted?.location).toEqual(legacy.location);
    expect(renderer.fillText).toHaveBeenCalledWith(reopened[0].locationLabel, 18, expect.any(Number), 1164);
  });
});
