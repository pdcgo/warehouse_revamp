# team-detail — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: (#122's missed reads). Page `frontend/src/pages/team-detail`, route `/teams/{warehouse_team}`, opened as **root**.

**Verdict:** 3 screen requests on a warm load (+2 shell); 2-deep waiting chains (TeamDetail → UserList · TeamDetail → WarehouseInfoDetail); no duplicate; usable in 463 ms.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 144 uncommitted file(s) · production build `dd324215e7891358` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 30 liability entries · 2 shops · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 5 — shell 2 · screen 3 |
| requests, cold load | 5 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 5 cold |
| waiting chain (measured) | depth 2 — TeamDetail → UserList · TeamDetail → WarehouseInfoDetail |
| time until usable | 463 ms median (463–463, 1 warm) — noisy · cold 914 ms |
| counts agree across warm loads | yes |
| requests after one save | — no save measured |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `TeamService/TeamDetail` | 1 | 1 |  |
| `UserService/UserList` | 1 | 2 |  |
| `WarehouseInfoService/WarehouseInfoDetail` | 1 | 2 |  |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **What the code does** — ShopsSection's ShopList and WarehouseInfoSection's WarehouseInfoDetail are useEffect reads the first grep missed (scoping §5) — #122.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 3 | 0 | 2 | 463 (noisy) | — | — (P2) | first baseline (P1) |
