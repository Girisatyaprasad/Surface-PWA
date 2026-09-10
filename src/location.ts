export type SurfaceLocation = { latitude: number; longitude: number; timestamp: number; locality?: string; district?: string; state?: string };

export function formatSurfaceLocation(value?: Partial<SurfaceLocation> | null): string {
  if (!value) return '';
  const parts = [value.locality, value.district, value.state].filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
  return [...new Set(parts.map((part) => part.trim()))].join(', ');
}

export function readSurfaceLocation(): SurfaceLocation | null {
  try { const value = JSON.parse(localStorage.getItem('surface-location') ?? 'null') as SurfaceLocation | null; return value && Number.isFinite(value.latitude) && Number.isFinite(value.longitude) ? value : null; } catch { return null; }
}
