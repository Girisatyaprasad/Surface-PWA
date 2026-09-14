import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireSurfaceLocation,
  formatCoordinateGeotag,
  formatSurfaceLocation,
  isRecentSurfaceLocation,
  readSurfaceLocation,
  snapshotSurfaceLocation,
  SURFACE_LOCATION_MAX_AGE_MS,
  SURFACE_LOCATION_MAXIMUM_AGE_MS,
  SURFACE_LOCATION_TIMEOUT_MS,
  type SurfaceLocation,
} from './location';

const locationFix: SurfaceLocation = {
  latitude: 16.5,
  longitude: 80.6,
  timestamp: 100000,
  accuracy: 24,
};

function storageMock() {
  const items = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => items.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => items.set(key, value)),
    removeItem: vi.fn((key: string) => items.delete(key)),
  };
}

describe('Surface browser location', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('obtains a secure-context fix, retains accuracy and caches it', async () => {
    const storage = storageMock();
    const geolocation = {
      getCurrentPosition: vi.fn((success: PositionCallback) => success({
        coords: { latitude: locationFix.latitude, longitude: locationFix.longitude, accuracy: locationFix.accuracy } as GeolocationCoordinates,
        timestamp: locationFix.timestamp,
      } as GeolocationPosition)),
    };
    const result = await acquireSurfaceLocation({
      geolocation,
      queryPermission: async () => 'granted',
      secureContext: true,
      storage,
      now: () => locationFix.timestamp + 40,
    });

    expect(result).toMatchObject({ location: locationFix, permissionState: 'granted', outcome: 'success' });
    expect(storage.setItem).toHaveBeenCalledWith('surface-location', JSON.stringify(locationFix));
    expect(geolocation.getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: true,
      maximumAge: SURFACE_LOCATION_MAXIMUM_AGE_MS,
      timeout: SURFACE_LOCATION_TIMEOUT_MS,
    });
  });

  it('does not request again when permission is denied', async () => {
    const storage = storageMock();
    storage.setItem('surface-location', JSON.stringify(locationFix));
    const geolocation = { getCurrentPosition: vi.fn() };
    const result = await acquireSurfaceLocation({ geolocation, queryPermission: async () => 'denied', secureContext: true, storage });

    expect(result).toMatchObject({ location: null, permissionState: 'denied', outcome: 'denied' });
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledWith('surface-location');
  });

  it('treats browser geolocation timeout as optional and non-fatal', async () => {
    const geolocation = {
      getCurrentPosition: vi.fn((_success: PositionCallback, failure: PositionErrorCallback) => failure({
        code: 3,
        message: 'timeout',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError)),
    };
    await expect(acquireSurfaceLocation({ geolocation, queryPermission: async () => 'prompt', secureContext: true, storage: storageMock() }))
      .resolves.toMatchObject({ location: null, outcome: 'timeout' });
  });

  it('does not call geolocation from an insecure context', async () => {
    const geolocation = { getCurrentPosition: vi.fn() };
    await expect(acquireSurfaceLocation({ geolocation, secureContext: false, storage: storageMock() }))
      .resolves.toMatchObject({ location: null, outcome: 'insecure' });
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('accepts recent fixes and freezes the same optional metadata for capture paths', () => {
    expect(isRecentSurfaceLocation(locationFix, locationFix.timestamp + 1000)).toBe(true);
    expect(snapshotSurfaceLocation(locationFix, locationFix.timestamp + 1000)).toEqual(locationFix);
    expect(snapshotSurfaceLocation(null, locationFix.timestamp + 1000)).toBeNull();
    expect(snapshotSurfaceLocation(locationFix, locationFix.timestamp + SURFACE_LOCATION_MAX_AGE_MS + 1)).toBeNull();
  });

  it('reads a fresh location cache but rejects expired fixes', () => {
    const storage = storageMock();
    storage.setItem('surface-location', JSON.stringify(locationFix));
    expect(readSurfaceLocation(locationFix.timestamp + 1000, storage)).toEqual(locationFix);
    expect(readSurfaceLocation(locationFix.timestamp + SURFACE_LOCATION_MAX_AGE_MS + 1, storage)).toBeNull();
  });

  it('keeps missing location empty rather than inventing an unavailable label', () => {
    expect(formatSurfaceLocation(null)).toBe('');
    expect(formatSurfaceLocation({ ...locationFix, locality: 'Hanuman Junction', district: 'Krishna', state: 'Andhra Pradesh' }))
      .toBe('Hanuman Junction, Krishna, Andhra Pradesh');
  });

  it('formats coordinate geotags to five decimals with optional accuracy and correct hemispheres', () => {
    expect(formatCoordinateGeotag({ latitude: 16.810424, longitude: 80.821714, accuracy: 18.4 }))
      .toBe('16.81042° N · 80.82171° E · ±18 m');
    expect(formatCoordinateGeotag({ latitude: -17.38504, longitude: -78.48667 }))
      .toBe('17.38504° S · 78.48667° W');
    expect(formatCoordinateGeotag({ latitude: 90.123, longitude: 0 })).toBe('');
  });

  it('uses a future locality label in place of coordinates and emits nothing without a location', () => {
    expect(formatCoordinateGeotag({ ...locationFix, locality: 'Hanuman Junction', state: 'Andhra Pradesh' }))
      .toBe('Hanuman Junction · Andhra Pradesh');
    expect(formatCoordinateGeotag(null)).toBe('');
  });
});
