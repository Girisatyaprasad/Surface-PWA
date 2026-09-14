import { describe, expect, it } from 'vitest';
import { buildMemberAnalyticsSnapshot, validateMemberAnalyticsSnapshot } from './snapshot';
import type { Note, Pin } from '../db';
import type { SurfaceMedia } from '../media';

const now = Date.parse('2026-09-14T12:00:00.000Z');
const created = (overrides: Partial<Pin> = {}): Pin => ({
  id: 'private-pin-id', name: 'Private Name', phone: '9876543210', about: 'private text',
  createdAt: now - 2_000, updatedAt: now - 2_000, followUpAt: null, followUpReason: 'private reminder', ...overrides,
});

describe('member analytics snapshot V1', () => {
  it('emits only aggregate fields and never copies private record values', () => {
    const snapshot = buildMemberAnalyticsSnapshot(
      [created({ latitude: 16.8, longitude: 80.8 } as unknown as Partial<Pin>)],
      [{ id: 'private-note-id', name: 'Ravi', phone: '9876543210', body: 'secret note', createdAt: now, updatedAt: now } as Note],
      [{ id: 'private-media-id', original: new Blob(), processed: new Blob(), originalPath: 'private/url', createdAt: now, dateKey: '', timeLabel: '', capture: true } as SurfaceMedia],
      [{ day: '2026-09-14', activityCount: 3, peopleAdded: 0, notesCreated: 0, capturesCreated: 0 }], now,
    );
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of ['private-pin-id', '9876543210', 'Private Name', 'private reminder', 'secret note', 'private/url', '16.8', '80.8', 'uid', 'organizationId']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(snapshot).toMatchObject({ analyticsVersion: 1, peopleAdded: 1, notesCreated: 1, capturesCreated: 1, activePins: 1, eventsCreated: 0 });
    expect(snapshot.activityByDay[0].activityCount).toBeGreaterThan(0);
  });

  it('uses only supported follow-up semantics and never invents completed/stage/event data', () => {
    const snapshot = buildMemberAnalyticsSnapshot([
      created({ followUpAt: now - 1000 }),
      created({ id: 'future', followUpAt: now + 1000 }),
      created({ id: 'archived', deletedAt: now, followUpAt: now - 1000 }),
    ], [], [], [], now);
    expect(snapshot.followupsDue).toBe(2);
    expect(snapshot.followupsMissed).toBe(1);
    expect(snapshot.followupsCompleted).toBe(0);
    expect(snapshot.relationshipStageCounts).toEqual({});
    expect(snapshot.eventsCreated).toBe(0);
    expect(snapshot.sourceStatus).toEqual({ followupCompletion: 'unsupported', relationshipStages: 'unsupported', events: 'unsupported' });
  });

  it('defines stale people and deterministic consistency from the rolling 30 UTC days', () => {
    const staleAt = now - 31 * 86_400_000;
    const snapshot = buildMemberAnalyticsSnapshot([
      created({ id: 'stale', createdAt: staleAt - 1000, updatedAt: staleAt }),
      created({ id: 'recent', createdAt: now - 2000, updatedAt: now - 2000 }),
    ], [], [], [{ day: '2026-09-14', activityCount: 2, peopleAdded: 0, notesCreated: 0, capturesCreated: 0 }], now);
    expect(snapshot.stalePeopleCount).toBe(1);
    expect(snapshot.eligibleDays).toBe(30);
    expect(snapshot.activeDays).toBe(1);
    expect(snapshot.consistencyScore).toBe(3);
    expect(snapshot.periodStart).toBe(Date.parse('2026-08-16T00:00:00.000Z'));
  });

  it('rejects unexpected fields, spoofed identity, arbitrary strings, and inconsistent totals', () => {
    const snapshot = buildMemberAnalyticsSnapshot([], [], [], [], now);
    expect(() => validateMemberAnalyticsSnapshot({ ...snapshot, uid: 'spoofed' }, now)).toThrow(/unexpected fields/i);
    expect(() => validateMemberAnalyticsSnapshot({ ...snapshot, organizationId: 'spoofed' }, now)).toThrow(/unexpected fields/i);
    expect(() => validateMemberAnalyticsSnapshot({ ...snapshot, contactName: 'private' }, now)).toThrow(/unexpected fields/i);
    expect(() => validateMemberAnalyticsSnapshot({ ...snapshot, peopleAdded: -1 }, now)).toThrow(/bounded/i);
    expect(() => validateMemberAnalyticsSnapshot({ ...snapshot, eventsCreated: 1 }, now)).toThrow(/unsupported/i);
    expect(() => validateMemberAnalyticsSnapshot({ ...snapshot, followupsDue: 1 }, now)).toThrow(/daily activity/i);
  });

  it('normalizes and validates the allowed snapshot structure', () => {
    const snapshot = buildMemberAnalyticsSnapshot([], [], [], [], now);
    expect(validateMemberAnalyticsSnapshot(snapshot, now)).toEqual(snapshot);
  });
});
