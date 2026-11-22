# restock-new — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #121. Page `frontend/src/pages/restock-form`, route `/inventories/restock/new`, opened as **seller**.

**Verdict:** 3 screen requests on a warm load (+3 shell); no waiting chain; no duplicate; usable in 649 ms.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 144 uncommitted file(s) · production build `dd324215e7891358` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 30 liability entries · 2 shops · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 6 — shell 3 · screen 3 |
| requests, cold load | 6 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 6 cold |
| waiting chain (measured) | depth 1 — FinancialAccountList · ShipmentChannelList · TeamList |
| time until usable | 649 ms median (649–649, 1 warm) — noisy · cold 1230 ms |
| counts agree across warm loads | yes |
| requests after one save | — no save measured |
| open ProductPicker | 3 request(s) — OwnerStockByIds ×1 · ProductList ×1 · TeamByIds ×1 |
| open the supplier picker | 2 request(s) — SupplierList ×1 · TeamByIds ×1 |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `LiabilityService/LiabilityPositionList` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `FinancialAccountService/FinancialAccountList` | 1 | 1 |  |
| `ShipmentChannelService/ShipmentChannelList` | 1 | 1 |  |
| `TeamService/TeamList` | 1 | 1 |  |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **What the code does** — No write measured: the form's first save is a create (it would change the screen it measures). SupplierSelect and ProductPicker fetch in their own useEffects — #121.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 3 | 0 | 1 | 649 (noisy) | — | — (P2) | first baseline (P1) |
