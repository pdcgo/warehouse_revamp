# order-detail — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #126. Page `frontend/src/pages/order-detail`, route `/orders/{order}`, opened as **seller**.

**Verdict:** 8 screen requests on a warm load (+3 shell); 2-deep waiting chains (OrderDetail → ProductByIds · OrderDetail → OrderSettlementDetail · OrderDetail → ShipmentChannelList · OrderDetail → ShopList · OrderDetail → UserByIDs); no duplicate; usable in 764 ms; its save fired 3 request(s) after (recorded).

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 214 uncommitted file(s) · production build `4dbf4bc09b6aaf23` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 55 liability entries · 2 shops · 25 orders · 25 drafts · 25 expenses · 3 found · 1 count · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 11 — shell 3 · screen 8 |
| requests, cold load | 11 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 11 cold |
| waiting chain (measured) | depth 2 (2 over 2 dependency passes) — OrderDetail → ProductByIds · OrderDetail → OrderSettlementDetail · OrderDetail → ShipmentChannelList · OrderDetail → ShopList · OrderDetail → UserByIDs |
| time until usable | 764 ms median (764–764, 1 warm) — noisy · cold 1331 ms |
| counts agree across warm loads | yes |
| requests after one save | 3 — recorded (OrderNoteCreate (a note on the order)) — OrderDetail · OrderTagList · UserByIDs |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `LiabilityService/LiabilityPositionList` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `OrderService/OrderDetail` | 1 | 1 |  |
| `OrderService/OrderTagList` | 1 | 1 |  |
| `ProductService/ProductByIds` | 1 | 2 |  |
| `SettlementService/OrderSettlementDetail` | 1 | 2 |  |
| `ShipmentChannelService/ShipmentChannelList` | 1 | 2 |  |
| `ShopService/ShopList` | 1 | 2 |  |
| `TeamService/TeamList` | 1 | 1 |  |
| `UserService/UserByIDs` | 1 | 2 |  |

After the save (`OrderNoteCreate`), in the order they fired: OrderDetail · OrderTagList · UserByIDs.

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.


## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 8 | 0 | 2 | 764 (noisy) | 3 | — | first baseline (P4) |
