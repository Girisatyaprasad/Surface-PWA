export type SurfaceLocation = { latitude: number; longitude: number; timestamp: number; accuracy?: number; locality?: string; district?: string; state?: string };

export const SURFACE_LOCATION_MAX_AGE_MS = 5 * 60 * 1000;
export const SURFACE_LOCATION_TIMEOUT_MS = 7000;
export const SURFACE_LOCATION_MAXIMUM_AGE_MS = 120000;

export type SurfaceLocationResult = {
  location: SurfaceLocation | null;
  permissionState: PermissionState | 'unknown';
  outcome: 'success' | 'denied' | 'timeout' | 'unavailable' | 'insecure' | 'error';
};

type LocationOptions = {
  geolocation?: Pick<Geolocation, 'getCurrentPosition'> | null;
  queryPermission?: (() => Promise<PermissionState>) | null;
  secureContext?: boolean;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  now?: () => number;
};

export function formatSurfaceLocation(value?: Partial<SurfaceLocation> | null): string {
  if (!value) return '';
  const parts = [value.locality, value.district, value.state].filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
  return [...new Set(parts.map((part) => part.trim()))].join(', ');
}

export function formatCoordinateGeotag(value?: Partial<SurfaceLocation> | null): string {
  if (!value) return '';
  const locality = [value.locality, value.state]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim());
  if (locality.length) return [...new Set(locality)].join(' · ');
  const rawLatitude = value.latitude;
  const rawLongitude = value.longitude;
  if (typeof rawLatitude !== 'number' || !Number.isFinite(rawLatitude) || rawLatitude < -90 || rawLatitude > 90 ||
      typeof rawLongitude !== 'number' || !Number.isFinite(rawLongitude) || rawLongitude < -180 || rawLongitude > 180) return '';
  const latitude = `${Math.abs(rawLatitude).toFixed(5)}° ${rawLatitude < 0 ? 'S' : 'N'}`;
  const longitude = `${Math.abs(rawLongitude).toFixed(5)}° ${rawLongitude < 0 ? 'W' : 'E'}`;
  const accuracy = Number.isFinite(value.accuracy) && value.accuracy! >= 0 ? ` · ±${Math.round(value.accuracy!)} m` : '';
  return `${latitude} · ${longitude}${accuracy}`;
}

export function readSurfaceLocation(now = Date.now(), storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null): SurfaceLocation | null {
  return readCachedSurfaceLocation(now, storage);
}

export async function acquireSurfaceLocation(options: LocationOptions = {}): Promise<SurfaceLocationResult> {
  const now = options.now ?? Date.now;
  const storage = options.storage === undefined ? getBrowserStorage() : options.storage;
  const secureContext = options.secureContext ?? (typeof window !== 'undefined' && window.isSecureContext);
  const geolocation = options.geolocation === undefined
    ? (typeof navigator !== 'undefined' ? navigator.geolocation : null)
    : options.geolocation;

  if (!secureContext) {
    logLocation('REQUEST_SKIPPED', { reason: 'insecure_context' });
    return { location: null, permissionState: 'unknown', outcome: 'insecure' };
  }
  if (!geolocation) {
    logLocation('REQUEST_SKIPPED', { reason: 'unavailable' });
    return { location: null, permissionState: 'unknown', outcome: 'unavailable' };
  }

  let permissionState: PermissionState | 'unknown' = 'unknown';
  try {
    permissionState = options.queryPermission
      ? await options.queryPermission()
      : await queryBrowserLocationPermission();
  } catch {
    permissionState = 'unknown';
  }
  logLocation('PERMISSION_STATE', { state: permissionState });
  if (permissionState === 'denied') {
    try { storage?.removeItem('surface-location'); } catch { /* storage is optional */ }
    return { location: null, permissionState, outcome: 'denied' };
  }

  logLocation('REQUEST_START', { timeoutMs: SURFACE_LOCATION_TIMEOUT_MS, maximumAgeMs: SURFACE_LOCATION_MAXIMUM_AGE_MS });
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      logLocation('REQUEST_FAILED', { errorType: 'timeout' });
      finish({ location: null, permissionState, outcome: 'timeout' });
    }, SURFACE_LOCATION_TIMEOUT_MS + 1000);
    const finish = (result: SurfaceLocationResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };
    try {
      geolocation.getCurrentPosition((position) => {
        const timestamp = Number.isFinite(position.timestamp) && position.timestamp > 0 ? position.timestamp : now();
        const location: SurfaceLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timestamp,
          accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : undefined,
        };
        if (!validCoordinates(location)) {
          logLocation('REQUEST_FAILED', { errorType: 'invalid_coordinates' });
          finish({ location: null, permissionState, outcome: 'error' });
          return;
        }
        let persisted = false;
        try {
          storage?.setItem('surface-location', JSON.stringify(location));
          persisted = Boolean(storage);
        } catch { /* IndexedDB capture metadata remains the source of truth */ }
        const ageMs = Math.max(0, now() - timestamp);
        logLocation('REQUEST_SUCCESS', { accuracyMeters: location.accuracy ?? null, ageMs, persisted });
        finish({ location, permissionState, outcome: 'success' });
      }, (error) => {
        const outcome = error.code === error.PERMISSION_DENIED ? 'denied' : error.code === error.TIMEOUT ? 'timeout' : 'error';
        if (outcome === 'denied') {
          try { storage?.removeItem('surface-location'); } catch { /* storage is optional */ }
        }
        logLocation('REQUEST_FAILED', { errorCode: error.code, errorType: outcome });
        finish({ location: null, permissionState: outcome === 'denied' ? 'denied' : permissionState, outcome });
      }, {
        enableHighAccuracy: true,
        maximumAge: SURFACE_LOCATION_MAXIMUM_AGE_MS,
        timeout: SURFACE_LOCATION_TIMEOUT_MS,
      });
    } catch (error) {
      logLocation('REQUEST_FAILED', { errorType: error instanceof Error ? error.name : 'unknown' });
      finish({ location: null, permissionState, outcome: 'error' });
    }
  });
}

export function isRecentSurfaceLocation(value: SurfaceLocation | null | undefined, now = Date.now()): value is SurfaceLocation {
  if (!value || !validCoordinates(value)) return false;
  const age = now - value.timestamp;
  return age >= -30000 && age <= SURFACE_LOCATION_MAX_AGE_MS;
}

export function snapshotSurfaceLocation(value: SurfaceLocation | null | undefined, capturedAt: number): SurfaceLocation | null {
  return isRecentSurfaceLocation(value, capturedAt) ? { ...value } : null;
}

function readCachedSurfaceLocation(now = Date.now(), storageOverride?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null): SurfaceLocation | null {
  try {
    const storage = storageOverride === undefined ? getBrowserStorage() : storageOverride;
    const value = JSON.parse(storage?.getItem('surface-location') ?? 'null') as SurfaceLocation | null;
    return isRecentSurfaceLocation(value, now) ? value : null;
  } catch { return null; }
}

function validCoordinates(value: Partial<SurfaceLocation>): value is SurfaceLocation {
  return Number.isFinite(value.latitude) && value.latitude! >= -90 && value.latitude! <= 90 &&
    Number.isFinite(value.longitude) && value.longitude! >= -180 && value.longitude! <= 180 &&
    Number.isFinite(value.timestamp);
}

function getBrowserStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

async function queryBrowserLocationPermission(): Promise<PermissionState> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'prompt';
  const result = await navigator.permissions.query({ name: 'geolocation' });
  return result.state;
}

function logLocation(stage: string, details: Record<string, unknown>) {
  console.info('[SurfaceLocation]', { stage, ...details });
}
