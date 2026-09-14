import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

const enabled = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const rulesTests = enabled ? describe : describe.skip;
const firestoreRules = readFileSync(new URL('../../Surface/firestore.rules', import.meta.url), 'utf8');
const storageRules = readFileSync(new URL('../../Surface/storage.rules', import.meta.url), 'utf8');
const bucket = 'gs://adms-by-giri.firebasestorage.app';
const image = (type = 'image/jpeg', bytes = new Uint8Array([0xff, 0xd8, 0xff])) => new Blob([bytes], { type });

let environment: RulesTestEnvironment;

rulesTests('Max media Cloud Storage rules', () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: 'demo-surface-media',
      firestore: { host: '127.0.0.1', port: 8080, rules: firestoreRules },
      storage: { host: '127.0.0.1', port: 9199, rules: storageRules },
    });
  });

  beforeEach(async () => {
    await Promise.all([environment.clearFirestore(), environment.clearStorage()]);
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all([
        setDoc(doc(db, 'users/max'), { proStatus: 'PRO_ACTIVE', planId: 'surface_max_1period', expiresAt: null }),
        setDoc(doc(db, 'users/max12'), { proStatus: 'PRO_ACTIVE', planId: 'surface_max_12period', expiresAt: null }),
        setDoc(doc(db, 'users/grace'), { proStatus: 'PRO_GRACE', planId: 'surface_max_2period', expiresAt: Timestamp.fromMillis(Date.now() + 60_000) }),
        setDoc(doc(db, 'users/expired'), { proStatus: 'PRO_ACTIVE', planId: 'surface_max_1period', expiresAt: Timestamp.fromMillis(Date.now() - 60_000) }),
        setDoc(doc(db, 'users/free'), { proStatus: 'UNPAID', planId: null, expiresAt: null }),
        setDoc(doc(db, 'users/pro'), { proStatus: 'PRO_ACTIVE', planId: 'surface_pro_1period', expiresAt: null }),
        setDoc(doc(db, 'users/group-admin'), { proStatus: 'UNPAID', planId: null, expiresAt: null }),
        setDoc(doc(db, 'users/org-admin'), { proStatus: 'UNPAID', planId: null, expiresAt: null }),
        setDoc(doc(db, 'users/partner-analyst'), { proStatus: 'UNPAID', planId: null, expiresAt: null }),
        setDoc(doc(db, 'users/forged'), { proStatus: 'UNPAID', planId: 'surface_max_1period', expiresAt: null }),
        setDoc(doc(db, 'users/bad-period'), { proStatus: 'PRO_ACTIVE', planId: 'surface_max_13period', expiresAt: null }),
        setDoc(doc(db, 'users/bad-format'), { proStatus: 'PRO_ACTIVE', planId: 'MAX_MONTHLY', expiresAt: null }),
        setDoc(doc(db, 'organizations/org-1/members/group-admin'), { uid: 'group-admin', organizationId: 'org-1', groupId: 'g1', status: 'active', surfaceRole: 'group_admin' }),
        setDoc(doc(db, 'organizations/org-1/members/org-admin'), { uid: 'org-admin', organizationId: 'org-1', groupId: null, status: 'active', surfaceRole: 'org_admin' }),
        setDoc(doc(db, 'organizations/org-1/members/partner-analyst'), { uid: 'partner-analyst', organizationId: 'org-1', groupId: null, status: 'active', surfaceRole: 'partner_analyst' }),
      ]);
    });
    await environment.authenticatedContext('max').storage(bucket).ref('users/max/media/m1/original')
      .put(image(), { contentType: 'image/jpeg' });
    await environment.authenticatedContext('max').storage(bucket).ref('users/max/media/m1/processed')
      .put(image(), { contentType: 'image/jpeg' });
  });

  afterAll(async () => environment?.cleanup());

  const object = (uid: string, path: string) => environment.authenticatedContext(uid).storage(bucket).ref(path);
  const put = (uid: string, path: string, blob: Blob, contentType = blob.type) => object(uid, path).put(blob, { contentType }).then(() => undefined);

  it('allows Max to upload the preserved original JPEG', async () => {
    await assertSucceeds(put('max', 'users/max/media/m2/original', image()));
  });
  it('allows Max to upload the processed JPEG', async () => {
    await assertSucceeds(put('max', 'users/max/media/m2/processed', image()));
  });
  it('allows Max to read their original object', async () => {
    await assertSucceeds(object('max', 'users/max/media/m1/original').getMetadata());
  });
  it('allows Max to read their processed object', async () => {
    await assertSucceeds(object('max', 'users/max/media/m1/processed').getMetadata());
  });
  it('allows canonical 12-period Max entitlement', async () => {
    await assertSucceeds(put('max12', 'users/max12/media/m1/original', image()));
  });
  it('allows unexpired Max grace entitlement', async () => {
    await assertSucceeds(put('grace', 'users/grace/media/m1/original', image()));
  });
  it('denies Free users upload', async () => {
    await assertFails(put('free', 'users/free/media/m1/original', image()));
  });
  it('denies Free users read', async () => {
    await assertFails(object('free', 'users/max/media/m1/original').getMetadata());
  });
  it('denies Pro users upload', async () => {
    await assertFails(put('pro', 'users/pro/media/m1/original', image()));
  });
  it('denies Pro users read', async () => {
    await assertFails(object('pro', 'users/max/media/m1/processed').getMetadata());
  });
  it('denies expired Max upload', async () => {
    await assertFails(put('expired', 'users/expired/media/m1/original', image()));
  });
  it('denies expired Max read', async () => {
    await assertFails(object('expired', 'users/max/media/m1/original').getMetadata());
  });
  it('fails closed when the authenticated user has no entitlement document', async () => {
    await assertFails(put('missing-entitlement', 'users/missing-entitlement/media/m1/original', image()));
  });
  it('does not trust a Max plan ID without an active paid status', async () => {
    await assertFails(put('forged', 'users/forged/media/m1/original', image()));
  });
  it('denies periods outside the supported 1–12 range', async () => {
    await assertFails(put('bad-period', 'users/bad-period/media/m1/original', image()));
  });
  it('denies non-canonical Max plan identifiers', async () => {
    await assertFails(put('bad-format', 'users/bad-format/media/m1/original', image()));
  });
  it('denies cross-UID object reads', async () => {
    await assertFails(object('free', 'users/max/media/m1/original').getMetadata());
  });
  it('denies cross-UID listing of private media', async () => {
    await assertFails(object('free', 'users/max/media').listAll());
  });
  it('denies cross-UID object writes', async () => {
    await assertFails(put('max', 'users/other/media/m1/original', image()));
  });
  it('denies unauthenticated object reads', async () => {
    await assertFails(environment.unauthenticatedContext().storage(bucket).ref('users/max/media/m1/original').getMetadata());
  });
  it('denies unauthenticated object writes', async () => {
    await assertFails(environment.unauthenticatedContext().storage(bucket).ref('users/max/media/m2/original').put(image()).then(() => undefined));
  });
  it('does not let Group Plan organization roles unlock personal media', async () => {
    for (const uid of ['group-admin', 'org-admin', 'partner-analyst']) {
      await assertFails(put(uid, `users/${uid}/media/m1/original`, image()));
      await assertFails(object(uid, 'users/max/media/m1/original').getMetadata());
    }
  });
  it('denies SVG active-content uploads', async () => {
    await assertFails(put('max', 'users/max/media/svg/original', image('image/svg+xml')));
  });
  it('denies non-image MIME uploads', async () => {
    await assertFails(put('max', 'users/max/media/text/original', image('text/plain')));
  });
  it('requires JPEG for the processed representation', async () => {
    await assertFails(put('max', 'users/max/media/png/processed', image('image/png')));
  });
  it('denies objects above the 50 MiB per-object limit', async () => {
    const oversized = new Blob([new Uint8Array(50 * 1024 * 1024 + 1)], { type: 'image/jpeg' });
    await assertFails(put('max', 'users/max/media/large/original', oversized));
  });
  it('denies unrecognized media variants', async () => {
    await assertFails(put('max', 'users/max/media/m1/thumbnail', image()));
  });
  it('denies paths outside the Surface media namespace', async () => {
    await assertFails(put('max', 'users/max/private/photo.jpg', image()));
  });
  it('does not allow client deletion of cloud objects without a deletion lifecycle', async () => {
    await assertFails(object('max', 'users/max/media/m1/original').delete());
  });
});
