# warehouse_service — lock order

The service-wide matrix that the `audit-sql` skill writes unconditionally. It is not a finding: it is the reference the next
write handler is checked against.

| | |
| --- | --- |
| Isolation | READ COMMITTED (Postgres default; nothing in this repo raises it) |
| Last swept | 2026-10-21, the service's first write (`WarehouseFeeSet`) |

**Verdict: one table, one statement, no hierarchy yet.** `WarehouseFeeSet` is a single `INSERT … ON CONFLICT (warehouse_id)
DO UPDATE` on `warehouse_fees_warehouse_idx`; nothing else in the service writes.

## Per handler

| Handler | Locks | Notes |
| --- | --- | --- |
| `WarehouseFeeSet` | `warehouse_fees` (1 row, by its unique `warehouse_id`) | the first rate is a phantom insert, and the unique index is what serialises it |
| `WarehouseFeeDetail` · `WarehouseFeeCalculate` | none — reads | |

## Proved

| Test | Shows |
| --- | --- |
| `TestRace_WarehouseFeeSet_FirstRateAtOnce` | 8 first rates at once × 10 rounds: 0 errors, no unique violation, one row holding one of the eight |
| `TestInterleave_WarehouseFeeSet_FirstRateWaits` | **the phantom-insert proof.** B's insert waited on A's uncommitted key, then took the conflict path: one row, the later rate |

Both ran `-count=20` clean (40/40).

```sh
go test -tags raceaudit -count=20 -run 'TestRace_WarehouseFeeSet|TestInterleave_WarehouseFeeSet' -v ./backend/services/warehouse_service/warehouse_v1/
```

## Not proved

- the fee changing while an order is being priced: by design the order freezes what `WarehouseFeeCalculate` answered at
  that moment (warehouse-prices-balance-records), so a rate saved a second later applies to the next order — nothing to lock
