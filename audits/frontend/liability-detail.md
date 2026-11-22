# liability-detail — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #122. Page `frontend/src/pages/liability-detail`, route `/liability/{selling_team}`, opened as **wh_owner**.

**Verdict:** 6 screen requests on a warm load (+4 shell); 2-deep waiting chains (LiabilityPaymentList → UserByIDs); no duplicate; usable in 516 ms; its save fired 5 request(s) after (recorded).

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 144 uncommitted file(s) · production build `dd324215e7891358` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 30 liability entries · 2 shops · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 10 — shell 4 · screen 6 |
| requests, cold load | 10 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 9 cold |
| waiting chain (measured) | depth 2 — LiabilityPaymentList → UserByIDs |
| time until usable | 516 ms median (516–516, 1 warm) — noisy · cold 1092 ms |
| counts agree across warm loads | yes |
| requests after one save | 5 — recorded (request payment (LiabilityPaymentRequestSend)) — LiabilityPositionList · LiabilityLogList · LiabilityPaymentList · LiabilityPositionList · LiabilityCreditByIds |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `FoundRequestService/FoundRequestList` | 1 | shell |  |
| `LiabilityService/LiabilityPositionList` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `LiabilityPaymentService/LiabilityPaymentList` | 1 | 1 |  |
| `LiabilityService/LiabilityCreditByIds` | 1 | 1 |  |
| `LiabilityService/LiabilityLogList` | 1 | 1 |  |
| `LiabilityService/LiabilityPositionList` | 1 | 1 |  |
| `TeamService/TeamByIds` | 1 | 1 |  |
| `UserService/UserByIDs` | 1 | 2 |  |

After the save (`LiabilityPaymentRequestSend`), in the order they fired: LiabilityPositionList · LiabilityLogList · LiabilityPaymentList · LiabilityPositionList · LiabilityCreditByIds.

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **What the code does** — Opened by the WAREHOUSE owner on its ledger with the seller (30 courier charges): "request payment" is the creditor's button — the seller, the debtor, has only "make payment". Its team lookup is already a useQuery with a raw key (index.tsx) — #122 moves only the key.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 6 | 0 | 2 | 516 (noisy) | 5 | — (P2) | first baseline (P1) |
