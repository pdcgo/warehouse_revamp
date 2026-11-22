# restock-warehouse — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #126. Page `frontend/src/pages/restock-warehouse`, route `/inventories/restock`, opened as **wh_owner**.

**Verdict:** 11 screen requests on a warm load (+4 shell); 3-deep waiting chains (RestockRequestList → UserByIDs → ShipmentChannelByIds); 1 duplicate(s) (UserByIDs); usable in 1113 ms.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 214 uncommitted file(s) · production build `4dbf4bc09b6aaf23` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 55 liability entries · 2 shops · 25 orders · 25 drafts · 25 expenses · 3 found · 1 count · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 15 — shell 4 · screen 11 |
| requests, cold load | 15 |
| same RPC asked twice | 1 — UserByIDs |
| CORS pre-checks (OPTIONS) | 0 warm · 13 cold |
| waiting chain (measured) | depth 3 (3 over 2 dependency passes) — RestockRequestList → UserByIDs → ShipmentChannelByIds |
| time until usable | 1113 ms median (1113–1113, 1 warm) — noisy · cold 1890 ms |
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
| `CustomShipmentService/CustomShipmentList` | 1 | 1 |  |
| `RestockRequestService/RestockActorList` | 1 | 1 |  |
| `RestockRequestService/RestockCodPaidStat` | 1 | 1 |  |
| `RestockRequestService/RestockInboundStat` | 1 | 1 |  |
| `RestockRequestService/RestockRequestList` | 1 | 1 |  |
| `RestockRequestService/RestockTagList` | 1 | 1 |  |
| `ShipmentChannelService/ShipmentChannelByIds` | 1 | 3 |  |
| `TeamService/TeamList` | 2 | 1 |  |
| `UserService/UserByIDs` | 2 | 1 · 2 | ✗ yes |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **A 3-deep waiting chain** — RestockRequestList → UserByIDs → ShipmentChannelByIds: each call starts only when the one before answers, so the screen pays 3 round trips before it can draw. *Fix:* the later reads as query hooks keyed on the earlier answers (#120–#122 — they still wait, but can be prefetched or merged into one RPC that answers the names with the rows). *Trade-off:* a merged RPC couples two services' reads.
2. **1 duplicate request(s)** — UserByIDs asked twice with the same body in one load. *Fix:* one query key for the read so TanStack dedupes it. *Trade-off:* none beyond the key.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 11 | 1 | 3 | 1113 (noisy) | — | — | first baseline (P4) |
