# rack-detail — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #120. Page `frontend/src/pages/rack-detail`, route `/inventories/racks/{rack_a}`, opened as **wh_owner**.

**Verdict:** 7 screen requests on a warm load (+4 shell); 3-deep waiting chains (RackDetail → RackHistory → ProductByIds · RackDetail → RackHistory → UserByIDs · RackStock → ProductByIds → TeamByIds); no duplicate; usable in 707 ms; its save fired 5 request(s) after (ok).

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 149 uncommitted file(s) · production build `eab163adbeb7bc8b` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 30 liability entries · 2 shops · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 11 — shell 4 · screen 7 |
| requests, cold load | 11 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 10 cold |
| waiting chain (measured) | depth 3 — RackDetail → RackHistory → ProductByIds · RackDetail → RackHistory → UserByIDs · RackStock → ProductByIds → TeamByIds |
| time until usable | 707 ms median (707–707, 1 warm) — noisy · cold 1379 ms |
| counts agree across warm loads | yes |
| requests after one save | 5 — ok (RackMove 1 unit A→B) — RackDetail · RackStock · RackHistory · UserByIDs · ProductByIds |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `FoundRequestService/FoundRequestList` | 1 | shell |  |
| `LiabilityService/LiabilityPositionList` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `ProductService/ProductByIds` | 2 | 2 · 3 |  |
| `RackService/RackDetail` | 1 | 1 |  |
| `RackService/RackHistory` | 1 | 2 |  |
| `RackService/RackStock` | 1 | 1 |  |
| `TeamService/TeamByIds` | 1 | 3 |  |
| `UserService/UserByIDs` | 1 | 3 |  |

After the save (`RackMove`), in the order they fired: RackDetail · RackStock · RackHistory · UserByIDs · ProductByIds.

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **A 3-deep waiting chain** — RackDetail → RackHistory → ProductByIds · RackDetail → RackHistory → UserByIDs · RackStock → ProductByIds → TeamByIds: each call starts only when the one before answers, so the screen pays 3 round trips before it can draw. *Fix:* the later reads as query hooks keyed on the earlier answers (#120–#122 — they still wait, but can be prefetched or merged into one RPC that answers the names with the rows). *Trade-off:* a merged RPC couples two services' reads.
2. **What the code does** — RackDetail, RackHistory and the shelf's RackStock → ProductByIds → TeamByIds read through query hooks (features/racks/queries.ts, #120); a write refreshes them by invalidating `racks`, each read once.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 7 | 0 | 3 | 949 (noisy) | 9 | — (P2) | first baseline (P1) |
| 2026-11-21 | 7 | 0 | 3 | 707 (noisy) | 5 | — (P2) | no change past a threshold |
