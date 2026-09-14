import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

let environment: RulesTestEnvironment;
const firestoreRules = readFileSync(new URL('../../../Surface/firestore.rules', import.meta.url), 'utf8');
const rulesTests = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

rulesTests('organization Firestore rules privacy boundaries', () => {
beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-surface-organizations',
    firestore: { host: '127.0.0.1', port: 8080, rules: firestoreRules },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'organizations/org-1'), { id: 'org-1', name: 'Test organization', status: 'active' }),
      setDoc(doc(db, 'organizations/org-1/groupPlan/current'), { organizationId: 'org-1', status: 'active', planId: 'group-standard', activatedAt: Date.now(), expiresAt: null, updatedAt: Date.now() }),
      setDoc(doc(db, 'organizations/org-1/groups/g1'), { id: 'g1', organizationId: 'org-1', name: 'Group 1', status: 'active' }),
      setDoc(doc(db, 'organizations/org-1/groups/g2'), { id: 'g2', organizationId: 'org-1', name: 'Group 2', status: 'active' }),
      setDoc(doc(db, 'organizations/org-1/members/ga'), { uid: 'ga', organizationId: 'org-1', groupId: 'g1', status: 'active', surfaceRole: 'group_admin', companyRank: 'Diamond' }),
      setDoc(doc(db, 'organizations/org-1/members/oa'), { uid: 'oa', organizationId: 'org-1', groupId: null, status: 'active', surfaceRole: 'org_admin' }),
      setDoc(doc(db, 'organizations/org-1/members/pa'), { uid: 'pa', organizationId: 'org-1', groupId: null, status: 'active', surfaceRole: 'partner_analyst' }),
      setDoc(doc(db, 'organizations/org-1/members/member'), { uid: 'member', organizationId: 'org-1', groupId: 'g1', status: 'active', surfaceRole: 'member', companyRank: 'Diamond', recognitionTitle: 'Upline' }),
      setDoc(doc(db, 'organizations/org-1/members/target'), { uid: 'target', organizationId: 'org-1', groupId: 'g1', status: 'active', surfaceRole: 'member' }),
      setDoc(doc(db, 'organizations/org-1/members/target2'), { uid: 'target2', organizationId: 'org-1', groupId: 'g2', status: 'active', surfaceRole: 'member' }),
      ...['free', 'pro', 'max'].map((uid) => setDoc(doc(db, 'organizations/org-1/members/tier-' + uid), { uid: 'tier-' + uid, organizationId: 'org-1', groupId: 'g1', status: 'active', surfaceRole: 'member' })),
      setDoc(doc(db, 'organizations/org-1/groupAnalytics/g1_2026'), { organizationId: 'org-1', groupId: 'g1', memberCount: 2, peopleAdded: 8, eventsCreated: 1 }),
      setDoc(doc(db, 'organizations/org-1/groupAnalytics/g2_2026'), { organizationId: 'org-1', groupId: 'g2', memberCount: 1, peopleAdded: 2, eventsCreated: 0 }),
      setDoc(doc(db, 'organizations/org-1/organizationAnalytics/2026'), { organizationId: 'org-1', memberCount: 3, eventsCreated: 1 }),
      setDoc(doc(db, 'organizations/org-1/memberAnalytics/target_2026'), { organizationId: 'org-1', uid: 'target', peopleAdded: 4, activePins: 3, eventsCreated: 2 }),
      setDoc(doc(db, 'organizations/org-1/memberAnalyticsHistory/target_2026-09-14'), { organizationId: 'org-1', uid: 'target', peopleAdded: 4 }),
      setDoc(doc(db, 'organizations/org-1/memberIisInsights/target/items/iis1_0123456789abcdef'), { insightCode: 'HIGH_STALE_RELATIONSHIP_RATE', evidenceMetrics: { rate: 0.5 } }),
      setDoc(doc(db, 'organizations/org-1/memberIisAnalysis/target_30d'), { organizationId: 'org-1', uid: 'target', analysisCode: 'CONSISTENCY_DECLINING' }),
      setDoc(doc(db, 'organizations/org-1/groupIisAnalysis/g1_30d'), { organizationId: 'org-1', groupId: 'g1', analysisCode: 'CONSISTENCY_DECLINING' }),
      setDoc(doc(db, 'organizations/org-1/organizationIisAnalysis/30d'), { organizationId: 'org-1', analysisCode: 'CONSISTENCY_DECLINING' }),
      setDoc(doc(db, 'organizations/org-1/memberAnalytics/target2_2026'), { organizationId: 'org-1', uid: 'target2', peopleAdded: 1, activePins: 1, eventsCreated: 0 }),
      setDoc(doc(db, 'users/target'), { proStatus: 'UNPAID', planId: null, activatedAt: null, expiresAt: null, phoneNumber: '+919876543210', displayName: 'Private Name' }),
      setDoc(doc(db, 'users/target/pins/private-pin'), { id: 'private-pin', uid: 'target', name: 'Private prospect', phone: '9876543210', about: 'Private context', locationLabel: 'Private location' }),
      setDoc(doc(db, 'users/target/notes/private-note'), { id: 'private-note', uid: 'target', body: 'Private note content' }),
      setDoc(doc(db, 'users/target/media/private-media'), { uid: 'target', originalPath: 'private/photo.jpg', processedPath: 'private/processed.jpg' }),
      setDoc(doc(db, 'users/max-expired'), { proStatus: 'PRO_ACTIVE', planId: 'surface_max_1period', expiresAt: Timestamp.fromMillis(Date.now() - 60_000) }),
      setDoc(doc(db, 'users/member/personalAnalytics/2026'), { peopleAdded: 2, eventsCreated: 0 }),
    ]);
    for (const [uid, proStatus, planId] of [['tier-free', 'UNPAID', null], ['tier-pro', 'PRO_ACTIVE', 'surface_pro_1period'], ['tier-max', 'PRO_ACTIVE', 'surface_max_1period']] as const) {
      await setDoc(doc(db, `users/${uid}`), { proStatus, planId, activatedAt: null, expiresAt: null });
    }
  });
});

afterAll(async () => environment?.cleanup());

const ref = (uid: string, path: string) => doc(environment.authenticatedContext(uid).firestore(), path);

  it('lets an owner read and write only their own Notes and PINs', async () => {
    await assertSucceeds(getDoc(ref('target', 'users/target/pins/private-pin')));
    await assertSucceeds(getDoc(ref('target', 'users/target/notes/private-note')));
    await assertSucceeds(updateDoc(ref('target', 'users/target/pins/private-pin'), { about: 'Updated by owner' }));
    await assertSucceeds(setDoc(ref('target', 'users/target/notes/owner-note'), { id: 'owner-note', uid: 'target', body: 'Owner note' }));
    await assertFails(getDoc(ref('target', 'users/member/pins/private-pin')));
    await assertFails(setDoc(ref('target', 'users/member/pins/injected'), { id: 'injected', uid: 'target', name: 'Wrong path' }));
    await assertFails(setDoc(ref('target', 'users/target/pins/wrong-id'), { id: 'another-id', uid: 'target', name: 'Wrong document ID' }));
  });

  it('allows only an active personal Max owner to access valid private media metadata', async () => {
    const metadata = {
      uid: 'tier-max', mediaId: 'media-1', type: 'capture',
      originalPath: 'users/tier-max/media/media-1/original',
      processedPath: 'users/tier-max/media/media-1/processed', originalMimeType: 'image/png', originalSize: 42,
      mimeType: 'image/jpeg', size: 40, createdAt: Date.now(), updatedAt: Date.now(), dateKey: '14/09/2026',
      timeLabel: '10:00 am', locationLabel: '', location: null, capture: true, pinIds: [], revision: Date.now(),
      updatedByDeviceId: 'test-device',
    };
    const ownerDoc = ref('tier-max', 'users/tier-max/media/media-1');
    await assertSucceeds(setDoc(ownerDoc, metadata));
    await assertSucceeds(getDoc(ownerDoc));
    await assertSucceeds(getDocs(collection(environment.authenticatedContext('tier-max').firestore(), 'users/tier-max/media')));
    await assertSucceeds(updateDoc(ownerDoc, { locationLabel: 'Private owner label' }));
    await assertFails(getDoc(ref('tier-pro', 'users/tier-max/media/media-1')));
    await assertFails(setDoc(ref('tier-max', 'users/tier-max/media/forged'), { ...metadata, mediaId: 'forged', processedPath: 'users/tier-max/media/other/processed' }));
    await assertFails(setDoc(ref('tier-pro', 'users/tier-pro/media/pro-media'), { ...metadata, uid: 'tier-pro', mediaId: 'pro-media', originalPath: 'users/tier-pro/media/pro-media/original', processedPath: 'users/tier-pro/media/pro-media/processed' }));
    await assertFails(setDoc(ref('max-expired', 'users/max-expired/media/expired'), { ...metadata, uid: 'max-expired', mediaId: 'expired', originalPath: 'users/max-expired/media/expired/original', processedPath: 'users/max-expired/media/expired/processed' }));
  });

  it('denies private Notes and PINs to unauthenticated users and keeps media owner-private', async () => {
    const db = environment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'users/target/pins/private-pin')));
    await assertFails(getDoc(doc(db, 'users/target/notes/private-note')));
    await assertFails(getDoc(ref('target', 'users/target/media/private-media')));
  });

  it('lets members read their own personal analytics but not another member private records', async () => {
    await assertSucceeds(getDoc(ref('member', 'users/member/personalAnalytics/2026')));
    await assertFails(getDoc(ref('member', 'users/target')));
    await assertFails(getDoc(ref('member', 'users/target/pins/private-pin')));
    await assertFails(getDoc(ref('member', 'users/target/notes/private-note')));
    await assertFails(getDoc(ref('member', 'users/target/media/private-media')));
  });

  it('does not let upline/rank metadata expand a normal member permission', async () => {
    await assertFails(getDoc(ref('member', 'users/target')));
    await assertFails(getDoc(ref('member', 'users/target/pins/private-pin')));
  });

  it('lets a group admin read only its assigned group aggregate, never member records', async () => {
    await assertSucceeds(getDoc(ref('ga', 'organizations/org-1/groupAnalytics/g1_2026')));
    await assertFails(getDoc(ref('ga', 'organizations/org-1/groupAnalytics/g2_2026')));
    await assertFails(getDoc(ref('ga', 'organizations/org-1/memberAnalytics/target_2026')));
    await assertFails(getDoc(ref('ga', 'users/target')));
    await assertFails(getDoc(ref('ga', 'users/target/pins/private-pin')));
    await assertFails(getDoc(ref('ga', 'users/target/notes/private-note')));
    await assertFails(getDoc(ref('ga', 'users/target/media/private-media')));
  });

  it('lets an organization admin read organization and group aggregates, not per-member or private records', async () => {
    await assertSucceeds(getDoc(ref('oa', 'organizations/org-1/organizationAnalytics/2026')));
    await assertSucceeds(getDoc(ref('oa', 'organizations/org-1/groupAnalytics/g2_2026')));
    await assertFails(getDoc(ref('oa', 'organizations/org-1/memberAnalytics/target_2026')));
    await assertFails(getDoc(ref('oa', 'users/target')));
    await assertFails(getDoc(ref('oa', 'users/target/pins/private-pin')));
    await assertFails(getDoc(ref('oa', 'users/target/notes/private-note')));
    await assertFails(getDoc(ref('oa', 'users/target/media/private-media')));
  });

  it('lets an explicitly assigned partner analyst read member metrics but not source records', async () => {
    await assertSucceeds(getDoc(ref('pa', 'organizations/org-1/memberAnalytics/target_2026')));
    await assertSucceeds(getDoc(ref('pa', 'organizations/org-1/groupAnalytics/g1_2026')));
    await assertSucceeds(getDoc(ref('pa', 'organizations/org-1/organizationAnalytics/2026')));
    await assertFails(getDoc(ref('pa', 'users/target')));
    await assertFails(getDoc(ref('pa', 'users/target/pins/private-pin')));
    await assertFails(getDoc(ref('pa', 'users/target/notes/private-note')));
    await assertFails(getDoc(ref('pa', 'users/target/media/private-media')));
  });

  it('does not grant organization permissions based on Free, Pro, or Max entitlement', async () => {
    for (const uid of ['tier-free', 'tier-pro', 'tier-max']) {
      await assertFails(getDoc(ref(uid, 'organizations/org-1/groupAnalytics/g1_2026')));
      await assertFails(getDoc(ref(uid, 'organizations/org-1/memberAnalytics/target_2026')));
      await assertFails(getDoc(ref(uid, 'users/target')));
    }
  });

  it('keeps organization, membership, and analytics writes backend-only', async () => {
    await assertFails(setDoc(ref('oa', 'organizations/org-1/members/injected'), { uid: 'injected', surfaceRole: 'org_admin', status: 'active' }));
    await assertFails(setDoc(ref('pa', 'organizations/org-1/memberAnalytics/fake_2026'), { organizationId: 'org-1', uid: 'pa', peopleAdded: 999 }));
  });

  it('keeps IIS envelopes, history, and server analyses inaccessible through direct client Firestore access', async () => {
    const paths = [
      'organizations/org-1/memberAnalyticsHistory/target_2026-09-14',
      'organizations/org-1/memberIisInsights/target/items/iis1_0123456789abcdef',
      'organizations/org-1/memberIisAnalysis/target_30d',
      'organizations/org-1/groupIisAnalysis/g1_30d',
      'organizations/org-1/organizationIisAnalysis/30d',
    ];
    for (const uid of ['member', 'ga', 'oa', 'pa']) {
      for (const path of paths) await assertFails(getDoc(ref(uid, path)));
    }
    await assertFails(setDoc(ref('pa', paths[1]), { uid: 'pa', arbitrary: 'payload' }));
  });

  it('blocks all organization reads when Group Plan is inactive, expired, or suspended', async () => {
    const plan = ref('oa', 'organizations/org-1/groupPlan/current');
    for (const state of [
      { status: 'inactive', expiresAt: null },
      { status: 'suspended', expiresAt: null },
      { status: 'active', expiresAt: Date.now() - 60_000 },
    ]) {
      await environment.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'organizations/org-1/groupPlan/current'), { organizationId: 'org-1', ...state });
      });
      await assertFails(getDoc(ref('oa', 'organizations/org-1')));
      await assertFails(getDoc(ref('member', 'organizations/org-1/members/member')));
      await assertFails(getDoc(ref('oa', 'organizations/org-1/groupAnalytics/g1_2026')));
      await assertFails(getDoc(ref('pa', 'organizations/org-1/memberAnalytics/target_2026')));
    }
    await assertFails(getDoc(plan));
  });

  it('denies clients direct Group Plan, lookup-limit, and audit access or writes', async () => {
    const path = 'organizations/org-1/groupPlan/current';
    await assertFails(getDoc(ref('oa', path)));
    await assertFails(setDoc(ref('oa', path), { organizationId: 'org-1', status: 'active' }));
    await assertFails(setDoc(ref('oa', 'organizations/org-1/lookupRateLimits/oa'), { count: 0 }));
    await assertFails(setDoc(ref('oa', 'organizations/org-1/auditLogs/fake'), { actionCode: 'GROUP_PLAN_ACTIVATED' }));
  });
});
