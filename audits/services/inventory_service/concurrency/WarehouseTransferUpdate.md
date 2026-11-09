# WarehouseTransferUpdate (and Create) — concurrency audit: the paying account

✅ **Safe.** 2026-11-05 · a-transfer-names-its-paying-account now asks `PayingAccounts.Account` — the composition root's
in-process `FinancialAccountByIds`, a network RPC once the services split — for the account that pays the shipping. It
follows the rule [lock-order.md](lock-order.md) sets (a call to another service happens before the first lock, or after
commit), exactly as the restock's ([RestockRequestUpdate.md](RestockRequestUpdate.md#the-paying-account-2026-11-05)):

- **Create** asks after the product check and before the receiver's product link and the transaction — no lock and no
  pinned connection during the call, and a refused create writes nothing.
- **Update** asks before the transaction and judges the answer under the transfer's `FOR UPDATE` only when the account
  changed (which is known only under the lock).

Proved by `backend/services/inventory_service/inventory_v1/warehouse_transfer_account_race_test.go` (`-tags raceaudit`):

| Claim | Proof |
| --- | --- |
| Update does not hold the transfer across the account call | `TestRace_WarehouseTransferUpdate_ACancelDoesNotWaitForTheAccountRoundTrip`: Cancel **65 ms** on an 800 ms call; the edit, resuming, reads the committed cancel and refuses FailedPrecondition (the serial outcome of "cancel, then edit") |
| Create holds no transaction during the account call | `TestRace_WarehouseTransferCreate_HoldsNoTransactionDuringTheAccountCall`: 0 backends idle in transaction, 0 locks |

An account archived or un-marked between the answer and the commit leaves the same state as "transfer first, then
archive" — kept, as for the restock. An edit that keeps the account the transfer holds is never refused, so archiving
an account never freezes the cost of the transfers that already named it.

```sh
go test -tags raceaudit -p 1 -run 'TestRace_WarehouseTransfer.*Account' -v ./backend/services/inventory_service/inventory_v1/
```

| Date | Run | Result |
| --- | --- | --- |
| 2026-11-05 | both tests above | pass — first audit |
