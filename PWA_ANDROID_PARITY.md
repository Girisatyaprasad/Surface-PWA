# PWA Android Parity

## Phase 2B: PINs

Reference: `Surface/app/src/main/java/com/example/surface/ui/pins/PinsScreen.kt` and `PinsViewModel.kt`.

| Area | Kotlin reference | PWA implementation | Status |
|---|---|---|---|
| PIN list and empty state | `PinsScreen.kt` | `src/main.tsx` (`Pins`) | PASS |
| Create PIN | `NewPinScreen` / `NewPinViewModel` | `src/main.tsx` (`PinForm`) + `src/db.ts` | PASS |
| PIN detail | `PinDetailScreen` | `src/main.tsx` (`PinDetail`) | PASS |
| Edit PIN | `EditPinBlock` / `PinDetailViewModel` | `src/main.tsx` + `src/db.ts` | PASS |
| Delete confirmation | `ConfirmOverlay` / repository delete | `src/main.tsx` + IndexedDB delete queue | PASS |
| Follow-up data | `FollowUpOverlay` | `src/main.tsx` local follow-up fields | PARTIAL |
| Offline local-first behavior | repository flows | `src/db.ts` | PASS |
| Paid PIN sync | repository/cloud contract | `src/sync.ts` | PASS |

Remaining differences are platform scope: browser notifications are not scheduled yet, media attachments are deferred, and the other Surface screens are intentionally outside Phase 2B.

## Phase 2C: Notes, Search, Profile, Account

| Area | Kotlin reference | PWA implementation | Status |
|---|---|---|---|
| Notes list and empty state | `ui/notes/NotesScreen.kt` | `src/main.tsx` (`Notes`) | PASS |
| Note create/edit/delete/detail | `NotesScreen.kt` / `NotesViewModel.kt` | `src/main.tsx`, `src/db.ts` | PASS |
| Local Search for PINs and Notes | `ui/search/SearchScreen.kt` | `src/main.tsx` (`Search`) | PASS |
| Profile rows and separate Account entry | `ui/profile/ProfileScreen.kt` | `src/main.tsx` (`Profile`) | PASS |
| Account profile fields | `ui/profile/AccountScreens.kt` | `src/main.tsx` (`Account`) | PARTIAL |
| Password reset/change | `AccountScreens.kt` / Firebase Auth | `src/main.tsx` | PASS |
| Privileged account deletion | `FirebaseAccountRepository.kt` | `src/main.tsx` `/account/delete` | PARTIAL |
| Sign out and local data preservation | `AccountScreens.kt` | `src/main.tsx` | PASS |

Phase 2C was validated by typecheck, tests, and production build. Browser/live-account validation remains outstanding. Username is represented by the existing display-name field, email remains Auth-owned, and deletion keeps local IndexedDB data as approved. Media, camera, push, and payment work remain deferred.

## Phase 2D: Surface Pro and Payments

| Area | Reference | PWA implementation | Status |
|---|---|---|---|
| Free / Pro / Max plan presentation | `ui/profile/ProfileScreen.kt` | `src/main.tsx` (`SurfacePro`) | PARTIAL |
| 1-12 period selector and totals | `SurfaceProScreen` / backend `plans.ts` | `src/payments.ts`, `src/main.tsx` | PASS |
| Authoritative entitlement and expiry | `ProStatusRepository` / `users/{uid}` | `src/entitlement.ts`, `src/main.tsx` | PASS |
| Hosted Cashfree create-order | `CashfreePaymentService` / Render API | `src/main.tsx` | PARTIAL |
| Payment return and verification | Render `/payments/verify` | `src/main.tsx` focus reconciliation | PARTIAL |
| Phone normalization | Kotlin payment flow / backend validation | `src/payments.ts` | PASS |

The existing backend already supports server-side PRO/MAX pricing and periods 1-12. Live checkout and return verification were not performed in this validation pass. Camera, Gallery, Captures, media sync, and Web Push remain deferred.

## Phase 3: Local Media

| Area | Kotlin reference | PWA implementation | Status |
|---|---|---|---|
| Camera capture / image picker fallback | `ui/camera/CameraScreen.kt` | `src/main.tsx` (`Camera`) | PARTIAL |
| Cached/non-blocking location label | camera metadata flow | `src/main.tsx` geolocation request | PARTIAL |
| Shutter-time metadata and burned overlay | camera capture metadata | `src/media.ts` | PARTIAL |
| IndexedDB original/processed media | `data/CoreRepositories.kt` media model | `src/media.ts` | PASS |
| Gallery grid and empty state | `ui/gallery/GalleryScreen.kt` | `src/main.tsx` (`MediaGrid`) | PASS |
| Captures list and metadata | `ui/captures/CapturesScreen.kt` | `src/main.tsx` (`MediaGrid`) | PASS |
| Shared fullscreen viewer | Gallery/Captures viewer composables | `src/main.tsx` (`MediaViewer`) | PARTIAL |
| PIN media attachment | `PinsScreen.kt` media links | `src/main.tsx` (`PinDetail`, `MediaGrid`) | PASS |
| Notes media attachment | `NotesScreen.kt` | not present in current Kotlin flow | TODO |
| Offline media persistence | native local media repository | IndexedDB blobs | PASS |
| Export/share | Android save/share actions | `src/main.tsx` (`MediaViewer`) download fallback | PARTIAL |

PWA limitations: volume-button shutter, native CameraX latency guarantees, unrestricted filesystem access, guaranteed Photos-library save, and exact native pinch/pan gesture physics require native iOS/Android capabilities. Firebase Storage setup is still required before media upload can be live-tested.

## Phase 4: Eligible Cloud Sync

| Area | PWA implementation | Status |
|---|---|---|
| Notes bidirectional sync | `src/cloudSync.ts`, `src/db.ts`, `src/main.tsx` | PARTIAL |
| PIN full-field sync | existing `src/sync.ts` with revision/device metadata | PARTIAL |
| Gallery/Captures media metadata | `src/cloudSync.ts` | PARTIAL |
| Firebase Storage original/processed upload | `src/cloudSync.ts` | BLOCKED |
| Lazy media hydration | metadata path prepared; local blob download not yet implemented | TODO |
| PIN-media relationship metadata | local links implemented; cloud relation upload not yet complete | PARTIAL |
| Offline queue and retry | IndexedDB queue and retry retained | PARTIAL |
| Tombstone deletion propagation | note tombstone queue prepared; remote cleanup policy retained | PARTIAL |
| Conflict preservation | revision metadata prepared; conflict-copy UI not yet implemented | TODO |
| Firestore owner rules | Notes/media rules deployed | PASS |
| Storage owner rules | `Surface/storage.rules` prepared | BLOCKED |

Phase 4 implementation is not live-validated cross-device. Firebase Storage must be enabled in the Firebase Console before media uploads can run. Phase 5 Web Push work was not started.

## UI parity audit

The global web shell was removed from non-Home routes. Home now follows the Kotlin spacing hierarchy and uses the ported Gallery, Notes, Camera, PINs, and Search vector assets. Marketing/helper copy, visible sync status, placeholder Gallery/Camera sections, and the global ground bar on secondary routes were removed. Subscriptions is the user-facing name for the plan screen. Remaining differences are browser platform behavior in Camera and media gestures; native Kotlin-only semantics cannot be reproduced exactly in a browser PWA.
