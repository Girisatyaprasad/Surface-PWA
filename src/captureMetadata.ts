import { formatCoordinateGeotag, snapshotSurfaceLocation, type SurfaceLocation } from './location';

export type CameraCaptureMetadata = {
  capturedAt: number;
  location: SurfaceLocation | null;
  locationLabel: string;
};

export function snapshotCameraCaptureMetadata(location: SurfaceLocation | null | undefined, capturedAt: number): CameraCaptureMetadata {
  const snapshot = snapshotSurfaceLocation(location, capturedAt);
  return { capturedAt, location: snapshot, locationLabel: formatCoordinateGeotag(snapshot) };
}
