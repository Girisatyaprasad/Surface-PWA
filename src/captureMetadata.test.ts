import { describe, expect, it } from 'vitest';
import { snapshotCameraCaptureMetadata } from './captureMetadata';

describe('camera capture metadata snapshot', () => {
  it('freezes the current location and exact formatted label at shutter time', () => {
    const capturedAt = 100_000;
    const location = { latitude: 16.63063, longitude: 80.95389, timestamp: 99_500, accuracy: 2000 };
    expect(snapshotCameraCaptureMetadata(location, capturedAt)).toEqual({
      capturedAt,
      location,
      locationLabel: '16.63063° N · 80.95389° E · ±2000 m',
    });
  });

  it('does not attach stale or absent phone location to a picker-selected image', () => {
    expect(snapshotCameraCaptureMetadata(null, 100_000)).toMatchObject({ location: null, locationLabel: '' });
    expect(snapshotCameraCaptureMetadata({ latitude: 1, longitude: 2, timestamp: 1 }, 600_000)).toMatchObject({ location: null, locationLabel: '' });
  });
});
