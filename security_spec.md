# YAAD Launch Offer Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Global Default-Deny**: All paths not explicitly matched (`/launch_offer/counter`, `/launch_claims/{uid}`, `/launch_recovery/{hash}`) are unconditionally denied (`allow read, write: if false`).
2. **Strict 730 Cap on Counter (`/launch_offer/counter`)**:
   - Can only be created with `count == 1` or updated when `existing().count < 730` and `incoming().count == existing().count + 1` (`1 <= count <= 730`).
   - Must be updated in the exact same atomic transaction that creates `/launch_claims/{request.auth.uid}` with matching `userNumber == incoming().count` and `batch` in `[1, 2]`.
3. **No Zero-Batch Claims (`/launch_claims/{uid}`)**:
   - `userNumber` must be an integer in `1..730` and `batch` must be `1` (`1..365`) or `2` (`366..730`). `batch == 0` is strictly forbidden.
   - A claim can only be created via an atomic counter increment OR created/updated via atomic consumption (`!existsAfter`) of a valid `/launch_recovery/{recoveredFromHash}` document whose `userNumber` and `batch` match.
4. **One-Time Hashed Recovery Codes (`/launch_recovery/{hash}`)**:
   - Document ID `{hash}` must be a 64-character lowercase SHA-256 hex string (`^[a-f0-9]{64}$`). Raw recovery codes are never stored in Firestore.
   - Collection listing is forbidden (`allow list: if false`).
   - Only a user whose `/launch_claims/{uid}` document has the exact same `userNumber` and `batch` can create `/launch_recovery/{hash}`.
   - Deletion of `/launch_recovery/{hash}` is only permitted by the original owner or in an atomic recovery transaction that writes `/launch_claims/{request.auth.uid}` with `recoveredFromHash == hash`.

## 2. The "Dirty Dozen" Payloads (Must All Return `PERMISSION_DENIED`)
1. Unauthenticated read or write to `/launch_offer/counter`.
2. Incrementing `/launch_offer/counter` past 730 (`count: 731`).
3. Incrementing `/launch_offer/counter` by +2 (`count: existing.count + 2`).
4. Updating `/launch_offer/counter` without atomically creating `/launch_claims/{uid}`.
5. Creating `/launch_claims/{uid}` with `batch: 0` or `userNumber: 731`.
6. Creating `/launch_claims/{uid}` with mismatched batch (`userNumber: 500, batch: 1`).
7. Creating `/launch_claims/{uid}` for another user's UID (`uid != request.auth.uid`).
8. Creating `/launch_claims/{uid}` via `recoveredFromHash` when `/launch_recovery/{hash}` does not exist.
9. Creating `/launch_claims/{uid}` via `recoveredFromHash` without deleting `/launch_recovery/{hash}` in the same transaction.
10. Listing `/launch_recovery` (`allow list: if false`) to scrape hashes.
11. Creating `/launch_recovery/{hash}` with a non-SHA256 document ID or without owning a matching `/launch_claims/{uid}`.
12. Injecting a shadow field (`isAdmin: true`) into `/launch_offer/counter`, `/launch_claims/{uid}`, or `/launch_recovery/{hash}`.
