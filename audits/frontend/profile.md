# profile — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #122. Page `frontend/src/pages/profile`, route `/profile`, opened as **seller**.

**Verdict:** 2 screen requests on a warm load (+3 shell); 2-deep waiting chains (ProfileDetail → AgentConnectionList); no duplicate; usable in 351 ms; its save fired 0 request(s) after (recorded).

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 144 uncommitted file(s) · production build `dd324215e7891358` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 30 liability entries · 2 shops · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 5 — shell 3 · screen 2 |
| requests, cold load | 5 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 5 cold |
| waiting chain (measured) | depth 2 — ProfileDetail → AgentConnectionList |
| time until usable | 351 ms median (351–351, 1 warm) — noisy · cold 884 ms |
| counts agree across warm loads | yes |
| requests after one save | 0 — recorded (UpdateProfile (unchanged)) |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `LiabilityService/LiabilityPositionList` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `AgentService/AgentConnectionList` | 1 | 2 |  |
| `UserService/ProfileDetail` | 1 | 1 |  |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **What the code does** — ProfileDetail is a useEffect read (pages/profile/index.tsx) — #122. The save answers the new row, so no read is expected after it.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 2 | 0 | 2 | 351 (noisy) | 0 | — (P2) | first baseline (P1) |
