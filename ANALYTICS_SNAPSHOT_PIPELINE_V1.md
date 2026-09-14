# Surface Analytics Snapshot Pipeline V1

Status: implemented locally; not deployed. No analytics dashboard or UI is included.

## Flow and trust boundary

Meaningful local Surface actions update an aggregate-only IndexedDB day counter. A debounced UID-keyed outbox entry stores only the Firebase UID, retry count, and next-attempt time. On submission the client rebuilds the snapshot from local records and day counters, validates its exact allow-listed structure, obtains the current Firebase ID token, and posts to `POST /analytics/member-snapshot` on the existing Surface payment backend. The endpoint verifies the token and derives UID, organization, role, and group association from Admin-verified membership documents. Firestore client rules remain the only client-side access policy and continue denying writes to organization analytics.

No private source record or submitted snapshot payload is persisted in the outbox. Analytics submission is asynchronous and failures do not block Surface actions.

## V1 definitions

- `analyticsVersion`: `1`.
- Window: the current UTC calendar date and preceding 29 UTC dates. `periodStart` is the first date's UTC midnight; `periodEnd` is the current date's final millisecond. All members generated on the same UTC date therefore share exact period boundaries.
- `peopleAdded`: PINs with `createdAt` inside the window, reconciled with aggregate-only local creation counters so local deletions do not erase historical counts.
- `activePins`: currently present PINs without `deletedAt`.
- `followupsDue`: non-deleted PIN follow-up dates within the window. `followupsMissed` is the subset whose due timestamp is earlier than snapshot generation. The PWA PIN model has no completion state; `followupsCompleted` is zero and marked unsupported. Due/missed counts are not presented as completion history.
- `relationshipStageCounts`: empty. Current PWA has no supported relationship-stage field.
- `stalePeopleCount`: active PINs whose `updatedAt` is older than the centralized 30-day V1 threshold. `updatedAt` is the available proxy for meaningful interaction; the current model has no separate interaction history.
- `notesCreated`: Notes with `createdAt` in the window, reconciled with local aggregate counters. Note content is never uploaded.
- `capturesCreated`: capture media with `createdAt` in the window, reconciled with local aggregate counters. Media IDs/references/content are never uploaded.
- `eventsCreated`: zero and marked unsupported. IIS telemetry and inferred meetings/reminders are not Surface Event entities.
- Qualifying activity for `activeDays`: PIN create/update, follow-up create/update, Note creation, and camera capture save. App opens, auth refresh, background sync, typing, and gallery imports do not count.
- `consistencyScore`: `round(activeDays / 30 * 100)`, bounded 0–100; eligible days are always 30.
- `activityByDay`: UTC date and numeric totals only; no record identifiers or user text.

## Cadence, retry, and retention

Meaningful local actions coalesce behind a 30-second debounce. An initial bounded snapshot is queued after signed-in local state hydration. Online/visibility events and a 60-second retry poll flush due work. Network/server failures use exponential backoff capped at one hour. A verified non-member response drops the pending entry; no entitlement-based eligibility is inferred. Local daily aggregates older than 400 days are pruned. The backend stores one deterministic member snapshot per `{uid}_30d` within each organization, group aggregates at `{groupId}_30d`, and organization aggregate at `30d`; the rolling snapshot is replaced on the next accepted submission.

## Membership movement and aggregation

Each accepted submission is written only beneath organizations with an active, valid membership at `organizations/{orgId}/members/{verifiedUid}` and an active organization/group. Server-side code owns all identity/association fields. Within an organization, the member snapshot records the current group. When a group changes, both the previous and current group aggregates are rebuilt from current active memberships and member snapshots, so the same member is counted in only the current group. Organization totals are computed directly from one current snapshot per active member, not by summing potentially duplicated group totals. Membership lifecycle changes should invoke a future trusted recomputation path if aggregates must update before the member's next snapshot.

## Access and exclusions

The backend uses Firebase Admin only after Firebase ID-token verification. The client cannot choose UID, organization, group, role, or partner status. Exact-key and bounded-count validation rejects arbitrary fields/text, IDs, coordinates, and unsupported data. Existing Firestore rules remain unchanged by this pipeline work: client writes to organization/member/group analytics remain denied, and organization roles do not grant access to private PINs, Notes, media, profiles, or Storage objects. No rules deployment was performed.

Before analytics UI, add an explicit PWA follow-up completion model and a real Event entity only through separately approved product work. Define a stage vocabulary only if Surface adds stage data. Validate membership lifecycle recomputation and server aggregation under the Firestore emulator before deployment.
