import { describe, expect, it, vi } from 'vitest';
import type { Auth } from 'firebase/auth';
import {
  PASSWORD_RESET_CONTINUE_URL,
  PASSWORD_RESET_SUCCESS_MESSAGE,
  consumePasswordResetReturn,
  createPasswordResetService,
  normalizeRecoveryEmail,
  passwordResetResultMessage,
} from './passwordRecovery';

const auth = {} as Auth;

describe('password recovery', () => {
  it('rejects malformed email without calling Firebase', async () => {
    const send = vi.fn(async () => undefined);
    const service = createPasswordResetService(send as never);

    expect(normalizeRecoveryEmail('  NOT-AN-EMAIL  ')).toBe('not-an-email');
    expect(await service.request(auth, 'not-an-email')).toEqual({ status: 'invalid-email' });
    expect(send).not.toHaveBeenCalled();
  });

  it('normalizes email and sends through the production Firebase hosted action flow', async () => {
    const send = vi.fn(async () => undefined);
    const service = createPasswordResetService(send as never, () => 1000);

    const result = await service.request(auth, '  Surface.User@Example.COM  ');

    expect(send).toHaveBeenCalledWith(auth, 'surface.user@example.com', { url: PASSWORD_RESET_CONTINUE_URL });
    expect(result).toEqual({ status: 'accepted', retryAt: 61_000 });
    expect(passwordResetResultMessage(result)).toBe(PASSWORD_RESET_SUCCESS_MESSAGE);
  });

  it('returns privacy-preserving success for Firebase user-not-found', async () => {
    const service = createPasswordResetService(async () => { throw { code: 'auth/user-not-found' }; }, () => 0);
    const result = await service.request(auth, 'nobody@example.com');

    expect(result.status).toBe('accepted');
    expect(passwordResetResultMessage(result)).toBe(PASSWORD_RESET_SUCCESS_MESSAGE);
  });

  it('maps offline/network failures and rate limits safely', async () => {
    const network = createPasswordResetService(async () => { throw { code: 'auth/network-request-failed' }; });
    expect((await network.request(auth, 'person@example.com')).status).toBe('network-error');

    const limited = createPasswordResetService(async () => { throw { code: 'auth/too-many-requests' }; }, () => 500);
    expect(await limited.request(auth, 'person@example.com')).toEqual({ status: 'rate-limited', retryAt: 60_500 });
  });

  it('blocks duplicate submissions and applies a resend cooldown', async () => {
    let finish!: () => void;
    let now = 100;
    const send = vi.fn(() => send.mock.calls.length === 1
      ? new Promise<void>((resolve) => { finish = resolve; })
      : Promise.resolve());
    const service = createPasswordResetService(send as never, () => now);

    const first = service.request(auth, 'person@example.com');
    expect(await service.request(auth, 'person@example.com')).toEqual({ status: 'busy' });
    finish();
    const accepted = await first;
    expect(accepted).toEqual({ status: 'accepted', retryAt: 60_100 });
    expect(await service.request(auth, 'person@example.com')).toEqual({ status: 'cooldown', retryAt: 60_100 });
    now = 60_100;
    expect((await service.request(auth, 'person@example.com')).status).toBe('accepted');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('consumes the reset-return marker without discarding other URL state', () => {
    const replaceState = vi.fn();
    const location = { href: 'https://surface-pwa.web.app/?passwordReset=complete&keep=1#/home' } as Location;
    expect(consumePasswordResetReturn(location, { replaceState } as unknown as History)).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?keep=1#/home');
    expect(consumePasswordResetReturn({ href: 'https://surface-pwa.web.app/' } as Location, { replaceState } as unknown as History)).toBe(false);
  });
});
