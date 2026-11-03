# Found stock — concurrency audit (FoundRequestCreate · FoundRequestApprove · FoundRequestReject · the finalize's settle)

**Verdict:** 🟢 safe — every interleaving that could post a found twice, decide a request twice or deadlock against an
order's take or a count was raced and holds. One known, accepted behaviour: **two identical reports are two requests**.
**Audited:** 2026-11-03 · `inventory_v1/found_request_{create,approve,reject}.go`, `found_request_mapper.go`
(`settleFoundByCount`), `opname_session_finalize.go`, `inventory_mutations/post_found.go` → `PostCountFinalize` ·
READ COMMITTED · `found_request_race_test.go` (`-tags raceaudit`, `-p 1`)

---

## Locks, in acquisition order

| Writer | Locks, in order | Row order |
| --- | --- | --- |
| `FoundRequestCreate` | none held — the rack check, `RefuseCounted` (a plain read) and the never-stocked read, then one `INSERT` | n/a |
| `FoundRequestApprove` | **the request row** `FOR UPDATE` → (an early `RefuseCounted` read) → the register's open losses `FOR UPDATE` → the batches `FOR UPDATE` → the rack row `FOR UPDATE` → `RefuseCounted` again (`CountFinalize.Guard`, its own statement) → writes → **liability** (`PostStockDamage`, in the tx) → the request's update | losses oldest first; batches and racks by id — the count's own |
| `FoundRequestReject` | **the request row** `FOR UPDATE` → its update | one row |
| `OpnameSessionFinalize` | the session `FOR UPDATE` → **the WAITING found requests it settles** `FOR UPDATE` → the register → the batches → the racks → liability | requests `ORDER BY id` |
| `OrderTransactionCreate` (a take), `OpnameSessionCreate` (a plan) | never touch `found_requests` | — |

**Why nothing waits in a circle.** The request row is taken FIRST by every writer that takes it, and a finalize takes
the requests after only its session — which no approval takes. Below the request row the approval is the count's own
finalize, so it shares the count's register → batches → racks order with every finalize and every take. Liability sits
last, as everywhere in this service.

---

## The races

| # | Race | Result | Proof |
| --- | --- | --- | --- |
| 1 | eight Owners and Admins approve one request at once | the first posts, seven find it no longer waiting (FailedPrecondition); one `found` transaction, both ledgers equal | `TestRace_FoundRequestApprove_PostsOnce` |
| 2 | an approval and the reporter's withdrawal | exactly one decides, ten rounds (4 approved, 6 withdrawn in the recorded run); units posted once per approval | `TestRace_FoundRequestApprove_RacingAWithdraw` |
| 3 | an approval and eight order takes of the product | no deadlock, no failure; batches and racks both 20 + 2 − 8 | `TestRace_FoundRequestApprove_RacingTakes` |
| 4 | an approval and a count's plan of the product, then the finalize | the three found units post ONCE either way: approved first → the plan's snapshot includes them and the count finds Rak A exact; planned first → the approval is refused naming the count and the finalize settles the request. Ten raced rounds plus each order forced once | `TestRace_FoundRequestApprove_RacingACountPlanAndFinalize` |
| 5 | the settle against an approval holding the request | the settle's `SELECT … FOR UPDATE WHERE status = 'waiting'` blocks, then re-checks the committed row and leaves it | `TestInterleave_FoundRequest_TheSettleWaitsForAnApproval` |

```sh
go test -tags raceaudit -p 1 -run "TestRace_FoundRequest|TestInterleave_FoundRequest" -v ./backend/services/inventory_service/inventory_v1/
```

### Why race 4 cannot post twice

The plan locks the product's shelf rows `FOR SHARE`; the approval locks the rack row `FOR UPDATE` and only then reads the
count lock. Whichever commits first, the other sees it: a plan that waited on the approval snapshots the book with the
found units in it; an approval that waited on the plan reads the plan's open snapshot row and is refused. A request still
WAITING when the count finalizes is settled by it — the count posted those units as its own surplus.

---

## Findings

### two-identical-reports-are-two-requests 🟡 (accepted — not decided otherwise)

`FoundRequestCreate` takes no lock and has no idempotency key: a double click, or two people reporting the same units,
writes two WAITING requests. Neither posts anything, the approver sees both side by side (same product, rack, units,
reporter, seconds apart) and rejects one; approving both would add the units twice, which is the approver's call.

**→ Recommend:** leave it until the owner decides otherwise — an idempotency key would be a contract change nobody asked
for, and a duplicate here costs nothing until a person approves it.

### the-preview-is-read-without-locks 🟢

The list's would-post lines are worked out from a plain read, each request alone. Two waiting requests may both show the
same open loss; the first approval claims it under the register's lock and the second, re-reading under lock, mints
instead (`TestFoundRequestApprove_NeverClaimsMoreThanClaimable`). The screen can be stale, the books cannot.

---

## Not proved

- a finalize and an approval of **different** requests over the same product and racks — both take register → batches →
  racks in the count's order, so they queue; reasoned, not raced
- Root approving while a liability posting fails — the approval rolls back whole (the poster is in the transaction), as a
  finalize does; not raced
