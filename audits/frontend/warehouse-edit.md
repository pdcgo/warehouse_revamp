# warehouse-edit — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #122. Page `frontend/src/pages/warehouse-edit`, route `/teams/{warehouse_team}/edit`, opened as **root**.

**Verdict:** 3 screen requests on a warm load (+2 shell); 2-deep waiting chains (WarehouseInfoDetail → WarehouseInfoDetail); 1 duplicate(s) (WarehouseInfoDetail); usable in 434 ms; its save fired 3 request(s) after (recorded).

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 144 uncommitted file(s) · production build `dd324215e7891358` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 30 liability entries · 2 shops · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 5 — shell 2 · screen 3 |
| requests, cold load | 5 |
| same RPC asked twice | 1 — WarehouseInfoDetail |
| CORS pre-checks (OPTIONS) | 0 warm · 4 cold |
| waiting chain (measured) | depth 2 — WarehouseInfoDetail → WarehouseInfoDetail |
| time until usable | 434 ms median (434–434, 1 warm) — noisy · cold 1061 ms |
| counts agree across warm loads | yes |
| requests after one save | 3 — recorded (save unchanged (TeamUpdate → WarehouseInfoUpdate) — opens the team) — TeamDetail · WarehouseInfoDetail · UserList |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `TeamService/TeamDetail` | 1 | 1 |  |
| `WarehouseInfoService/WarehouseInfoDetail` | 2 | 1 · 2 | ✗ yes |

After the save (`WarehouseInfoUpdate`), in the order they fired: TeamDetail · WarehouseInfoDetail · UserList. The save navigated to `/teams/2` — that screen's load is counted here.

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **1 duplicate request(s)** — WarehouseInfoDetail asked twice with the same body in one load. *Fix:* one query key for the read so TanStack dedupes it. *Trade-off:* none beyond the key.
2. **What the code does** — TeamDetail + WarehouseInfoDetail are one useEffect read (pages/warehouse-edit/index.tsx) — #122.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 3 | 1 | 2 | 434 (noisy) | 3 | — (P2) | first baseline (P1) |
