# shipment_service — lock order

The service-wide matrix the `audit-sql` skill writes unconditionally. Not a finding — the reference the
next write handler is checked against.

**Verdict: one table, one row per statement, no inversion possible.** No handler opens a transaction or
takes an explicit lock; every write is a single statement that locks at most one row.

| Handler | Lock order | Notes |
| --- | --- | --- |
| `ShipmentChannelCreate` | *(none)* — unique-index entry on `code` | pre-check `SELECT` only picks the message; the `shipment_channels_code_unique` index refuses a racing duplicate, mapped to `already_exists` |
| `ShipmentChannelUpdate` | `shipment_channels` (1 row, by id) | `UPDATE … RETURNING` — no read-then-write |
| `ShipmentChannelDelete` | `shipment_channels` (1 row, by id) | same statement shape |
| `ShipmentChannelRestore` | `shipment_channels` (1 row, by id) | same statement shape |

Evidence: `backend/services/shipment_service/shipment_v1/shipment_channel_race_test.go` (`raceaudit`), 20 runs clean.

⚠ The next handler that takes **two** rows (e.g. a bulk update or a merge) must lock them `ORDER BY id`.
