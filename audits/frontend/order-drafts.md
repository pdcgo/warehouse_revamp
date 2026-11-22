# order-drafts — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #126. Page `frontend/src/pages/order-drafts`, route `/order-drafts`, opened as **seller**.

**Verdict:** 3 screen requests on a warm load (+3 shell); no waiting chain; no duplicate; usable in 474 ms.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 214 uncommitted file(s) · production build `4dbf4bc09b6aaf23` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 55 liability entries · 2 shops · 25 orders · 25 drafts · 25 expenses · 3 found · 1 count · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 6 — shell 3 · screen 3 |
| requests, cold load | 6 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 5 cold |
| waiting chain (measured) | depth 1 (1 over 2 dependency passes) — OrderDraftList · ShopList |
| time until usable | 474 ms median (474–474, 1 warm) — noisy · cold 1016 ms |
| counts agree across warm loads | yes |
| requests after one save | — no save measured |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `LiabilityService/LiabilityPositionList` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `OrderDraftService/OrderDraftList` | 2 | 1 |  |
| `ShopService/ShopList` | 1 | 1 |  |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **What the code does** — 25 seeded drafts; usable waits on the table (`order-drafts-table`) — the page has no root test id.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 3 | 0 | 1 | 474 (noisy) | — | — | first baseline (P4) |
