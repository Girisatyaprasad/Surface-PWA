import { getSurfaceFirebase } from '../firebase';
import { dueIisInsights, markIisStateSubmitted, pendingIisStateKeys, queueIisInsight, removeIisInsight, retryIisInsight, wasIisStateSubmitted } from '../db';
import { isLegacyMigrationInProgress } from '../legacyRecovery';
import { requireWorkspaceUid } from '../localWorkspace';
import { deriveUidWorkspaceIisInsights } from './iis';
import { onAuthStateChanged } from 'firebase/auth';

const DEBOUNCE_MS = 30_000;
const RETRY_MS = 60_000;
const apiBase = () => (import.meta.env.VITE_SURFACE_API_BASE_URL ?? 'https://surface-payments.onrender.com').replace(/\/+$/, '');
let debounceTimer: number | undefined;
let retryTimer: number | undefined;
let started = false;
let activeFlush: Promise<void> | null = null;
let scheduledUid: string | null = null;
let activeController: AbortController | null = null;
let activeUid: string | null = null;

export function scheduleClientIis(uid: string, delay = DEBOUNCE_MS): void {
  let ownerUid: string;
  try { ownerUid = requireWorkspaceUid(uid); } catch { return; }
  if (getSurfaceFirebase().auth.currentUser?.uid !== ownerUid) return;
  scheduledUid = ownerUid;
  if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => { void recomputeAndFlush(ownerUid); }, delay);
}

export function startClientIisPipeline(): () => void {
  if (started) return () => undefined;
  started = true;
  const retry = () => {
    const uid = getSurfaceFirebase().auth.currentUser?.uid;
    if (uid) void recomputeAndFlush(uid);
  };
  window.addEventListener('online', retry);
  document.addEventListener('visibilitychange', retry);
  const unsubscribeAuth = onAuthStateChanged(getSurfaceFirebase().auth, (user) => {
    if (scheduledUid && scheduledUid !== user?.uid) {
      scheduledUid = null;
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    if (activeUid && activeUid !== user?.uid) {
      activeUid = null;
      activeController?.abort();
    }
  });
  retryTimer = window.setInterval(retry, RETRY_MS);
  return () => {
    started = false;
    scheduledUid = null;
    activeController?.abort();
    activeController = null;
    activeUid = null;
    unsubscribeAuth();
    window.removeEventListener('online', retry);
    document.removeEventListener('visibilitychange', retry);
    if (retryTimer !== undefined) window.clearInterval(retryTimer);
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
    retryTimer = undefined;
    debounceTimer = undefined;
  };
}

export async function recomputeAndFlush(uid: string, now = Date.now()): Promise<void> {
  if (activeFlush) return activeFlush;
  activeFlush = run(uid, now).finally(() => { activeFlush = null; });
  return activeFlush;
}

async function run(uid: string, now: number): Promise<void> {
  let ownerUid: string;
  try { ownerUid = requireWorkspaceUid(uid); } catch { return; }
  const auth = getSurfaceFirebase().auth;
  if (auth.currentUser?.uid !== ownerUid || await migrationBlocked(ownerUid)) return;
  try {
    const insights = await deriveUidWorkspaceIisInsights(ownerUid, now);
    if (auth.currentUser?.uid !== ownerUid || await migrationBlocked(ownerUid)) return;
    const known = new Set(await pendingIisStateKeys(ownerUid));
    for (const insight of insights) {
      const windowDays = Math.round((insight.periodEnd - insight.periodStart + 1) / 86_400_000);
      const stateKey = `${insight.insightCode}:${windowDays}`;
      const fingerprint = stateFingerprint(insight.insightCode, insight.evidenceMetrics);
      if (!known.has(stateKey) && await wasIisStateSubmitted(ownerUid, stateKey, fingerprint)) continue;
      await queueIisInsight(ownerUid, insight.insightId, stateKey, insight, now);
    }
  } catch {
    safeLog('LOCAL_ANALYSIS_SKIPPED');
    return;
  }
  if (auth.currentUser?.uid !== ownerUid || !navigator.onLine || await migrationBlocked(ownerUid)) return;
  let due;
  try { due = await dueIisInsights(ownerUid, now); } catch { safeLog('OUTBOX_READ_FAILED'); return; }
  for (const item of due) {
    const user: import('firebase/auth').User | null = auth.currentUser;
    if (!user || user.uid !== ownerUid || user.uid !== item.ownerUid || await migrationBlocked(ownerUid)) return;
    try {
      const token = await user.getIdToken();
      if (auth.currentUser?.uid !== ownerUid || await migrationBlocked(ownerUid)) return;
      const controller = new AbortController();
      activeController = controller;
      activeUid = ownerUid;
      const response = await fetch(`${apiBase()}/iis/insights`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ insights: [item.envelope] }),
        signal: controller.signal,
      });
      if (activeController === controller) {
        activeController = null;
        activeUid = null;
      }
      if (auth.currentUser?.uid !== ownerUid) return;
      if (response.ok) {
        await markIisStateSubmitted(ownerUid, item.stateKey, envelopeFingerprint(item.envelope, item.insightId), now);
        await removeIisInsight(ownerUid, item.insightId);
        safeLog('INSIGHT_ACCEPTED');
        continue;
      }
      if (response.status === 403 || (response.status >= 400 && response.status < 500)) {
        await removeIisInsight(ownerUid, item.insightId);
        safeLog(response.status === 403 ? 'NOT_ELIGIBLE' : 'INSIGHT_REJECTED');
        continue;
      }
      await retryIisInsight(ownerUid, item, now);
      safeLog('RETRY_SCHEDULED');
    } catch {
      activeController = null;
      activeUid = null;
      if (auth.currentUser?.uid !== ownerUid) return;
      try { await retryIisInsight(ownerUid, item, now); } catch { /* IIS must never block app use. */ }
      safeLog('RETRY_SCHEDULED');
    }
  }
}

async function migrationBlocked(uid: string): Promise<boolean> {
  try { return await isLegacyMigrationInProgress(uid); } catch { return true; }
}

function safeLog(stage: string): void {
  console.info('[SurfaceIIS]', { stage });
}

function stateFingerprint(code: string, metrics: Record<string, number>): string {
  const value = `${code}|${Object.entries(metrics).sort(([a], [b]) => a.localeCompare(b)).map(([key, metric]) => `${key}:${metric}`).join('|')}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function envelopeFingerprint(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object') return fallback;
  const envelope = value as { insightCode?: unknown; evidenceMetrics?: unknown };
  if (typeof envelope.insightCode !== 'string' || !envelope.evidenceMetrics || typeof envelope.evidenceMetrics !== 'object' || Array.isArray(envelope.evidenceMetrics)) return fallback;
  const metrics = envelope.evidenceMetrics as Record<string, unknown>;
  if (!Object.values(metrics).every((metric) => typeof metric === 'number' && Number.isFinite(metric))) return fallback;
  return stateFingerprint(envelope.insightCode, metrics as Record<string, number>);
}
