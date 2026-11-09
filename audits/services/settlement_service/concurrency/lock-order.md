# settlement_service — lock order

The service-wide matrix the `audit-sql` skill writes unconditionally. It is not a finding; it is the reference
the **next** write handler is checked against, and the only artefact that can show a lock inversion — which is
invisible from inside any one handler.

| | |
| --- | --- |
| Isolation | READ COMMITTED (Postgres default — nothing in this repo raises it) |
| Last swept | 2026-11-05 — the person re-fold and the later-day shift (`DayRefold` on `settlement-user-daily`, [the-person-report-refolds-too](../../../../docs/business/settlement/context_decision.md#the-person-report-refolds-too), [a-refold-shifts-the-later-days](../../../../docs/business/settlement/context_decision.md#a-refold-shifts-the-later-days)) · 2026-11-05 — the day re-fold (`DayRefold`, `san report refold`, [a-wrong-day-is-refolded-from-the-log](../../../../docs/business/settlement/context_decision.md#a-wrong-day-is-refolded-from-the-log)) · 2026-11-05 — the opening stamped on the order after the commit (`markOpened` → `SettlementOpened`, [a-missing-account-is-found-by-its-opened-at](../../../../docs/business/settlement/context_decision.md#a-missing-account-is-found-by-its-opened-at)) · 2026-09-29 — the imported shop row's ask ([settlement-asks-the-shop-for-its-primary-cs](../../../../docs/business/settlement/settlement_importer_decision.md#settlement-asks-the-shop-for-its-primary-cs)) |

**Verdict: two disjoint lock domains, one row lock per post, a fixed advisory order in the fold — no inversion.**

---

## The hierarchy

```mermaid
flowchart LR
  subgraph "the ledger — SettlementPost, PostEntry, CancelSale"
    ask["the ask — ShopAccessCheck, NO lock, before BEGIN"] --> acct["ONE account row FOR UPDATE — order_settlements or shop_settlements"]
    acct --> key["settlement_logs — the unique_id it inserts"]
  end
  subgraph "the reports — the fold"
    meta["settlement_service_metadata — process_event_lock FOR SHARE"] --> claim["settlement_event_logs — the claim"]
    claim --> shopadv["advisory lock — settlement-shop, team, shop"]
    shopadv --> useradv["advisory lock — settlement-user, team, user"]
    useradv --> rows["report rows — shop tables, then user tables"]
  end
  key -. "after COMMIT — SettlementLogPosted" .-> meta
  subgraph "the day re-fold — DayRefold, san report refold"
    rmeta["process_event_lock FOR SHARE"] --> rclaim["settlement_event_logs — the lost rows' claims, log id order"]
    rclaim --> radv["advisory lock — settlement-shop, team, shop — OR settlement-user, team, user — team order"]
    radv --> rrows["that report's day row, its later days' carry, its state row"]
  end
```

---

## Per handler, in acquisition order

| Handler | Locks, in order | Row order within the table |
| --- | --- | --- |
| `SettlementPost` / `PostEntry` / `CancelSale` — an **order** row | `order_settlements` (insert-if-absent, then `FOR UPDATE`) → `settlement_logs` key → the same account row, `UPDATE` | one row — n/a |
| …and its `initial_total`, after the commit | *(the transaction has ended — nothing held)* → the order service's `SettlementOpened`, in-process: `orders` (1 row, `UPDATE … WHERE settlement_opened_at IS NULL`, autocommit) | one row — n/a. Never inside the ledger's transaction, so the order row is never held with the account (a-missing-account-is-found-by-its-opened-at) |
| `SettlementPost` — a **shop** row, hand-posted | `shop_settlements` (insert-if-absent, then `FOR UPDATE`) → `settlement_logs` key → the same row, `UPDATE` | one row — n/a |
| `SettlementPost` — an **imported shop** row | *the ask — no lock* → then exactly the hand-posted shop row's order | one row — n/a |
| the fold — `/event/settlement-fold/push` | `settlement_service_metadata` `FOR SHARE` → `settlement_event_logs` claim (PK) → advisory `settlement-shop:{team}:{shop}` → advisory `settlement-user:{team}:{user}` → `shop_settlement_daily_reports`, `shop_settlement_reports` → `user_settlement_daily_reports`, `user_settlement_reports` | the day's row, then every later day in one `UPDATE`, then the state row |
| `DayRefold` — `san report refold`, the shop report | `settlement_service_metadata` `FOR SHARE` → `settlement_event_logs` claims of the day's LOST rows (PK, `ON CONFLICT DO NOTHING`), in log-id order → advisory `settlement-shop:{team}:{shop}` per team, in team order → `shop_settlement_daily_reports` (the day: upsert or delete, then every later day in one `UPDATE` — the fold's shift), `shop_settlement_reports` | the claims by log id, so two re-folds claim in one order; never a user key, so the fold's shop → user order is never crossed |
| `DayRefold` — the person report (`settlement-user-daily`) | `settlement_service_metadata` `FOR SHARE` → the same claims, log-id order → advisory `settlement-user:{team}:{user}` per team, in team order → `user_settlement_daily_reports` (the day, then the later days), `user_settlement_reports` | never a shop key: it holds only the fold's SECOND key, which a fold takes last, so a fold waiting on it holds nothing the person re-fold wants |
| `AnalyticReplayCompute` | `settlement_service_metadata` compare-and-set (its own statement) → one transaction: `DELETE` shop days → user days → `settlement_event_logs` → the metadata row back | set-based deletes |
| `AnalyticMaintenanceRun` | `DELETE settlement_event_logs` — one statement | set-based |
| `OrderSettlementList`, `OrderSettlementDetail`, `Analytic*` | none — reads | — |

---

## Why there is no cycle

1. **A post takes ONE row lock** — its account — and inserts one key after it. There is no second lock to take
   in the other order, and a waiter on a key holds only its own account, which the key's owner never wants.
2. **The ledger and the reports share no table.** The fold runs off an event published after the post
   commits — never inside it.
3. **The fold's advisory locks are shop THEN user, always**, in two namespaces. A fold never takes a shop key
   after a user key, so two folds can share a key but never wait on each other in a circle. Since 9f20652 an
   imported shop row folds under its **primary CS**, so one person's user key is shared by every shop they are
   primary of — more contention on that key, and still no cycle (crossed and raced, below).
4. **The day re-fold takes the fold's shape, minus one key.** Claims before advisory locks — the fold's order — so a
   fold waiting on the re-fold's claim of the same row holds no advisory lock, and the re-fold waiting on a fold's claim
   holds none either. The shop re-fold takes only shop keys, the person re-fold only user keys — each one of the fold's
   two, never both, so neither can cross the fold's shop → user order; and nobody waits on a claim while holding an
   advisory key. Two re-folds of either report claim in log-id order, so they never cross each other. Proved by
   `TestRace_Refold_AFoldRacingItCountsEveryRowOnce` (two re-folds, the folds of two in-flight rows and the redeliveries
   of two lost rows, 10 rounds, both orderings hit: every row counted once, no 40P01),
   `TestRace_Refold_TheLaterDaysTakeEveryShiftOnce` (two re-folds of the middle day beside in-flight folds on it, a late
   event on the day before and a new one on the day after: every day equals its log and opens at the close before it,
   10 rounds) and `TestRace_Refold_TheShopAndPersonRefoldsCountEveryRowOnce` (the shop and the person re-fold of one
   day at once with the folds: both reports hold every row once — the lost rows claimed by the shop re-fold 10, by the
   person re-fold 2, by their redelivery the rest).
5. **The replay gates the fold through one row.** Its compare-and-set waits for every in-flight fold's
   `FOR SHARE`; every fold after it reads the lock and leaves — the replay's delete never meets a fold.

---

## The cross-service call sits OUTSIDE the matrix — and must stay there

- **The ask is the service's only call into another service**, and it runs before BEGIN — proved: a post to
  the same shop committed while an ask was parked, and `FOR UPDATE NOWAIT` on the account succeeded.
- ⚠ **Never move it inside the transaction.** "Ask only when the key is new", done by asking after the
  transaction's `unique_id` lookup, would hold the shop's account across a network call: every post on the shop
  would queue behind the shop service. A key lookup that spares retries the ask must run **before** BEGIN too
  ([SettlementPost performance finding 2](../performances/SettlementPost.md#2-the-ask-runs-before-the-idempotency-check-)).
- **By design:** the primary is read outside the transaction, so a primary changed between the ask and the
  commit counts the row for the previous one — "the one at import time". No lock can make that read atomic
  with the write.

## ⚠ One key across two accounts

`settlement_logs.unique_id` is unique across the whole log (00002). Two accounts inserting one key at once: the
second waits on the first's key, then fails 23505. No cycle — it holds only its own account. The answer was
`internal` ([SettlementPost concurrency finding 1](SettlementPost.md#1-a-key-colliding-across-accounts-at-once-answers-internal----fixed));
✅ since 2026-11-05 the 23505 maps to `errUniqueIDTaken`, `invalid_argument`, like a collision one at a time
([a-colliding-key-at-once-is-refused-the-same](../../../../docs/business/settlement/context_decision.md#a-colliding-key-at-once-is-refused-the-same)).

---

## Proved

| Test | `-count=20` |
| --- | --- |
| `TestInterleave_ImportedShopRow_TheAskHoldsNoLock` | 20 of 20 — the ask holds no lock |
| `TestInterleave_ImportedShopRow_APosterHoldingTheAccountBlocksTheNext` | 20 of 20 — the account lock holds, the waiter re-reads |
| `TestRace_ImportedShopRow_ABurstLosesNothingAndCountsForThePrimary` | 20 of 20 |
| `TestRace_ImportedShopRow_ImportedAndManualShareOneAccount` | 20 of 20 |
| `TestRace_ImportedShopRow_SameKeyWritesOnce` | 20 of 20 |
| `TestRace_ImportedShopRow_FoldsCrossingShopsAndPrimariesNeverDeadlock` | 20 of 20 — 0 deadlocks |
| `TestRace_Fold_ConcurrentDaysKeepTheCarryTrue`, `TestRace_Fold_ARedeliveryStormFoldsOnce` | 20 of 20 |
| `TestRace_SettlementPost_DoesNotLoseAnUpdate`, `…AbsorbsConcurrentRetries` | 20 of 20 — the order grain |
| `TestRace_SettlementPost_ShopGrainDoesNotLoseAnUpdate` | ✅ repaired (a `ShopPrimary` stub, SettlementPost finding 2) — green 2026-11-05 |
| `TestInterleave_ImportedShopRow_AKeyCollidingAcrossShopsIsRefusedTheSame` | ✅ green 2026-11-05 (`-count=10`; was `…AnswersInternal`, red by design) — both orders answer `invalid_argument`, 20 of 20 real collisions |

```sh
go test -tags raceaudit -run "TestRace_ImportedShopRow|TestInterleave_ImportedShopRow|TestRace_Fold_|TestRace_SettlementPost_" ./backend/services/settlement_service/settlement_v1/
```

## Not proved

- a lock inversion against another service — selling posts in-process **after** its own commit; the importer
  calls over Connect, and whether it holds a lock of its own across that call is its own audit
- a hung shop service — no lock is held, but nothing bounds the ask (`http.DefaultClient`, no timeout)
- connection-pool exhaustion
