# restock-selling-detail — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #126. Page `frontend/src/pages/restock-selling-detail`, route `/inventories/restock/{accepted_restock}`, opened as **seller**.

**Verdict:** 7 screen requests on a warm load (+3 shell); 2-deep waiting chains (RestockRequestDetail → FinancialAccountByIds · RestockRequestDetail → ProductByIds · RestockRequestDetail → SupplierByIds · RestockRequestDetail → TeamDetail · RestockRequestDetail → UserByIDs); no duplicate; usable in 674 ms.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 214 uncommitted file(s) · production build `4dbf4bc09b6aaf23` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 55 liability entries · 2 shops · 25 orders · 25 drafts · 25 expenses · 3 found · 1 count · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 10 — shell 3 · screen 7 |
| requests, cold load | 10 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 10 cold |
| waiting chain (measured) | depth 2 (2 over 2 dependency passes) — RestockRequestDetail → FinancialAccountByIds · RestockRequestDetail → ProductByIds · RestockRequestDetail → SupplierByIds · RestockRequestDetail → TeamDetail · RestockRequestDetail → UserByIDs |
| time until usable | 674 ms median (674–674, 1 warm) — noisy · cold 1218 ms |
| counts agree across warm loads | yes |
| requests after one save | — no save measured |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `LiabilityService/LiabilityPositionList` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `FinancialAccountService/FinancialAccountByIds` | 1 | 2 |  |
| `ProductService/ProductByIds` | 1 | 2 |  |
| `RestockRequestService/RestockRequestDetail` | 1 | 1 |  |
| `RestockRequestService/RestockTagList` | 1 | 1 |  |
| `SupplierService/SupplierByIds` | 1 | 2 |  |
| `TeamService/TeamDetail` | 1 | 2 |  |
| `UserService/UserByIDs` | 1 | 2 |  |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.


## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 7 | 0 | 2 | 674 (noisy) | — | — | first baseline (P4) |
