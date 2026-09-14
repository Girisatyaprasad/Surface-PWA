import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  createAccountCreationService,
  createSurfaceUserDocumentIfMissing,
  signupDestination,
  signupErrorMessage,
  surfaceUserDocument,
  validateSignup,
  type AccountCreationGateway,
  type SignupInput,
  type SignupUser,
} from './accountCreation';

const user: SignupUser = { uid: 'surface-uid', email: 'new@example.com', displayName: null };
const validInput: SignupInput = { email: ' NEW@example.com ', password: 'secure-pass', confirmPassword: 'secure-pass' };

function gateway(overrides: Partial<AccountCreationGateway> = {}) {
  return {
    createAuthUser: vi.fn(async () => user),
    ensureUserDocument: vi.fn(async () => undefined),
    ...overrides,
  } satisfies AccountCreationGateway;
}

describe('Surface account creation', () => {
  it('creates the Auth user, initializes their document, and returns the signed-in user for direct Surface entry', async () => {
    const api = gateway();
    const result = await createAccountCreationService(api).create(validInput);

    expect(api.createAuthUser).toHaveBeenCalledWith('new@example.com', 'secure-pass');
    expect(api.ensureUserDocument).toHaveBeenCalledWith(user);
    expect(result).toEqual({ status: 'created', user });
    expect(signupDestination(result)).toBe('surface');
  });

  it.each([
    [{ ...validInput, email: 'not-an-email' }, 'invalid-email'],
    [{ ...validInput, password: '123', confirmPassword: '123' }, 'weak-password'],
    [{ ...validInput, confirmPassword: 'different-password' }, 'password-mismatch'],
  ] as const)('validates signup input before contacting Firebase', async (input, status) => {
    const api = gateway();
    const result = await createAccountCreationService(api).create(input);
    expect(result).toEqual({ status });
    expect(api.createAuthUser).not.toHaveBeenCalled();
  });

  it('maps duplicate email, network, and rate-limit errors to safe categories', async () => {
    const duplicate = createAccountCreationService(gateway({ createAuthUser: async () => { throw { code: 'auth/email-already-in-use' }; } }));
    const offline = createAccountCreationService(gateway({ createAuthUser: async () => { throw { code: 'auth/network-request-failed' }; } }));
    const limited = createAccountCreationService(gateway({ createAuthUser: async () => { throw { code: 'auth/too-many-requests' }; } }));

    expect(await duplicate.create(validInput)).toEqual({ status: 'email-in-use' });
    expect(signupErrorMessage({ status: 'email-in-use' })).toContain('already exists');
    expect(await offline.create(validInput)).toEqual({ status: 'network-error' });
    expect(await limited.create(validInput)).toEqual({ status: 'too-many-requests' });
  });

  it('prevents concurrent duplicate submissions', async () => {
    let finish!: (value: SignupUser) => void;
    const api = gateway({ createAuthUser: vi.fn(() => new Promise<SignupUser>((resolve) => { finish = resolve; })) });
    const service = createAccountCreationService(api);

    const first = service.create(validInput);
    expect(await service.create(validInput)).toEqual({ status: 'busy' });
    finish(user);
    expect(await first).toEqual({ status: 'created', user });
    expect(api.createAuthUser).toHaveBeenCalledTimes(1);
  });

  it('creates the canonical user fields with Free entitlement and no paid plan', () => {
    const now = Timestamp.fromMillis(1234);
    expect(surfaceUserDocument(user, now)).toEqual({
      email: 'new@example.com',
      displayName: null,
      phoneNumber: null,
      proStatus: 'UNPAID',
      planId: null,
      activatedAt: null,
      expiresAt: null,
      lastValidatedAt: now,
      createdAt: now,
    });
  });

  it('does not overwrite an existing users/{uid} document', async () => {
    const write = vi.fn(async () => undefined);
    await createSurfaceUserDocumentIfMissing(user, async () => true, write);
    expect(write).not.toHaveBeenCalled();
  });

  it('preserves the Auth account and reports profile initialization failure without claiming success', async () => {
    const api = gateway({ ensureUserDocument: async () => { throw new Error('permission-denied'); } });
    const result = await createAccountCreationService(api).create(validInput);
    expect(result).toEqual({ status: 'profile-setup-failed', user });
    expect(signupDestination(result)).toBe('surface');
    expect(signupErrorMessage(result)).toContain('profile setup is still pending');
  });
});
