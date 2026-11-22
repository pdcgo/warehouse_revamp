# warehouse-order — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #126. Page `frontend/src/pages/pick-order`, route `/warehouse-orders/{warehouse_order}`, opened as **wh_staff**.

**Verdict:** 4 screen requests on a warm load (+2 shell); 3-deep waiting chains (OrderDetail → StockPickLocations → ShipmentChannelList); no duplicate; usable in 345 ms; its save fired 3 request(s) after (recorded).

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 214 uncommitted file(s) · production build `4dbf4bc09b6aaf23` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 55 liability entries · 2 shops · 25 orders · 25 drafts · 25 expenses · 3 found · 1 count · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 6 — shell 2 · screen 4 |
| requests, cold load | 6 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 6 cold |
| waiting chain (measured) | depth 3 (3 over 2 dependency passes) — OrderDetail → StockPickLocations → ShipmentChannelList |
| time until usable | 345 ms median (345–345, 1 warm) — noisy · cold 867 ms |
| counts agree across warm loads | yes |
| requests after one save | 3 — recorded (OrderStatusChange (the order's next step)) — OrderDetail · OrderTagList · StockPickLocations |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `InventoryService/StockPickLocations` | 1 | 2 |  |
| `OrderService/OrderDetail` | 1 | 1 |  |
| `OrderService/OrderTagList` | 1 | 1 |  |
| `ShipmentChannelService/ShipmentChannelList` | 1 | 3 |  |

After the save (`OrderStatusChange`), in the order they fired: OrderDetail · OrderTagList · StockPickLocations.

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **A 3-deep waiting chain** — OrderDetail → StockPickLocations → ShipmentChannelList: each call starts only when the one before answers, so the screen pays 3 round trips before it can draw. *Fix:* the later reads as query hooks keyed on the earlier answers (#120–#122 — they still wait, but can be prefetched or merged into one RPC that answers the names with the rows). *Trade-off:* a merged RPC couples two services' reads.
2. **What the code does** — One seeded order's pick page; usable waits on its pick list (`pick-list-table`) — the page has no root test id.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 4 | 0 | 3 | 345 (noisy) | 3 | — | first baseline (P4) |
