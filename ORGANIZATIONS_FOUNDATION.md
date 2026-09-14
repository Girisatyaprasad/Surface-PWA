# Surface Organizations Foundation

Status: organization foundation plus a local, not-yet-deployed trusted analytics snapshot pipeline. No organization UI, organization provisioning API, or new event-management feature is included.

## Existing Architecture Audit

- Surface PWA PINs, Notes, Captures, and media remain local-first in IndexedDB. Existing cloud sync uses the owner-scoped `users/{uid}` tree.
- The shared production Firestore rules live at `C:\Users\apple\OneDrive\Documents\Surface\firestore.rules`. Organization rules and an owner-read-only personal analytics path were added there. Existing private user/PIN/Note/media, admin, IIS, and audit rules were retained unchanged.
- Android `IisEventEntity` / `iisEvents` are operational IIS telemetry, including UI actions and delivery batches. They are not explicit user-created Surface events and MUST NOT feed `eventsCreated`.
- No current Surface organization/group/membership model or relationship-stage field was found.

## Data Model

- `organizations/{organizationId}`: id, name, optional companyKey, status, createdAt, createdBy, updatedAt.
- `organizations/{organizationId}/groups/{groupId}`: id, organizationId, name, optional parentGroupId, status, createdAt, updatedAt.
- `organizations/{organizationId}/members/{uid}`: uid, organizationId, optional groupId, active/inactive status, joinedAt, updatedAt, explicit `surfaceRole`, optional companyRank and recognitionTitle.
- Roles are exactly `member`, `group_admin`, `org_admin`, `partner_analyst`. Rank and recognition fields are descriptive only.

Type definitions are in `src/organizations/model.ts`; Firestore path builders are in `src/organizations/firestorePaths.ts`.

## Analytics Contract

`MemberAnalytics` is a numeric/category-only snapshot scoped by uid, organization, and period. It includes counts for people, active PINs, follow-ups, stale people, Notes, Captures, events, active days, consistency, allow-listed relationship-stage codes, and day buckets. It contains no prospect IDs/names/phones, note text, capture references, coordinates, or next-action text.

The builder reconstructs the output from an explicit field allow-list; unknown input keys are ignored. Relationship-stage codes are omitted unless supplied through an approved `stage_*` allow-list. No stage vocabulary is invented here.

`GroupAnalytics` and `OrganizationAnalytics` contain aggregate counts, explicit active/inactive membership rates, stage totals, consistency averages, and daily activity. Event counts include bounded period `eventsCreated`, plus 7-day and 30-day counts from daily numeric buckets. There is no all-time count until a bounded retention/aggregation policy is approved.

Aggregation helpers are in `src/organizations/analytics.ts`. They aggregate only already-safe snapshots, not private Surface records.

## Event Source

There is no explicit user-created Surface Event entity. `eventsCreated` therefore remains zero/unpopulated until a separate, explicit Event product model is approved. IIS telemetry and inferred invitations, meetings, talks, or presentations are excluded.

## Permission Boundaries

- A member can read their own personal analytics. Existing private user/PIN/Note/media rule behavior is unchanged.
- A group admin can read aggregate analytics for their assigned group and group membership metadata within that group; no private member records.
- An organization admin can read organization and group aggregates and manageable membership metadata; no per-member analytics or private member records.
- A partner analyst must have an explicit active `partner_analyst` membership. It can read authorized member metric snapshots and group/organization aggregates, never their source PINs, Notes, media, Storage objects, or private user document.
- Client writes to organization, membership, and analytics collections are denied. The additive `POST /analytics/member-snapshot` backend path verifies Firebase identity, resolves active membership server-side, validates the analytics envelope, and writes snapshots/aggregates using Admin SDK authority. Firestore rules are not deployed by this task.
- Organization roles do not change `users/{uid}` permissions. Existing global Surface `adminRoles` access remains a separate pre-existing privileged mechanism; organization roles do not create that role.
- Entitlement (Free/Pro/Max), upline, downline, sponsor, rank, and recognition titles do not participate in authorization.

Rules were added to the existing shared rules file without changing existing PIN/Note/media, admin, IIS, or audit rules. The emulator test uses `firebase.organizations-test.json` and reads that canonical shared rules file.

## Activity Semantics

Membership `active`/`inactive` is explicit membership status. It is not an inferred sales or app-usage score. Analytics V1 uses a rolling 30-UTC-calendar-day window and the deterministic activity/consistency definitions in [ANALYTICS_SNAPSHOT_PIPELINE_V1.md](ANALYTICS_SNAPSHOT_PIPELINE_V1.md). Follow-up completion, relationship stages, and explicit user-created events remain unsupported by the current PWA model.

## Validation

Pure model/aggregation/permission tests: `npm run test`.

Firestore Emulator rules tests (Firebase CLI and Java required):

```sh
firebase emulators:exec --only firestore --config firebase.organizations-test.json --project demo-surface-organizations "npx vitest run src/organizations/firestore.rules.test.ts"
```

No rules deployment is configured or performed from the PWA project.

## Before Admin Analytics UI

1. Approve a trusted organization/membership provisioning backend and its audited operator workflow.
2. Define relationship-stage codes and their local aggregation source, if stages are added to Surface.
3. Define activity/consistency formulas and snapshot cadence/retention.
4. Add a genuine explicit Event entity before populating event counts.
5. Decide member display labels for partner analytics without reading private `users/{uid}` profiles.
6. Add backend verification and snapshot publication; keep client writes denied.
7. Validate membership lifecycle recomputation and backend Firestore aggregation with the emulator before deployment.
