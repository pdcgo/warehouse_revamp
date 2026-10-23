# selling_service — lock order

The service-wide matrix that the `audit-sql` skill writes unconditionally. It is not a finding: it is the reference
the next write handler is checked against.

| | |
| --- | --- |
| Isolation | READ COMMITTED (Postgres default; nothing in this repo raises it) |
| Last swept | 2026-10-21, adding `OrderStatusChange` (replacing the four per-step RPCs) and `TeamReturnConfigurationSet` · before that 2026-09-29, the primary CS |

**Verdict: two hierarchies, no inversion, and one hole.** The shop side locks `shops` before `shop_users`. The order
side locks one `orders` or `order_drafts` row before its children. No handler takes the two sides in opposite orders.
⚠ `ShopUserRemove` writes `shop_users` without the shop row, which is the
[ShopUserSetPrimary](ShopUserSetPrimary.md) finding.

---

## The hierarchy

```mermaid
flowchart LR
  S["shops — one row, FOR UPDATE (lockShop)"] --> SU["shop_users — that shop's grants"]
  O["orders — one row, FOR UPDATE"] --> OC["order_items · order_events"]
  D["order_drafts — one row, FOR UPDATE"] --> DC["order_draft_items"]
  RC["team_return_configurations — one row, by its unique team_id (upsert)"]
  O -. "INSERT — the FK check takes KEY SHARE on the shop row" .-> S
  R["ShopUserRemove"] -. "enters here, never takes the shop row" .-> SU
```

Parent before child. A handler may enter part-way down, but never in a different relative order.

## Per handler, in acquisition order

| Handler | Locks, in order | Notes |
| --- | --- | --- |
| `ShopUserAdd` | `shops` (`FOR UPDATE`) → `shop_users` (its new row: INSERT, then the flag UPDATE) | the INSERT's FK takes KEY SHARE on the shop row it already holds |
| `ShopUserSetPrimary` | `shops` (`FOR UPDATE`) → `shop_users`: the old primary, then the new one | ⚠ its grant check before them takes no lock ([finding](ShopUserSetPrimary.md)) |
| `ShopUserRemove` | `shop_users` (1 row, DELETE) | ⚠ **no** shop row, so it enters part-way. Its own write is safe, but it is what makes Make primary's check go stale |
| `ShopUpdate` · `ShopDelete` | `shops` (1 row: UPDATE, i.e. a NO KEY UPDATE lock) | conflicts with `lockShop`, so both serialise with the grant writers |
| `ShopCreate` | none: an INSERT | `shops_team_code_active_unique` refuses a duplicate code |
| `OrderCreate` · `OrderDraftPromote` (`placeOrder`) | `orders` INSERT → KEY SHARE on `shops` (the FK) → `order_items` · `order_events` → promote only: `order_drafts` DELETE → **`stock.Pick` inside the transaction** | pattern 6 by design (#149): every lock here is held across the inventory call |
| `OrderCancel` | `orders` (`FOR UPDATE`) → UPDATE → `order_events` → **`stock.Return` inside the transaction** | pattern 6 by design (#70) |
| `OrderStatusChange` | one transaction for the batch: `orders` (up to 200 rows, `FOR UPDATE` **`ORDER BY id`**) → one UPDATE → one `order_events` INSERT | id order, never scan order, so two batches over the same orders queue rather than deadlock ([a-batch-move-saves-in-one-transaction](../../../../docs/technical/frontend/warehouse_order_list_decision.md#a-batch-move-saves-in-one-transaction)). Replaced `OrderConfirm` · `OrderPick` · `OrderPack` · `OrderShip` (2026-10-21) |
| `TeamReturnConfigurationSet` | `team_return_configurations` (1 row: `INSERT … ON CONFLICT (team_id) DO UPDATE`) | one statement. The first set is a phantom insert, and `team_return_configurations_team_idx` is what serialises it |
| `OrderDraftPush` | `order_drafts` (1 row by team, source and external id, `FOR UPDATE`) → `order_draft_items` | a new draft is backed by `order_drafts_external_ref_idx`, and the handler maps its duplicate |
| `OrderDraftUpdate` | `order_drafts` (1 row, `FOR UPDATE`) → `order_draft_items` | |
| `OrderDraftDelete` | `order_drafts` (n rows in one `DELETE … WHERE id IN`) → items by cascade | one statement, index order |

`shop_users_one_primary_idx` (one primary per shop) is a backstop that never fired in any race below. If it ever did,
`dbError` would report it with its generic unique-violation message: *"a shop with this code already exists"*.

---

## the-lock-no-grep-finds

`INSERT INTO orders` checks `orders.shop_id → shops(id)` with a `FOR KEY SHARE` on the shop's row. KEY SHARE
conflicts with exactly one mode: `FOR UPDATE`, which is the one `lockShop` takes.

| Proved | |
| --- | --- |
| a grant change holds back an order on the shop | `TestInterleave_LockShop_HoldsBackAnOrderOnTheShop`: the order INSERT blocked, released on the grant's commit |
| an order in flight holds back a grant change | `TestInterleave_LockShop_WaitsForAnOrderInFlight`: `lockShop` blocked until the order's transaction ended |
| `FOR NO KEY UPDATE` keeps grant changes serial and lets the order through | `TestInterleave_LockShop_NoKeyUpdateLetsTheOrderThrough`: the order did not wait, and a second NO KEY UPDATE still did |

It cannot deadlock: `lockShop` is the **first** lock both grant writers take, so they hold nothing while they wait.
The cost is waiting. `placeOrder` holds its KEY SHARE across `stock.Pick`, so a grant or Make primary on a busy shop
waits for every order being placed on it (each an inventory round trip), and new orders on that shop stall while the
grant holds the row.

**→ Recommend:** use `clause.Locking{Strength: "NO KEY UPDATE"}` in `lockShop`. It still conflicts with itself and
with `ShopUpdate`/`ShopDelete`'s UPDATE, so every guarantee `lockShop` gives today holds, and it stops conflicting with
the FK. Proved on raw SQL above; not applied (HARD RULE 8).

---

## Proved

| Test | Shows |
| --- | --- |
| `TestRace_ShopUserAdd_ManyUsersOnAShopWithNoPrimary` | 8 grants at once × 10 rounds: 8 grants, **exactly one** primary, 0 errors, and a different winner from round to round |
| `TestRace_ShopUserAdd_SameUserAtOnce` | one user 8× at once: 1 grant, it is primary, 0 errors |
| `TestInterleave_ShopUserAdd_SecondGrantWaitsForTheFirst` | **the proof `lockShop` holds.** B blocked on `SELECT "id" FROM "shops" … FOR UPDATE` (named via `pg_blocking_pids`), re-read after A committed, and left 102 unflagged |
| `TestInterleave_ShopUserAdd_WhileThePrimaryIsRemoved` | Remove takes no shop lock, so the grant does not wait. The end state (no primary) is serializable as *grant, then remove*, so it is not a finding |
| `TestRace_ShopUserSetPrimary_ManyUsersAtOnce` | 8 Make primary × 10 rounds: exactly one primary, 0 errors, no unique violation |
| `TestInterleave_ShopUserSetPrimary_SecondWaitsAndReReads` | B blocked, then cleared A's 102 rather than the 101 it had seen before the lock, with no 23505 |
| `TestInterleave_ShopUserSetPrimary_HoldsBackAGrant` | the two handlers share the one lock |
| `TestRace_ShopUserSetPrimary_AgainstGrantsAndRemovals` | 12 mixed callers × 10 rounds: at most one primary, only `FailedPrecondition` refusals, no deadlock |
| `TestRace_OrderStatusChange_SameMoveAtOnce` | 8 crew pick one order at once × 10 rounds: **exactly one** moves it, 7 told *already picked*, one `picked` history row |
| `TestInterleave_OrderStatusChange_SecondWaitsAndReReads` | **the proof the order's row lock holds.** B blocked on A's `FOR UPDATE`, re-read *picked* after A committed, and was refused rather than writing the move twice |
| `TestRace_OrderStatusChange_ConfirmAgainstCancel` | the warehouse's confirm and the selling team's `OrderCancel` on one pending order × 20 rounds: one wins, the other is refused by the state it left. Both won rounds (e.g. 9/11, 16/4), so the window was hit |
| `TestRace_OrderStatusChange_OppositeBatchOrders` | two batches over the same two orders in opposite orders × 20: 0 deadlocks, each order moved once. Re-run on the set-based save, where each batch holds both rows: the id-ordered lock is what keeps it at 0 |
| `TestRace_TeamReturnConfigurationSet_FirstSetAtOnce` | 8 first sets at once, 8 warehouses × 10 rounds: 0 errors, no unique violation, one row |
| `TestInterleave_TeamReturnConfigurationSet_FirstSetWaits` | **the phantom-insert proof.** B's insert waited on A's uncommitted key, then took the conflict path: one row, the later 58 |
| `TestInterleave_TeamReturnConfigurationSet_ReplaceWaits` | a replace waits on the row and lands after: one row, the later 58 |
| ✅ `TestInterleave_ShopUserSetPrimary_GrantRemovedMeanwhile` | the [finding](ShopUserSetPrimary.md)'s regression test. It failed by design, and passes since option 2 was applied (2026-09-29) |

Every passing test ran `-count=20` clean.

```sh
go test -tags raceaudit -run 'TestRace_ShopUser|TestInterleave_ShopUser|TestInterleave_LockShop' -v ./backend/services/selling_service/selling_v1/
go test -tags raceaudit -count=20 -run 'TestRace_OrderStatusChange|TestInterleave_OrderStatusChange|TestRace_TeamReturnConfigurationSet|TestInterleave_TeamReturnConfigurationSet' -v ./backend/services/selling_service/selling_v1/
```

---

## Seen while sweeping, not audited

- **`OrderDraftPromote`** reads the draft *outside* its transaction, and the draft DELETE inside `placeOrder` does not
  check `RowsAffected`. Two promotes of one draft look able to both place an order, and both pick stock. Suspected,
  not raced: it is outside this pass.

## Not proved

- `OrderCreate`, `OrderDraftPromote` and `OrderCancel` racing themselves were read, not raced. `OrderCancel` was raced only against `OrderStatusChange`
- ✅ the set-based `OrderStatusChange` ([its performance audit](../performances/OrderStatusChange.md)) was taken and every order test re-run on it: 80/80 at `-count=20`
- an inversion against another service: `placeOrder` and `OrderCancel` call inventory inside their transaction
- the move to `shop_service`
  ([the-shop-gets-its-own-service](../../../../docs/business/shop/context_decision.md#the-shop-gets-its-own-service)):
  this hierarchy moves with it
