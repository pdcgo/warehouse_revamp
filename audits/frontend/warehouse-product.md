# warehouse-product — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #126. Page `frontend/src/pages/warehouse-product`, route `/inventories/products/{product}`, opened as **wh_owner**.

**Verdict:** 17 screen requests on a warm load (+4 shell); 6-deep waiting chains (ProductByIds → StockHistory → TeamByIds → RackList → UserByIDs → ProductPlaces); 1 duplicate(s) (ProductPlaces); usable in 479 ms.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 214 uncommitted file(s) · production build `4dbf4bc09b6aaf23` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 55 liability entries · 2 shops · 25 orders · 25 drafts · 25 expenses · 3 found · 1 count · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 21 — shell 4 · screen 17 |
| requests, cold load | 21 |
| same RPC asked twice | 1 — ProductPlaces |
| CORS pre-checks (OPTIONS) | 0 warm · 20 cold |
| waiting chain (measured) | depth 6 (6 over 2 dependency passes) — ProductByIds → StockHistory → TeamByIds → RackList → UserByIDs → ProductPlaces |
| time until usable | 479 ms median (479–479, 1 warm) — noisy · cold 986 ms |
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
| `InventoryService/BatchList` | 1 | 1 |  |
| `InventoryService/CostLayerList` | 1 | 1 |  |
| `InventoryService/PlacementList` | 1 | 1 |  |
| `InventoryService/ProductPlaces` | 2 | 2 · 6 | ✗ yes |
| `InventoryService/ProductStockSummary` | 1 | 1 |  |
| `InventoryService/StockCost` | 1 | 2 |  |
| `InventoryService/StockHistory` | 3 | 2 |  |
| `OrderService/OrderList` | 1 | 1 |  |
| `ProductService/ProductByIds` | 1 | 1 |  |
| `RackService/RackList` | 1 | 4 |  |
| `RestockRequestService/RestockRequestList` | 2 | 1 |  |
| `TeamService/TeamByIds` | 1 | 3 |  |
| `UserService/UserByIDs` | 1 | 5 |  |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **A 6-deep waiting chain** — ProductByIds → StockHistory → TeamByIds → RackList → UserByIDs → ProductPlaces: each call starts only when the one before answers, so the screen pays 6 round trips before it can draw. *Fix:* the later reads as query hooks keyed on the earlier answers (#120–#122 — they still wait, but can be prefetched or merged into one RPC that answers the names with the rows). *Trade-off:* a merged RPC couples two services' reads.
2. **1 duplicate request(s)** — ProductPlaces asked twice with the same body in one load. *Fix:* one query key for the read so TanStack dedupes it. *Trade-off:* none beyond the key.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 17 | 1 | 6 | 479 (noisy) | — | — | first baseline (P4) |
