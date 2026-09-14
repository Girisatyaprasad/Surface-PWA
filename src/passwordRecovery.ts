import { sendPasswordResetEmail, type ActionCodeSettings, type Auth } from 'firebase/auth';

export const PASSWORD_RESET_CONTINUE_URL = 'https://surface-pwa.web.app/?passwordReset=complete';
export const PASSWORD_RESET_SUCCESS_MESSAGE = 'If an account exists for this email, a password reset link has been sent. Check Inbox and Spam.';
export const PASSWORD_RESET_COOLDOWN_MS = 60_000;

export type PasswordResetResult =
  | { status: 'accepted'; retryAt: number }
  | { status: 'invalid-email' }
  | { status: 'busy' }
  | { status: 'cooldown'; retryAt: number }
  | { status: 'network-error' }
  | { status: 'rate-limited'; retryAt: number }
  | { status: 'configuration-error' }
  | { status: 'failed' };

export function passwordResetResultMessage(result: PasswordResetResult): string {
  switch (result.status) {
    case 'accepted': return PASSWORD_RESET_SUCCESS_MESSAGE;
    case 'invalid-email': return 'Enter a valid email address.';
    case 'busy': return 'A reset request is already in progress.';
    case 'cooldown': return 'Please wait before requesting another reset link.';
    case 'rate-limited': return 'Too many requests. Please wait before trying again.';
    case 'network-error': return 'You appear to be offline. Check your connection and try again.';
    case 'configuration-error': return 'Password recovery is temporarily unavailable. Please try again later.';
    case 'failed': return 'Password reset could not be requested. Please try again later.';
  }
}

type ResetSender = (auth: Auth, email: string, settings: ActionCodeSettings) => Promise<void>;

export function normalizeRecoveryEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidRecoveryEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function firebaseCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'unknown';
}

function diagnostic(stage: string, code: string): void {
  if (!import.meta.env.DEV) return;
  console.info('[SurfacePasswordRecovery]', {
    stage,
    code,
    hostname: typeof window === 'undefined' ? 'unavailable' : window.location.hostname,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'unavailable',
    online: typeof navigator === 'undefined' ? null : navigator.onLine,
  });
}

export function createPasswordResetService(
  send: ResetSender = sendPasswordResetEmail,
  now: () => number = Date.now,
) {
  const active = new WeakSet<Auth>();
  const cooldowns = new WeakMap<Auth, number>();

  return {
    async request(auth: Auth, rawEmail: string): Promise<PasswordResetResult> {
      const email = normalizeRecoveryEmail(rawEmail);
      if (!isValidRecoveryEmail(email)) return { status: 'invalid-email' };
      if (active.has(auth)) return { status: 'busy' };
      const existingCooldown = cooldowns.get(auth) ?? 0;
      if (existingCooldown > now()) return { status: 'cooldown', retryAt: existingCooldown };
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'network-error' };

      active.add(auth);
      diagnostic('REQUEST_START', 'none');
      try {
        await send(auth, email, { url: PASSWORD_RESET_CONTINUE_URL });
        const retryAt = now() + PASSWORD_RESET_COOLDOWN_MS;
        cooldowns.set(auth, retryAt);
        diagnostic('REQUEST_ACCEPTED', 'none');
        return { status: 'accepted', retryAt };
      } catch (error) {
        const code = firebaseCode(error);
        diagnostic('REQUEST_FAILED', code);
        if (code === 'auth/user-not-found' || code === 'auth/email-not-found') {
          const retryAt = now() + PASSWORD_RESET_COOLDOWN_MS;
          cooldowns.set(auth, retryAt);
          return { status: 'accepted', retryAt };
        }
        if (code === 'auth/too-many-requests') {
          const retryAt = now() + PASSWORD_RESET_COOLDOWN_MS;
          cooldowns.set(auth, retryAt);
          return { status: 'rate-limited', retryAt };
        }
        if (code === 'auth/network-request-failed') return { status: 'network-error' };
        if (code === 'auth/unauthorized-continue-uri' || code === 'auth/invalid-continue-uri' || code === 'auth/invalid-api-key' || code === 'auth/operation-not-allowed') {
          return { status: 'configuration-error' };
        }
        return { status: 'failed' };
      } finally {
        active.delete(auth);
      }
    },
  };
}

export const passwordResetService = createPasswordResetService();

export function consumePasswordResetReturn(location: Location, history: History): boolean {
  const url = new URL(location.href);
  if (url.searchParams.get('passwordReset') !== 'complete') return false;
  url.searchParams.delete('passwordReset');
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  return true;
}
