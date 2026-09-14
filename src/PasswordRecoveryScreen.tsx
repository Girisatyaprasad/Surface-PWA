import { useEffect, useState, type FormEvent } from 'react';
import type { Auth } from 'firebase/auth';
import {
  passwordResetService,
  passwordResetResultMessage,
  type PasswordResetResult,
} from './passwordRecovery';

export function PasswordRecoveryScreen({ auth, initialEmail, onBack }: { auth: Auth; initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [loading, setLoading] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!retryAt) return;
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (loading || secondsLeft > 0) return;
    setLoading(true);
    setMessage('');
    try {
      const result: PasswordResetResult = await passwordResetService.request(auth, email);
      setMessage(passwordResetResultMessage(result));
      if (result.status === 'accepted') {
        setAccepted(true);
        setRetryAt(result.retryAt);
      } else if (result.status === 'rate-limited' || result.status === 'cooldown') {
        setRetryAt(result.retryAt);
      }
    } finally {
      setLoading(false);
    }
  };

  return <form onSubmit={(event) => void submit(event)}>
    {!accepted && <input aria-label="Reset email" type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />}
    {accepted && <p className="message" role="status">{message}</p>}
    {!accepted && <button type="submit" disabled={loading || secondsLeft > 0}>{loading ? 'Sending…' : secondsLeft > 0 ? `Resend in ${secondsLeft}s` : 'Send reset email'}</button>}
    {accepted && <button type="button" onClick={() => void submit()} disabled={loading || secondsLeft > 0}>{loading ? 'Sending…' : secondsLeft > 0 ? `Resend in ${secondsLeft}s` : 'Resend reset email'}</button>}
    {accepted && <button type="button" className="text-button" onClick={() => { setAccepted(false); setMessage(''); }}>Change email</button>}
    {!accepted && message && <p className="message" role="status">{message}</p>}
    <button type="button" className="text-button" onClick={onBack}>Back to sign in</button>
  </form>;
}
