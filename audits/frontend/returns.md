# returns — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #126. Page `frontend/src/pages/returns`, route `/inventories/returns`, opened as **wh_owner**.

**Verdict:** 4 screen requests on a warm load (+4 shell); no waiting chain; no duplicate; usable in 597 ms.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 214 uncommitted file(s) · production build `4dbf4bc09b6aaf23` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 55 liability entries · 2 shops · 25 orders · 25 drafts · 25 expenses · 3 found · 1 count · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 8 — shell 4 · screen 4 |
| requests, cold load | 8 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 8 cold |
| waiting chain (measured) | depth 1 (1 over 2 dependency passes) — OrderList · OrderStat · ShipmentChannelList · TeamList |
| time until usable | 597 ms median (597–597, 1 warm) — noisy · cold 1060 ms |
| counts agree across warm loads | yes |
| requests after one save | — no save measured |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `FoundRequestService/FoundRequestList` | 1 | shell |  |
| `LiabilityService/LiabilityPositionList` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `OrderService/OrderList` | 1 | 1 |  |
| `OrderService/OrderStat` | 1 | 1 |  |
| `ShipmentChannelService/ShipmentChannelList` | 1 | 1 |  |
| `TeamService/TeamList` | 1 | 1 |  |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **What the code does** — No return seeded: the empty list's reads.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 4 | 0 | 1 | 597 (noisy) | — | — | first baseline (P4) |
