# analytic — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #126. Page `frontend/src/pages/analytic`, route `/analytic?g=shop&m=metrics/orders/created&r=7d`, opened as **seller**.

**Verdict:** 10 screen requests on a warm load (+3 shell); 3-deep waiting chains (MetricSearch → MetricData → ShopByIds); no duplicate; usable in 814 ms.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 214 uncommitted file(s) · production build `4dbf4bc09b6aaf23` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 55 liability entries · 2 shops · 25 orders · 25 drafts · 25 expenses · 3 found · 1 count · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 13 — shell 3 · screen 10 |
| requests, cold load | 13 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 11 cold |
| waiting chain (measured) | depth 3 (3 over 2 dependency passes) — MetricSearch → MetricData → ShopByIds |
| time until usable | 814 ms median (814–814, 1 warm) — noisy · cold 1422 ms |
| counts agree across warm loads | yes |
| requests after one save | — no save measured |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `LiabilityService/LiabilityPositionList` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `OrderAnalyticService/MetricData` | 2 | 2 |  |
| `OrderAnalyticService/MetricSearch` | 1 | 1 |  |
| `OrderService/OrderCreatorList` | 1 | 1 |  |
| `ShopService/ShopByIds` | 1 | 3 |  |
| `ShopService/ShopList` | 2 | 1 |  |
| `TeamService/TeamList` | 2 | 1 |  |
| `UserService/UserByIDs` | 1 | 2 |  |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **A 3-deep waiting chain** — MetricSearch → MetricData → ShopByIds: each call starts only when the one before answers, so the screen pays 3 round trips before it can draw. *Fix:* the later reads as query hooks keyed on the earlier answers (#120–#122 — they still wait, but can be prefetched or merged into one RPC that answers the names with the rows). *Trade-off:* a merged RPC couples two services' reads.
2. **What the code does** — Opened on a report — orders created, by shop, the last 7 days (the composer keeps its report in the address: `g`, `m`, `r`): the bare /analytic asks nothing until a metric is picked.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 10 | 0 | 3 | 814 (noisy) | — | — | first baseline (P4) |
