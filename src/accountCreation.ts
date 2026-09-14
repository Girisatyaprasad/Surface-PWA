import { createUserWithEmailAndPassword, type Auth } from 'firebase/auth';
import { doc, getDoc, setDoc, Timestamp, type Firestore } from 'firebase/firestore';
import { isValidRecoveryEmail, normalizeRecoveryEmail } from './passwordRecovery';

export interface SignupInput {
  email: string;
  password: string;
  confirmPassword: string;
}

export interface SignupUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export type SignupResult =
  | { status: 'created'; user: SignupUser }
  | { status: 'profile-setup-failed'; user: SignupUser }
  | { status: 'invalid-email' | 'weak-password' | 'password-mismatch' | 'email-in-use' | 'network-error' | 'too-many-requests' | 'unavailable' | 'failed' | 'busy' };

export function signupDestination(result: SignupResult): 'surface' | 'create-account' {
  return result.status === 'created' || result.status === 'profile-setup-failed' ? 'surface' : 'create-account';
}

export interface AccountCreationGateway {
  createAuthUser(email: string, password: string): Promise<SignupUser>;
  ensureUserDocument(user: SignupUser): Promise<void>;
}

export function validateSignup(input: SignupInput): SignupResult | null {
  const email = normalizeRecoveryEmail(input.email);
  if (!isValidRecoveryEmail(email)) return { status: 'invalid-email' };
  if (input.password.length < 6) return { status: 'weak-password' };
  if (input.password !== input.confirmPassword) return { status: 'password-mismatch' };
  return null;
}

export function signupErrorMessage(result: SignupResult): string {
  switch (result.status) {
    case 'invalid-email': return 'Enter a valid email address.';
    case 'weak-password': return 'Choose a password with at least 6 characters.';
    case 'password-mismatch': return 'Passwords do not match.';
    case 'email-in-use': return 'An account already exists for this email. Sign in or reset your password.';
    case 'network-error': return 'You appear to be offline. Check your connection and try again.';
    case 'too-many-requests': return 'Too many attempts. Please wait a little and try again.';
    case 'unavailable': return 'Account creation is temporarily unavailable. Please try again later.';
    case 'profile-setup-failed': return 'Your account was created, but profile setup is still pending. Surface opened with Free access.';
    case 'failed': return 'Account could not be created. Please try again.';
    case 'busy': return 'Account creation is already in progress.';
    case 'created': return '';
  }
}

function authErrorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'unknown';
}

function mapSignupError(error: unknown): SignupResult {
  switch (authErrorCode(error)) {
    case 'auth/invalid-email': return { status: 'invalid-email' };
    case 'auth/weak-password': return { status: 'weak-password' };
    case 'auth/password-does-not-meet-requirements': return { status: 'weak-password' };
    case 'auth/email-already-in-use': return { status: 'email-in-use' };
    case 'auth/network-request-failed': return { status: 'network-error' };
    case 'auth/too-many-requests': return { status: 'too-many-requests' };
    case 'auth/operation-not-allowed': return { status: 'unavailable' };
    default: return { status: 'failed' };
  }
}

export function createAccountCreationService(gateway: AccountCreationGateway) {
  let submitting = false;
  return {
    async create(input: SignupInput): Promise<SignupResult> {
      const validationError = validateSignup(input);
      if (validationError) return validationError;
      if (submitting) return { status: 'busy' };

      submitting = true;
      try {
        const user = await gateway.createAuthUser(normalizeRecoveryEmail(input.email), input.password);
        try {
          await gateway.ensureUserDocument(user);
          return { status: 'created', user };
        } catch {
          return { status: 'profile-setup-failed', user };
        }
      } catch (error) {
        return mapSignupError(error);
      } finally {
        submitting = false;
      }
    },
  };
}

export function surfaceUserDocument(user: SignupUser, now: Timestamp = Timestamp.now()): Record<string, unknown> {
  return {
    email: user.email ?? '',
    displayName: user.displayName,
    phoneNumber: null,
    proStatus: 'UNPAID',
    planId: null,
    activatedAt: null,
    expiresAt: null,
    lastValidatedAt: now,
    createdAt: now,
  };
}

export async function createSurfaceUserDocumentIfMissing(
  user: SignupUser,
  exists: () => Promise<boolean>,
  write: (data: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  if (await exists()) return;
  await write(surfaceUserDocument(user));
}

export function createFirebaseAccountCreationService(auth: Auth, firestore: Firestore) {
  return createAccountCreationService({
    async createAuthUser(email, password) {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      return credential.user;
    },
    async ensureUserDocument(user) {
      const userRef = doc(firestore, 'users', user.uid);
      await createSurfaceUserDocumentIfMissing(
        user,
        async () => (await getDoc(userRef)).exists(),
        async (data) => { await setDoc(userRef, data); },
      );
    },
  });
}
