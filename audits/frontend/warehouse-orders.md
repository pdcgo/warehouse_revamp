# warehouse-orders — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #126. Page `frontend/src/pages/pick-queue`, route `/warehouse-orders`, opened as **wh_staff**.

**Verdict:** 9 screen requests on a warm load (+2 shell); 2-deep waiting chains (OrderList → ShipmentChannelList · OrderList → ShopByIds · OrderList → UserByIDs); no duplicate; usable in 1053 ms.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 214 uncommitted file(s) · production build `4dbf4bc09b6aaf23` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 55 liability entries · 2 shops · 25 orders · 25 drafts · 25 expenses · 3 found · 1 count · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 11 — shell 2 · screen 9 |
| requests, cold load | 11 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 9 cold |
| waiting chain (measured) | depth 2 (2 over 2 dependency passes) — OrderList → ShipmentChannelList · OrderList → ShopByIds · OrderList → UserByIDs |
| time until usable | 1053 ms median (1053–1053, 1 warm) — noisy · cold 1513 ms |
| counts agree across warm loads | yes |
| requests after one save | — no save measured |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `OrderService/OrderList` | 1 | 1 |  |
| `OrderService/OrderStat` | 1 | 1 |  |
| `OrderService/OrderTagList` | 1 | 1 |  |
| `ShipmentChannelService/ShipmentChannelList` | 2 | 1 · 2 |  |
| `ShopService/ShopByIds` | 1 | 2 |  |
| `TeamService/TeamList` | 2 | 1 |  |
| `UserService/UserByIDs` | 1 | 2 |  |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **What the code does** — The crew's order queue (25 seeded orders shipping from this warehouse); usable waits on the table (`pick-queue-table`) — the page has no root test id.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 9 | 0 | 2 | 1053 (noisy) | — | — | first baseline (P4) |
