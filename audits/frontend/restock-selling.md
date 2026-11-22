# restock-selling — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #126. Page `frontend/src/pages/restock-selling`, route `/inventories/restock`, opened as **seller**.

**Verdict:** 11 screen requests on a warm load (+3 shell); 2-deep waiting chains (RestockActorList → UserByIDs · UserByIDs → ShipmentChannelByIds · UserByIDs → SupplierByIds); 2 duplicate(s) (UserByIDs); usable in 1167 ms.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 214 uncommitted file(s) · production build `4dbf4bc09b6aaf23` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 55 liability entries · 2 shops · 25 orders · 25 drafts · 25 expenses · 3 found · 1 count · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 14 — shell 3 · screen 11 |
| requests, cold load | 14 |
| same RPC asked twice | 2 — UserByIDs |
| CORS pre-checks (OPTIONS) | 0 warm · 13 cold |
| waiting chain (measured) | depth 2 (2·3 over 2 dependency passes) — RestockActorList → UserByIDs · UserByIDs → ShipmentChannelByIds · UserByIDs → SupplierByIds |
| time until usable | 1167 ms median (1167–1167, 1 warm) — noisy · cold 1576 ms |
| counts agree across warm loads | yes |
| requests after one save | — no save measured |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `LiabilityService/LiabilityPositionList` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `RestockRequestService/RestockActorList` | 2 | 1 |  |
| `RestockRequestService/RestockRequestList` | 1 | 1 |  |
| `RestockRequestService/RestockTagList` | 1 | 1 |  |
| `ShipmentChannelService/ShipmentChannelByIds` | 1 | 2 |  |
| `ShipmentChannelService/ShipmentChannelList` | 1 | 1 |  |
| `SupplierService/SupplierByIds` | 1 | 2 |  |
| `TeamService/TeamList` | 1 | 1 |  |
| `UserService/UserByIDs` | 3 | 1 · 2 | ✗ yes |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **2 duplicate request(s)** — UserByIDs asked twice with the same body in one load. *Fix:* one query key for the read so TanStack dedupes it. *Trade-off:* none beyond the key.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 11 | 2 | 2 | 1167 (noisy) | — | — | first baseline (P4) |
