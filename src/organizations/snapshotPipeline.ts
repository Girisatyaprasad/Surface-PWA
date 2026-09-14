import { getSurfaceFirebase } from '../firebase';
import { dueAnalyticsSnapshots, listLocalAnalyticsActivity, queueAnalyticsSnapshot, recordLocalAnalyticsActivity, removeAnalyticsSnapshot, retryAnalyticsSnapshot, listNotes, listPins } from '../db';
import { listMedia } from '../media';
import { buildMemberAnalyticsSnapshot, validateMemberAnalyticsSnapshot, type MemberAnalyticsSnapshotV1 } from './snapshot';
import { isLegacyMigrationInProgress } from '../legacyRecovery';
import { scheduleClientIis, startClientIisPipeline } from './iisPipeline';

const DEBOUNCE_MS = 30_000;
const RETRY_INTERVAL_MS = 60_000;
const apiBase = () => (import.meta.env.VITE_SURFACE_API_BASE_URL ?? 'https://surface-payments.onrender.com').replace(/\/+$/, '');
let debounceTimer: number | undefined;
let retryTimer: number | undefined;
let started = false;
let activeFlush: Promise<void> | null = null;

export async function recordSurfaceAnalyticsActivity(uid: string, kind: 'pin_created' | 'pin_updated' | 'followup_activity' | 'note_created' | 'capture_created'): Promise<void> {
  try {
    const auth = getSurfaceFirebase().auth;
    if (!uid || auth.currentUser?.uid !== uid || !await analyticsAllowed(uid)) return;
    const now = Date.now();
    await recordLocalAnalyticsActivity(uid, kind, now);
    if (auth.currentUser?.uid === uid && await analyticsAllowed(uid)) {
      await scheduleMemberSnapshot(uid, now);
      scheduleClientIis(uid);
    }
  } catch {
    logAnalytics('LOCAL_ACTIVITY_WRITE_FAILED', 'local_storage');
  }
}

export async function scheduleMemberSnapshot(uid: string, now = Date.now()): Promise<void> {
  if (!await analyticsAllowed(uid)) return;
  await queueAnalyticsSnapshot(uid, now + DEBOUNCE_MS);
  if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => { void flushDueSnapshots(); }, DEBOUNCE_MS + 25);
}

export function startSurfaceAnalyticsPipeline(): () => void {
  if (started) return () => undefined;
  started = true;
  const stopIisPipeline = startClientIisPipeline();
  const flush = () => { void flushDueSnapshots(); };
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', flush);
  retryTimer = window.setInterval(flush, RETRY_INTERVAL_MS);
  return () => {
    started = false;
    window.removeEventListener('online', flush);
    document.removeEventListener('visibilitychange', flush);
    if (retryTimer !== undefined) window.clearInterval(retryTimer);
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
    retryTimer = undefined;
    debounceTimer = undefined;
    stopIisPipeline();
  };
}

export async function queueInitialMemberSnapshot(uid: string): Promise<void> {
  if (!uid || getSurfaceFirebase().auth.currentUser?.uid !== uid || !await analyticsAllowed(uid)) return;
  await queueAnalyticsSnapshot(uid, Date.now());
  void flushDueSnapshots();
  scheduleClientIis(uid, 0);
}

export async function flushDueSnapshots(now = Date.now()): Promise<void> {
  if (activeFlush) return activeFlush;
  activeFlush = flushSnapshots(now).finally(() => { activeFlush = null; });
  return activeFlush;
}

async function flushSnapshots(now: number): Promise<void> {
  if (navigator.onLine === false) return;
  let due;
  const activeUid = getSurfaceFirebase().auth.currentUser?.uid;
  if (!activeUid || !await analyticsAllowed(activeUid)) return;
  try { due = await dueAnalyticsSnapshots(activeUid, now); } catch { logAnalytics('OUTBOX_READ_FAILED', 'local_storage'); return; }
  for (const pending of due) {
    const auth = getSurfaceFirebase().auth;
    const user = auth.currentUser;
    if (!user || user.uid !== activeUid || user.uid !== pending.ownerUid || !await analyticsAllowed(user.uid)) continue;
    try {
      const snapshot = await buildCurrentSnapshot(user.uid, now);
      if (auth.currentUser?.uid !== user.uid) continue;
      const validated = validateMemberAnalyticsSnapshot(snapshot, now);
      const token = await user.getIdToken();
      if (auth.currentUser?.uid !== user.uid) continue;
      const response = await fetch(`${apiBase()}/analytics/member-snapshot`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(validated),
      });
      if (auth.currentUser?.uid !== user.uid) continue;
      if (response.ok) {
        await removeAnalyticsSnapshot(user.uid);
        logAnalytics('SNAPSHOT_ACCEPTED', 'ok');
        continue;
      }
      const error = await safeErrorCode(response);
      if (response.status === 403 && error === 'not_organization_member') {
        await removeAnalyticsSnapshot(user.uid);
        logAnalytics('SNAPSHOT_NOT_ELIGIBLE', 'not_organization_member');
        continue;
      }
      if (response.status >= 400 && response.status < 500) {
        await removeAnalyticsSnapshot(user.uid);
        logAnalytics('SNAPSHOT_REJECTED', error);
        continue;
      }
      await retryAnalyticsSnapshot(user.uid, pending, now);
      logAnalytics('SNAPSHOT_RETRY_SCHEDULED', 'service_unavailable');
    } catch {
      if (auth.currentUser?.uid !== user.uid) continue;
      try { await retryAnalyticsSnapshot(user.uid, pending, now); } catch { /* local analytics must never block Surface */ }
      logAnalytics('SNAPSHOT_RETRY_SCHEDULED', 'network_or_local_failure');
    }
  }
}

async function buildCurrentSnapshot(uid: string, at: number): Promise<MemberAnalyticsSnapshotV1> {
  const auth = getSurfaceFirebase().auth;
  if (!uid || auth.currentUser?.uid !== uid || !await analyticsAllowed(uid)) throw new Error('Analytics workspace unavailable.');
  const [pins, notes, media, activity] = await Promise.all([
    listPins(uid), listNotes(uid), listMedia(uid),
    listLocalAnalyticsActivity(uid, new Date(at - 30 * 86_400_000).toISOString().slice(0, 10), new Date(at).toISOString().slice(0, 10)),
  ]);
  if (auth.currentUser?.uid !== uid || !await analyticsAllowed(uid)) throw new Error('Analytics workspace changed during read.');
  return buildMemberAnalyticsSnapshot(pins, notes, media, activity, at);
}

async function analyticsAllowed(uid: string): Promise<boolean> {
  try { return !await isLegacyMigrationInProgress(uid); }
  catch { return false; }
}

async function safeErrorCode(response: Response): Promise<string> {
  try {
    const body = await response.json() as { code?: unknown };
    return typeof body.code === 'string' && /^[A-Z_]{2,48}$/.test(body.code) ? body.code.toLowerCase() : 'request_rejected';
  } catch { return 'request_rejected'; }
}

function logAnalytics(stage: string, category: string): void {
  console.info('[SurfaceAnalytics]', { stage, category });
}
