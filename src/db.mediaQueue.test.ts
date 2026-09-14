import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { dueSyncOperations, listSyncOperations, MediaSyncQueueFullError, queueMediaOperation, retryPinOperation, type SyncOperation } from './db';

function upload(id: string): Omit<SyncOperation, 'attempts' | 'nextAttemptAt'> {
  return { id: `media:${id}`, kind: 'UPSERT_MEDIA', pinId: id, payload: { id } };
}

describe('bounded UID-owned media retry queue', () => {
  it('caps newly queued uploads without deleting existing local retry work', async () => {
    const uid = `queue-cap-${crypto.randomUUID()}`;
    await queueMediaOperation(uid, upload('one'), 1);
    await expect(queueMediaOperation(uid, upload('two'), 1)).rejects.toBeInstanceOf(MediaSyncQueueFullError);
    expect((await listSyncOperations(uid)).map((operation) => operation.id)).toEqual(['media:one']);
  });

  it('deduplicates retries for the same media record while the queue is at capacity', async () => {
    const uid = `queue-dedupe-${crypto.randomUUID()}`;
    await queueMediaOperation(uid, upload('same'), 1);
    await queueMediaOperation(uid, { ...upload('same'), payload: { id: 'same', revision: 2 } }, 1);
    const entries = await listSyncOperations(uid);
    expect(entries).toHaveLength(1);
    expect(entries[0].payload).toEqual({ id: 'same', revision: 2 });
  });

  it('bounds queued image bytes as well as queued item count', async () => {
    const uid = `queue-bytes-${crypto.randomUUID()}`;
    const oversized = { ...upload('large'), payload: { original: new Blob(['123456']), processed: new Blob(['123456']) } };
    await expect(queueMediaOperation(uid, oversized, 5, 10)).rejects.toBeInstanceOf(MediaSyncQueueFullError);
    expect(await listSyncOperations(uid)).toHaveLength(0);
  });

  it('returns only retry operations whose backoff has elapsed', async () => {
    const uid = `queue-due-${crypto.randomUUID()}`;
    await queueMediaOperation(uid, upload('later'));
    const operation = (await listSyncOperations(uid))[0];
    await retryPinOperation(uid, operation, 'offline');
    expect(await dueSyncOperations(uid)).toHaveLength(0);
    expect(await dueSyncOperations(uid, Date.now() + 60_000)).toHaveLength(1);
  });
});
