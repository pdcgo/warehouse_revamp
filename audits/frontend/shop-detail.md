# shop-detail — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #122. Page `frontend/src/pages/shop-detail`, route `/shops/{shop}`, opened as **seller**.

**Verdict:** 5 screen requests on a warm load (+3 shell); 3-deep waiting chains (ShopDetail → ShopUserList → UserByIDs); no duplicate; usable in 522 ms; its save fired 1 request(s) after (recorded).

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 144 uncommitted file(s) · production build `dd324215e7891358` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 30 liability entries · 2 shops · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 8 — shell 3 · screen 5 |
| requests, cold load | 8 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 8 cold |
| waiting chain (measured) | depth 3 — ShopDetail → ShopUserList → UserByIDs |
| time until usable | 522 ms median (522–522, 1 warm) — noisy · cold 1057 ms |
| counts agree across warm loads | yes |
| requests after one save | 1 — recorded (ShopUserSetPrimary) — ShopDetail |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `LiabilityService/LiabilityPositionList` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `FinancialAccountService/FinancialAccountList` | 1 | 2 |  |
| `ShopService/ShopDetail` | 1 | 1 |  |
| `ShopService/ShopUserList` | 1 | 2 |  |
| `UserService/UserByIDs` | 1 | 3 |  |
| `UserService/UserList` | 1 | 2 |  |

After the save (`ShopUserSetPrimary`), in the order they fired: ShopDetail.

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **A 3-deep waiting chain** — ShopDetail → ShopUserList → UserByIDs: each call starts only when the one before answers, so the screen pays 3 round trips before it can draw. *Fix:* the later reads as query hooks keyed on the earlier answers (#120–#122 — they still wait, but can be prefetched or merged into one RPC that answers the names with the rows). *Trade-off:* a merged RPC couples two services' reads.
2. **What the code does** — ShopUsersSection's ShopUserList + UserByIDs are a useEffect read (components/ShopUsersSection.tsx) — #122.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 5 | 0 | 3 | 522 (noisy) | 1 | — (P2) | first baseline (P1) |
