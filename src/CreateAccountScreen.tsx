import { useState } from 'react';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import {
  createFirebaseAccountCreationService,
  signupDestination,
  signupErrorMessage,
  type SignupUser,
} from './accountCreation';

export function CreateAccountScreen({
  auth,
  firestore,
  initialEmail,
  onBack,
  onCreated,
  onCreationStateChange,
}: {
  auth: Auth;
  firestore: Firestore;
  initialEmail: string;
  onBack: (email: string) => void;
  onCreated: (user: SignupUser, profileReady: boolean) => void;
  onCreationStateChange: (pending: boolean) => void;
}) {
  const [service] = useState(() => createFirebaseAccountCreationService(auth, firestore));
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setMessage('');
    onCreationStateChange(true);
    const result = await service.create({ email, password, confirmPassword });
    setLoading(false);
    if (signupDestination(result) === 'surface') {
      const account = result as Extract<typeof result, { user: SignupUser }>;
      onCreationStateChange(false);
      onCreated(account.user, result.status === 'created');
      return;
    }
    onCreationStateChange(false);
    setMessage(signupErrorMessage(result));
  };

  return <section className="signup-screen" aria-labelledby="signup-title">
    <h2 id="signup-title">Create account</h2>
    <p className="signup-intro">Create your Surface account to get started.</p>
    <form onSubmit={(event) => void submit(event)}>
      <input aria-label="Email" type="email" autoComplete="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={loading} />
      <input aria-label="Password" type="password" autoComplete="new-password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required disabled={loading} />
      <input aria-label="Confirm password" type="password" autoComplete="new-password" placeholder="Confirm password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={6} required disabled={loading} />
      <button type="submit" disabled={loading}>{loading ? 'Creating account…' : 'Create account'}</button>
    </form>
    {message && <p className="message" role="alert">{message}</p>}
    <button type="button" className="text-button signup-back" disabled={loading} onClick={() => onBack(email)}>Back to Sign In</button>
  </section>;
}
