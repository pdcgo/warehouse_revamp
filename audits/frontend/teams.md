# teams — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #126. Page `frontend/src/pages/teams`, route `/teams`, opened as **root**.

**Verdict:** 2 screen requests on a warm load (+2 shell); 2-deep waiting chains (TeamList → TeamReturnConfigurationByIds); no duplicate; usable in 449 ms.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 214 uncommitted file(s) · production build `4dbf4bc09b6aaf23` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 55 liability entries · 2 shops · 25 orders · 25 drafts · 25 expenses · 3 found · 1 count · 1 cold + 1 warm load(s) · NOISY — counts only, a full e2e run was live beside it; times recorded, not judged.

| measure | value |
| --- | --- |
| requests per load (warm) | 4 — shell 2 · screen 2 |
| requests, cold load | 4 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 4 cold |
| waiting chain (measured) | depth 2 (2 over 2 dependency passes) — TeamList → TeamReturnConfigurationByIds |
| time until usable | 449 ms median (449–449, 1 warm) — noisy · cold 806 ms |
| counts agree across warm loads | yes |
| requests after one save | — no save measured |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `TeamReturnConfigurationService/TeamReturnConfigurationByIds` | 1 | 2 |  |
| `TeamService/TeamList` | 1 | 1 |  |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **What the code does** — The page draws no root test id: usable waits on the shell's `main` (no loading marker, nothing in flight) — the app is never edited for the audit.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 2 | 0 | 2 | 449 (noisy) | — | — | first baseline (P4) |
