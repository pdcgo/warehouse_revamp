# document_service — lock order

The service-wide matrix the `audit-sql` skill writes unconditionally. Not a finding — the reference the next
write handler is checked against.

**Verdict: no handler takes a row lock.** Object storage is never written inside a database transaction, and every
delete is by id. Raced: **safe** for `ProfilePictureErase`; the rest below are listed, not raced in this pass.

| Handler | What it writes | Notes |
| --- | --- | --- |
| `ProfilePictureErase` | the stored files (outside any transaction) → one transaction: `document_shares` delete, `documents` delete, by id | idempotent: a missing file and a missing row are both nothing to do |
| `RequestUpload`, `ConfirmUpload` | one `documents` row; ConfirmUpload moves its object | ⚠ not raced in this pass |
| `ShareDocument` | one `document_shares` row | ⚠ not raced in this pass |

Evidence: [`profile_picture_erase_race_test.go`](../../../../backend/services/document_service/document_v1/profile_picture_erase_race_test.go) (`raceaudit`).

| proved | how |
| --- | --- |
| four erases of one person at once all succeed and leave nothing | 30 runs × 20 rounds of four simultaneous calls over three photos, one shared → no row, no file, no thumbnail, no error |

**Found and fixed by it:** the local store's delete failed for the second of two simultaneous deletes of one file on
Windows (*Access is denied*, the file still mid-delete). `LocalStore.Delete` now retries briefly, and
`TestLocalStore_DeleteTwiceAtOnce` pins it. A cloud store's delete is idempotent by itself.

| History | |
| --- | --- |
| 2026-10-06 | first matrix — `ProfilePictureErase` |
