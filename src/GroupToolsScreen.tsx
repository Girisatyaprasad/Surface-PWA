import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { getGroupTools, mutateGroupTools, readIisAnalyses, type GroupIisAnalysis, type GroupToolsData, type GroupToolsMembership } from './organizations/groupToolsApi';

const ROLE_LABEL: Record<GroupToolsMembership['surfaceRole'], string> = { member: 'Member', group_admin: 'Group admin', org_admin: 'Organization admin', partner_analyst: 'Partner analyst' };
const IIS_LABEL: Record<string, string> = {
  ACTIVITY_MOMENTUM_RISING: 'Activity is rising', ACTIVITY_STAGNATING: 'Activity may need attention',
  CONSISTENCY_DECLINING: 'Consistency is declining', CONSISTENCY_IMPROVING: 'Consistency is improving',
  HIGH_FOLLOWUP_MISS_RATE: 'Follow-ups are being missed', HIGH_STALE_RELATIONSHIP_RATE: 'Many relationships may need follow-up',
  NEW_PEOPLE_MOMENTUM_FALLING: 'New PIN creation is slowing', NEW_PEOPLE_MOMENTUM_RISING: 'New PIN creation is rising',
};

export function GroupToolsScreen({ user, membership, onBack }: { user: User; membership: GroupToolsMembership; onBack: () => void }) {
  const [data, setData] = useState<GroupToolsData | null>(null);
  const [analyses, setAnalyses] = useState<GroupIisAnalysis[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberGroup, setMemberGroup] = useState(membership.groupId ?? '');
  const [memberRole, setMemberRole] = useState<'member' | 'group_admin'>('member');

  const refresh = useCallback(async () => {
    setLoading(true); setMessage('');
    try {
      const next = await getGroupTools(user, membership.organizationId);
      setData(next);
      const role = next.membership.surfaceRole;
      const groupIds = role === 'group_admin' ? [next.membership.groupId].filter((id): id is string => Boolean(id)) : next.groups.filter((group) => group.status === 'active').map((group) => group.id);
      const requests: Promise<GroupIisAnalysis[]>[] = [];
      if (role === 'group_admin' || role === 'org_admin' || role === 'partner_analyst') {
        for (const groupId of groupIds.slice(0, 20)) requests.push(readIisAnalyses(user, membership.organizationId, 'group', groupId, '30d').catch(() => []));
      }
      if (role === 'org_admin' || role === 'partner_analyst') requests.push(readIisAnalyses(user, membership.organizationId, 'organization', membership.organizationId, '30d').catch(() => []));
      if (role === 'partner_analyst') {
        for (const member of next.memberAnalytics.slice(0, 50)) requests.push(readIisAnalyses(user, membership.organizationId, 'member', String(member.uid), '30d').catch(() => []));
      }
      setAnalyses((await Promise.all(requests)).flat());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Group Tools is temporarily unavailable.');
    } finally { setLoading(false); }
  }, [membership.organizationId, user]);

  useEffect(() => { void refresh(); }, [refresh]);

  const mutate = async (path: string, method: 'POST' | 'PATCH', body: unknown, success: string) => {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await mutateGroupTools(user, path, method, body); setMessage(success); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Group Tools could not complete that request.'); }
    finally { setBusy(false); }
  };

  const addMember = async (event: FormEvent) => {
    event.preventDefault(); if (!data || busy) return;
    setBusy(true); setMessage('');
    try {
      const lookup = await mutateGroupTools(user, `/organizations/${encodeURIComponent(membership.organizationId)}/member-lookup`, 'POST', { email: memberEmail.trim() });
      if (lookup.found !== true || typeof lookup.uid !== 'string') { setMessage('No existing Surface account was found for that email.'); return; }
      await mutateGroupTools(user, `/organizations/${encodeURIComponent(membership.organizationId)}/members`, 'POST', {
        uid: lookup.uid,
        groupId: data.membership.surfaceRole === 'group_admin' ? data.membership.groupId : (memberGroup || null),
        surfaceRole: data.membership.surfaceRole === 'group_admin' ? 'member' : memberRole,
      });
      setMemberEmail(''); setMessage('Member added.'); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Member could not be added.'); }
    finally { setBusy(false); }
  };

  return <section className="group-tools-screen">
    <header className="group-tools-heading"><button type="button" onClick={onBack}>Back</button><h2>Group Tools</h2><button type="button" onClick={() => void refresh()} disabled={loading}>Refresh</button></header>
    {loading && <p role="status">Loading Group Tools…</p>}
    {!loading && data && <>
      <section className="group-tools-overview">
        <p className="group-tools-kicker">Organization</p><h3>{data.organization.name}</h3>
        <dl><div><dt>Group</dt><dd>{data.groups.find((group) => group.id === data.membership.groupId)?.name ?? membership.groupName ?? 'Not assigned'}</dd></div>
          <div><dt>Role</dt><dd>{ROLE_LABEL[data.membership.surfaceRole]}</dd></div>
          <div><dt>Group Plan</dt><dd>{data.groupPlan.status === 'active' ? 'Active' : data.groupPlan.status}</dd></div>
          {data.groupPlan.expiresAt && <div><dt>Renews / expires</dt><dd>{new Date(data.groupPlan.expiresAt).toLocaleDateString()}</dd></div>}</dl>
      </section>

      {(data.membership.surfaceRole === 'group_admin' || data.membership.surfaceRole === 'org_admin') && <section className="group-tools-section"><h3>{data.membership.surfaceRole === 'org_admin' ? 'Groups' : 'Your group'}</h3>
        <div className="group-tools-list">{data.groups.map((group) => <article className="group-tools-row" key={group.id}><div><strong>{group.name}</strong><small>{group.status === 'active' ? 'Active' : 'Inactive'}</small></div>
          {data.membership.surfaceRole === 'org_admin' && <div className="group-tools-row-actions"><button disabled={busy} onClick={() => { const value = window.prompt('Group name', group.name); if (value?.trim()) void mutate(`/organizations/${encodeURIComponent(membership.organizationId)}/groups/${encodeURIComponent(group.id)}`, 'PATCH', { name: value.trim() }, 'Group updated.'); }}>Rename</button><button disabled={busy} onClick={() => void mutate(`/organizations/${encodeURIComponent(membership.organizationId)}/groups/${encodeURIComponent(group.id)}`, 'PATCH', { status: group.status === 'active' ? 'inactive' : 'active' }, group.status === 'active' ? 'Group deactivated.' : 'Group activated.')}>{group.status === 'active' ? 'Deactivate' : 'Activate'}</button></div>}
        </article>)}</div>
        {data.membership.surfaceRole === 'org_admin' && <form className="group-tools-inline-form" onSubmit={(event) => { event.preventDefault(); if (groupName.trim()) void mutate(`/organizations/${encodeURIComponent(membership.organizationId)}/groups`, 'POST', { name: groupName.trim() }, 'Group created.').then(() => setGroupName('')); }}><input aria-label="New group name" placeholder="Group name" value={groupName} onChange={(event) => setGroupName(event.target.value)} maxLength={120} required /><button disabled={busy}>Create group</button></form>}
      </section>}

      {(data.membership.surfaceRole === 'group_admin' || data.membership.surfaceRole === 'org_admin') && <section className="group-tools-section"><h3>Members</h3>
        <form className="group-tools-inline-form" onSubmit={(event) => void addMember(event)}><input aria-label="Existing Surface account email" type="email" placeholder="Existing Surface account email" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} required />
          {data.membership.surfaceRole === 'org_admin' && <><select aria-label="Member group" value={memberGroup} onChange={(event) => setMemberGroup(event.target.value)}><option value="">No group</option>{data.groups.filter((group) => group.status === 'active').map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><select aria-label="Member role" value={memberRole} onChange={(event) => setMemberRole(event.target.value as 'member' | 'group_admin')}><option value="member">Member</option><option value="group_admin">Group admin</option></select></>}
          <button disabled={busy}>Add existing member</button></form>
        <div className="group-tools-list">{data.members.map((member) => <article className="group-tools-row" key={member.uid}><div><strong>Surface member · {member.uid.slice(-6)}</strong><small>{ROLE_LABEL[member.surfaceRole]} · {member.status === 'active' ? 'Active' : 'Inactive'}</small></div>
          <div className="group-tools-row-actions">{data.membership.surfaceRole === 'org_admin' && <><select aria-label={`Group for ${member.uid.slice(-6)}`} value={member.groupId ?? ''} disabled={busy || member.uid === user.uid || member.surfaceRole === 'org_admin'} onChange={(event) => { const groupId = event.target.value || null; void mutate(`/organizations/${encodeURIComponent(membership.organizationId)}/members/${encodeURIComponent(member.uid)}`, 'PATCH', { groupId, ...(groupId ? {} : { surfaceRole: 'member' }) }, 'Member moved.'); }}><option value="">No group</option>{data.groups.filter((group) => group.status === 'active').map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><select aria-label={`Role for ${member.uid.slice(-6)}`} value={member.surfaceRole === 'group_admin' ? 'group_admin' : 'member'} disabled={busy || member.uid === user.uid || member.surfaceRole === 'org_admin'} onChange={(event) => void mutate(`/organizations/${encodeURIComponent(membership.organizationId)}/members/${encodeURIComponent(member.uid)}`, 'PATCH', { surfaceRole: event.target.value }, 'Member role updated.')}><option value="member">Member</option>{member.groupId && <option value="group_admin">Group admin</option>}</select></>}
            {member.uid !== user.uid && member.status === 'active' && <button disabled={busy} onClick={() => void mutate(`/organizations/${encodeURIComponent(membership.organizationId)}/members/${encodeURIComponent(member.uid)}`, 'PATCH', { status: 'inactive' }, 'Member deactivated.')}>Deactivate</button>}
            {data.membership.surfaceRole === 'org_admin' && member.uid !== user.uid && member.status === 'inactive' && <button disabled={busy} onClick={() => void mutate(`/organizations/${encodeURIComponent(membership.organizationId)}/members/${encodeURIComponent(member.uid)}`, 'PATCH', { status: 'active' }, 'Member reactivated.')}>Reactivate</button>}
          </div></article>)}</div>
      </section>}

      {data.groupAnalytics.length > 0 && <AnalyticsSection title="Group analytics" records={data.groupAnalytics} />}
      {data.organizationAnalytics.length > 0 && <AnalyticsSection title="Organization analytics" records={data.organizationAnalytics} />}
      {data.memberAnalytics.length > 0 && <AnalyticsSection title="Approved member analytics" records={data.memberAnalytics} />}
      {(data.membership.surfaceRole === 'group_admin' || data.membership.surfaceRole === 'org_admin' || data.membership.surfaceRole === 'partner_analyst') && <section className="group-tools-section"><h3>IIS insights</h3>
        {analyses.length ? <div className="group-tools-list">{analyses.map((item, index) => <article className="group-tools-insight" key={`${item.scope}-${item.subjectId}-${item.analysisCode}-${index}`}><strong>{IIS_LABEL[item.analysisCode] ?? 'Surface insight'}</strong><span>{item.scope === 'organization' ? 'Organization' : item.scope === 'group' ? data.groups.find((group) => group.id === item.subjectId)?.name ?? 'Group' : `Member · ${item.subjectId.slice(-6)}`} · {item.window}</span><small>{Math.round(item.confidence * 100)}% confidence</small></article>)}</div> : <p className="group-tools-muted">No IIS insights are available for this period.</p>}
      </section>}
    </>}
    {message && <p className="group-tools-message" role="status">{message}</p>}
  </section>;
}

function AnalyticsSection({ title, records }: { title: string; records: Array<Record<string, number | string>> }) {
  const current = [...records].sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0))[0];
  if (!current) return null;
  const fields: Array<[string, string, boolean?]> = [['People added', 'peopleAdded'], ['Active PINs', 'activePins'], ['Notes created', 'notesCreated'], ['Captures', 'capturesCreated'], ['Follow-ups due', 'followupsDue'], ['Active members', 'activeMemberCount'], ['Member count', 'memberCount'], ['Active rate', 'activeRate', true], ['Consistency', 'averageConsistencyScore', true]];
  const values = fields.filter(([, key]) => typeof current[key] === 'number').slice(0, 6);
  return <section className="group-tools-section"><h3>{title}</h3><div className="group-tools-metrics">{values.map(([label, key, percent]) => <div className="group-tools-metric" key={key}><strong>{percent ? `${Math.round(Number(current[key]) * 100)}%` : Number(current[key]).toLocaleString()}</strong><span>{label}</span></div>)}</div><p className="group-tools-muted">Latest available reporting period</p></section>;
}
