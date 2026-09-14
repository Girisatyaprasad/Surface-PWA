import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import {
  changeInternalGroupPlan,
  checkInternalAdminAccess,
  createInternalOrganization,
  getInternalOrganizationStatus,
  InternalProvisioningError,
  type InternalOrganizationStatus,
} from './internalProvisioning';

type AccessState = 'checking' | 'allowed' | 'denied' | 'error';

export function InternalProvisioningScreen({ user, onBack }: { user: User; onBack: () => void }) {
  const [access, setAccess] = useState<AccessState>('checking');
  const [name, setName] = useState('');
  const [companyKey, setCompanyKey] = useState('');
  const [initialAdminEmail, setInitialAdminEmail] = useState('');
  const [lookupId, setLookupId] = useState('');
  const [status, setStatus] = useState<InternalOrganizationStatus | null>(null);
  const [adminLabel, setAdminLabel] = useState('Existing Surface account configured');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const requestLock = useRef(false);

  useEffect(() => {
    let active = true;
    void checkInternalAdminAccess(user).then((allowed) => {
      if (active) setAccess(allowed ? 'allowed' : 'denied');
    }).catch(() => {
      if (active) setAccess('error');
    });
    return () => { active = false; };
  }, [user]);

  const refreshStatus = async (organizationId: string) => {
    const next = await getInternalOrganizationStatus(user, organizationId);
    setStatus(next);
    setLookupId(next.organizationId);
    return next;
  };

  const errorMessage = (error: unknown) => error instanceof InternalProvisioningError
    ? error.message
    : 'The request could not be completed. Check your connection and try again.';

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (requestLock.current) return;
    requestLock.current = true; setBusy(true); setMessage('');
    try {
      const result = await createInternalOrganization(user, {
        name: name.trim(),
        ...(companyKey.trim() ? { companyKey: companyKey.trim() } : {}),
        initialAdminEmail: initialAdminEmail.trim(),
      });
      setAdminLabel(maskEmail(initialAdminEmail));
      setStatus(result);
      setLookupId(result.organizationId);
      setMessage('Organization created. Group Plan starts inactive.');
      setName(''); setCompanyKey(''); setInitialAdminEmail('');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      requestLock.current = false; setBusy(false);
    }
  };

  const loadOrganization = async (event: FormEvent) => {
    event.preventDefault();
    if (requestLock.current || !lookupId.trim()) return;
    requestLock.current = true; setBusy(true); setMessage('');
    try {
      await refreshStatus(lookupId.trim());
      setAdminLabel('Configured existing org admin');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      requestLock.current = false; setBusy(false);
    }
  };

  const changePlan = async (action: 'activate' | 'suspend' | 'deactivate') => {
    if (!status || requestLock.current) return;
    requestLock.current = true; setBusy(true); setMessage('');
    try {
      await changeInternalGroupPlan(user, status.organizationId, action);
      await refreshStatus(status.organizationId);
      setMessage(action === 'suspend' ? 'Group Plan suspended. Organization and members remain intact.' : action === 'deactivate' ? 'Group Plan deactivated.' : 'Group Plan is active.');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      requestLock.current = false; setBusy(false);
    }
  };

  if (access === 'checking') return <section className="internal-screen"><p role="status">Verifying Surface internal access…</p></section>;
  if (access === 'denied') return <section className="internal-screen"><button type="button" className="internal-back" onClick={onBack}>Back to Surface</button><h1>Access denied</h1><p>This account is not authorized for Surface internal provisioning.</p></section>;
  if (access === 'error') return <section className="internal-screen"><button type="button" className="internal-back" onClick={onBack}>Back to Surface</button><h1>Access unavailable</h1><p>Surface could not verify internal access. Check your connection and try again.</p><button type="button" className="internal-button" onClick={() => { setAccess('checking'); void checkInternalAdminAccess(user).then((allowed) => setAccess(allowed ? 'allowed' : 'denied')).catch(() => setAccess('error')); }}>Retry</button></section>;

  return <section className="internal-screen">
    <header className="internal-heading"><button type="button" className="internal-back" onClick={onBack}>Back</button><h1>Surface Internal</h1></header>
    <p className="internal-status" role="status">Internal admin: <strong>Yes</strong></p>
    <p className="internal-test-note">Internal test provisioning only. No pricing or payment is involved.</p>
    <form className="internal-form" onSubmit={(event) => void create(event)}>
      <h2>Create organization</h2>
      <label>Organization name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>
      <label>Company key <span>(optional)</span><input value={companyKey} onChange={(event) => setCompanyKey(event.target.value)} maxLength={80} /></label>
      <label>Initial organization admin email<input type="email" autoComplete="email" value={initialAdminEmail} onChange={(event) => setInitialAdminEmail(event.target.value)} maxLength={254} required /></label>
      <button className="internal-button" type="submit" disabled={busy}>{busy ? 'Working…' : 'Create organization'}</button>
    </form>

    <form className="internal-load-form" onSubmit={(event) => void loadOrganization(event)}>
      <label>Load an organization by ID<input value={lookupId} onChange={(event) => setLookupId(event.target.value)} autoCapitalize="none" /></label>
      <button className="internal-button secondary" type="submit" disabled={busy || !lookupId.trim()}>Load</button>
    </form>

    {status && <section className="internal-org-status" aria-labelledby="internal-org-title">
      <h2 id="internal-org-title">Organization status</h2>
      <dl>
        <div><dt>Name</dt><dd>{status.name}</dd></div>
        <div><dt>Organization ID</dt><dd className="internal-id">{status.organizationId}</dd></div>
        <div><dt>Initial org admin</dt><dd>{adminLabel}</dd></div>
        <div><dt>Organization active</dt><dd>{status.organizationActive ? 'Yes' : 'No'}</dd></div>
        <div><dt>Group Plan</dt><dd>{capitalize(status.groupPlanStatus)}</dd></div>
        <div><dt>Group Plan active</dt><dd>{status.groupPlanActive ? 'Yes' : 'No'}</dd></div>
        <div><dt>Internal admin</dt><dd>Yes</dd></div>
        <div><dt>Initial org admin configured</dt><dd>{status.initialAdminConfigured ? 'Yes' : 'No'}</dd></div>
      </dl>
      <p className="internal-test-note">Test plan ID: <code>surface_group_test_v1</code></p>
      <div className="internal-plan-actions">
        {status.groupPlanStatus === 'active'
          ? <><button type="button" className="internal-button secondary" disabled={busy} onClick={() => void changePlan('suspend')}>Suspend</button><button type="button" className="internal-button secondary" disabled={busy} onClick={() => void changePlan('deactivate')}>Deactivate</button></>
          : <button type="button" className="internal-button" disabled={busy || !status.organizationActive} onClick={() => void changePlan('activate')}>{status.groupPlanStatus === 'suspended' || status.groupPlanStatus === 'expired' ? 'Reactivate' : 'Activate'}</button>}
      </div>
    </section>}
    {message && <p className="internal-message" role="status">{message}</p>}
  </section>;
}

function maskEmail(value: string): string {
  const [local, domain] = value.trim().split('@');
  if (!local || !domain) return 'Existing Surface account configured';
  return `${local.slice(0, 1)}***@${domain}`;
}

function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
