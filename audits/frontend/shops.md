# shops — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #126. Page `frontend/src/pages/shops`, route `/shops`, opened as **seller**.

**Verdict:** 4 screen requests on a warm load (+3 shell); 2-deep waiting chains (ShopList → UserByIDs); 1 duplicate(s) (UserByIDs); usable in 638 ms.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 214 uncommitted file(s) · production build `4dbf4bc09b6aaf23` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 55 liability entries · 2 shops · 25 orders · 25 drafts · 25 expenses · 3 found · 1 count · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 7 — shell 3 · screen 4 |
| requests, cold load | 7 |
| same RPC asked twice | 1 — UserByIDs |
| CORS pre-checks (OPTIONS) | 0 warm · 6 cold |
| waiting chain (measured) | depth 2 (2 over 2 dependency passes) — ShopList → UserByIDs |
| time until usable | 638 ms median (638–638, 1 warm) — noisy · cold 1030 ms |
| counts agree across warm loads | yes |
| requests after one save | — no save measured |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `LiabilityService/LiabilityPositionList` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `ShopService/ShopList` | 2 | 1 |  |
| `UserService/UserByIDs` | 2 | 1 · 2 | ✗ yes |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **1 duplicate request(s)** — UserByIDs asked twice with the same body in one load. *Fix:* one query key for the read so TanStack dedupes it. *Trade-off:* none beyond the key.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 4 | 1 | 2 | 638 (noisy) | — | — | first baseline (P4) |
