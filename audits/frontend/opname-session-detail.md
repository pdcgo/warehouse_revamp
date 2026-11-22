# opname-session-detail — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #126. Page `frontend/src/pages/opname-session-detail`, route `/inventories/opname/sessions/{opname_session}`, opened as **wh_owner**.

**Verdict:** 5 screen requests on a warm load (+4 shell); 3-deep waiting chains (OpnameSessionDetail → UserByIDs → RackList); no duplicate; usable in 547 ms.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 214 uncommitted file(s) · production build `4dbf4bc09b6aaf23` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 55 liability entries · 2 shops · 25 orders · 25 drafts · 25 expenses · 3 found · 1 count · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 9 — shell 4 · screen 5 |
| requests, cold load | 9 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 9 cold |
| waiting chain (measured) | depth 3 (3 over 2 dependency passes) — OpnameSessionDetail → UserByIDs → RackList |
| time until usable | 547 ms median (547–547, 1 warm) — noisy · cold 1075 ms |
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
| `OpnameService/OpnameRowList` | 1 | 1 |  |
| `OpnameService/OpnameSessionDetail` | 1 | 1 |  |
| `RackService/RackList` | 1 | 3 |  |
| `TeamService/TeamByIds` | 1 | 2 |  |
| `UserService/UserByIDs` | 1 | 2 |  |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **A 3-deep waiting chain** — OpnameSessionDetail → UserByIDs → RackList: each call starts only when the one before answers, so the screen pays 3 round trips before it can draw. *Fix:* the later reads as query hooks keyed on the earlier answers (#120–#122 — they still wait, but can be prefetched or merged into one RPC that answers the names with the rows). *Trade-off:* a merged RPC couples two services' reads.
2. **What the code does** — The seeded count of rack J (open, nothing counted yet).

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 5 | 0 | 3 | 547 (noisy) | — | — | first baseline (P4) |
