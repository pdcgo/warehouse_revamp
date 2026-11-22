# user-detail — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #126. Page `frontend/src/pages/user-detail`, route `/users/{cs1_id}`, opened as **seller**.

**Verdict:** 2 screen requests on a warm load (+3 shell); 2-deep waiting chains (UserTeams → UserTeams); 1 duplicate(s) (UserTeams); usable in 1278 ms.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 214 uncommitted file(s) · production build `4dbf4bc09b6aaf23` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 55 liability entries · 2 shops · 25 orders · 25 drafts · 25 expenses · 3 found · 1 count · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 5 — shell 3 · screen 2 |
| requests, cold load | 5 |
| same RPC asked twice | 1 — UserTeams |
| CORS pre-checks (OPTIONS) | 0 warm · 4 cold |
| waiting chain (measured) | depth 2 (2 over 2 dependency passes) — UserTeams → UserTeams |
| time until usable | 1278 ms median (1278–1278, 1 warm) — noisy · cold 1804 ms |
| counts agree across warm loads | yes |
| requests after one save | — no save measured |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `LiabilityService/LiabilityPositionList` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `UserService/UserTeams` | 2 | 1 · 2 | ✗ yes |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **1 duplicate request(s)** — UserTeams asked twice with the same body in one load. *Fix:* one query key for the read so TanStack dedupes it. *Trade-off:* none beyond the key.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 2 | 1 | 2 | 1278 (noisy) | — | — | first baseline (P4) |
