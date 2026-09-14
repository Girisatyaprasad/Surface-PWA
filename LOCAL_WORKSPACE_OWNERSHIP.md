# Local Workspace Ownership Audit

## Previous storage and ownership

Before this change, structured records were held in the device-wide IndexedDB database `surface-pwa` (version 4):

| Store | Contents | Previous ownership |
|---|---|---|
| `pins` | PINs, follow-up fields, NoteBlock/PIN references, media IDs, tombstones/revision metadata | Global to the browser profile |
| `notes` | Notes, attached media ID, revision metadata | Global to the browser profile |
| `syncOperations` | PIN, Note, and media upload/delete queue | Global; operations had no owner UID |
| `analyticsActivity` | Daily activity aggregates | Global; this was the attribution leak |
| `analyticsOutbox` | Snapshot retry metadata | Values included `ownerUid`, but the queue itself shared the global database |

Media blobs and metadata were in the separate device-wide IndexedDB database `surface-pwa-media` (version 1). `SurfaceMedia.pinIds`, PIN `mediaIds`, and Note `imageMediaId` relationships had no UID marker. Follow-ups are fields on PINs, not a separate store. No client-side IIS analytical store or other IIS local record pool was found. Organization/IIS analytics code consumes server-returned aggregate data; it does not create another local content database.

Other browser state: `surface-pwa-device-id` is a device identifier, not account content; `surface-location` is a device location cache used by camera flows; `surface-pending-order` is payment return state. Those are outside this migration's record workspace and were not changed. Firebase Auth persistence remains owned by Firebase Auth.

## Selected architecture

Use a separate IndexedDB database namespace per Firebase UID (one records database and one media database), with a stored `workspaceMetadata.ownerUid` marker validated whenever a database is first opened. All local record APIs require a non-empty UID. Main app reads pass the currently authenticated UID, clear in-memory content on every auth transition, and reject stale state updates after an account switch. Sync and analytics queues are read only from the originating UID namespace; network work checks that the same Firebase UID is still authenticated before sending or applying its result.

Namespace names:

- `surface-pwa-user-<encoded Firebase UID>`: PINs, Notes, relationships, follow-ups, sync operations, daily analytics, analytics outbox
- `surface-pwa-media-user-<encoded Firebase UID>`: captures, gallery blobs/metadata, media relationships

Free users still use their own local namespace. Cloud eligibility does not affect local ownership.

Opening a namespaced database with no owner marker is allowed only when all its data stores are empty. A populated database with a missing marker is treated as ambiguous and access fails closed; its records are not adopted, changed, or deleted.

## Legacy data policy

The previous shared databases contain no trustworthy Firebase UID ownership marker. The PWA now checks store and follow-up counts only after a UID workspace has initialized. If data is available, it offers a one-time prompt; dismissal is remembered for that UID and a `Legacy local data` entry remains available in Account. No record contents are shown before the user chooses recovery.

Import requires two explicit user actions. The confirmation names the currently signed-in email and states that Surface cannot verify who created data in older versions. The read-only legacy stores are copied into the current UID workspace using allowlisted PIN, Note, reminder, relationship, and media fields. Unknown legacy account, organization, analytics, session, and cloud-path fields are not copied. Identical ID/content is deduplicated; a divergent collision receives a deterministic `__legacy_v1` ID, with relationships remapped to the copied records.

Recovery metadata lives in `surface-pwa-legacy-recovery`, separate from user content, with `not_started`, `in_progress`, `verified`, or `failed` state, migration version, claim UID, and claim timestamp. The shared source databases are never deleted. A transactional state lock prevents a second account/tab from claiming during an active copy. Verification checks PIN, Note, reminder, and media counts, record equality, UID-scoped destinations, blobs, and references before the claim is recorded. Failure leaves the source untouched, marks the attempt failed where possible, and allows the same UID to retry; partial destination writes are safely deduplicated on retry. A verified dataset is no longer offered to any other UID, and claim UID is never returned by the status API.

The old `analyticsOutbox.ownerUid` identifies a remote snapshot recipient, not ownership of shared content, and is not used to claim records. While recovery is `in_progress`, the Surface member-analytics pipeline fails closed at activity recording, queueing, snapshot generation, and submission. The PWA has no client-side IIS envelope submission path; its organization/IIS analytics code only aggregates server-returned data. Legacy databases themselves are never analyzed.

## Account deletion

The current account screen performs privileged cloud deletion and always keeps local data; it has no erase-local choice. That behavior is unchanged: local data is retained because the account-scoped databases are not deleted on sign-out or account deletion. `eraseLocalWorkspace(uid)` deletes only that UID's records and media databases and is not invoked by the current account-deletion flow.

## Attribution and access invariants

- A signed-out app loads no PINs, Notes, captures, or gallery media.
- User A and User B use different IndexedDB databases; there is no “load all” fallback.
- Every app data mutation, hydration, queue operation, and analytics read receives an explicit UID.
- Analytics snapshots read PINs, Notes, media, activity aggregates, and retry state from one UID namespace only, and are abandoned if authentication changes mid-read/send.
- A legacy claim can only be recorded after explicit user confirmation and successful UID-workspace verification; legacy source databases remain preserved.
- A sign-out or account switch during migration aborts before claim, and recovery UI is cleared when the authenticated UID changes.
- Organization membership, rank, and admin status do not participate in local workspace selection.
- Local account deletion cannot erase another UID's namespace.
