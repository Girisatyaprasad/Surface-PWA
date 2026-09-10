# Phase 1B PIN Sync Contract

Phase 1B synchronizes only basic PIN records for authenticated Pro and Max
accounts. Free accounts remain local-only.

## Firestore path

`users/{uid}/pins/{pinId}`

The client writes only under the currently authenticated UID and includes:

- `id` matching `pinId`
- `uid` matching the authenticated UID
- `name`
- `about`
- `createdAt`
- `updatedAt`
- `revision`
- `updatedByDeviceId`
- `schemaVersion: 1`

The owner-scoped rule is in the Kotlin project's `firestore.rules`. It must be
deployed before cloud upload or hydration can pass live validation.

## Local-first behavior

PIN writes complete in IndexedDB before a cloud operation is queued. Pending
upserts retry with bounded exponential backoff. Hydration writes remote records
to IndexedDB before rendering them. No PIN content is uploaded for Free users.

This contract deliberately excludes Notes, Gallery, Captures, media, reminders,
payments, and general synchronization until a later approved phase.
