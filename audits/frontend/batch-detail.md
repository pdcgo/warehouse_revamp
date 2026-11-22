# batch-detail — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #126. Page `frontend/src/pages/batch-detail`, route `/inventories/batches/{batch}`, opened as **wh_owner**.

**Verdict:** 10 screen requests on a warm load (+4 shell); 7-deep waiting chains (BatchDetail → ProductPlaces → ProductByIds → TeamByIds → SupplierByIds → UserByIDs → ProductPlaces · BatchDetail → ProductPlaces → ProductByIds → TeamByIds → SupplierByIds → UserByIDs → StockHistory); 1 duplicate(s) (ProductPlaces); usable in 585 ms.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 214 uncommitted file(s) · production build `4dbf4bc09b6aaf23` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 55 liability entries · 2 shops · 25 orders · 25 drafts · 25 expenses · 3 found · 1 count · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 14 — shell 4 · screen 10 |
| requests, cold load | 14 |
| same RPC asked twice | 1 — ProductPlaces |
| CORS pre-checks (OPTIONS) | 0 warm · 13 cold |
| waiting chain (measured) | depth 7 (7 over 2 dependency passes) — BatchDetail → ProductPlaces → ProductByIds → TeamByIds → SupplierByIds → UserByIDs → ProductPlaces · BatchDetail → ProductPlaces → ProductByIds → TeamByIds → SupplierByIds → UserByIDs → StockHistory |
| time until usable | 585 ms median (585–585, 1 warm) — noisy · cold 1151 ms |
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
| `InventoryService/BatchDetail` | 1 | 1 |  |
| `InventoryService/BatchPlacementList` | 1 | 1 |  |
| `InventoryService/ProductPlaces` | 2 | 2 · 7 | ✗ yes |
| `InventoryService/StockHistory` | 1 | 7 |  |
| `ProductService/ProductByIds` | 1 | 3 |  |
| `RackService/RackList` | 1 | 1 |  |
| `SupplierService/SupplierByIds` | 1 | 5 |  |
| `TeamService/TeamByIds` | 1 | 4 |  |
| `UserService/UserByIDs` | 1 | 6 |  |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **A 7-deep waiting chain** — BatchDetail → ProductPlaces → ProductByIds → TeamByIds → SupplierByIds → UserByIDs → ProductPlaces · BatchDetail → ProductPlaces → ProductByIds → TeamByIds → SupplierByIds → UserByIDs → StockHistory: each call starts only when the one before answers, so the screen pays 7 round trips before it can draw. *Fix:* the later reads as query hooks keyed on the earlier answers (#120–#122 — they still wait, but can be prefetched or merged into one RPC that answers the names with the rows). *Trade-off:* a merged RPC couples two services' reads.
2. **1 duplicate request(s)** — ProductPlaces asked twice with the same body in one load. *Fix:* one query key for the read so TanStack dedupes it. *Trade-off:* none beyond the key.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 10 | 1 | 7 | 585 (noisy) | — | — | first baseline (P4) |
