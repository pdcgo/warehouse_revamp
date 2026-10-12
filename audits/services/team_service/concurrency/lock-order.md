# team_service — lock order

The service-wide matrix the `audit-sql` skill writes unconditionally. Not a finding — the reference the next
write handler is checked against.

**Verdict: no handler takes a row lock.** Every write is a single statement or an insert, and the one existence
question two callers can race on — *is this team code free?* — is answered by the database's UNIQUE index on
`team_code`, not by the handler. `TeamCreate`'s one network call, the Owner grant to user_service, is made
**after** its transaction commits, so no lock is ever held across it. Raced: **safe**.

| Handler | What it writes | Notes |
| --- | --- | --- |
| `TeamCreate` | `teams` + `team_infos` (one transaction) → *(the Owner grant, user_service — outside)* → on a refusal, `DELETE teams` (`team_infos` cascades); on an unknown outcome, `teams.deleted = true` | a racing duplicate code is refused by `teams_team_code_unique` as `already_exists` |
| `TeamUpdate`, `TeamInfoUpdate`, `WarehouseInfoUpdate` | a *team exists* check, then one row, by team id, in a transaction | `TeamInfoUpdate` and `WarehouseInfoUpdate` upsert on a UNIQUE `team_id`. ⚠ not raced in this pass |
| `TeamDelete` | a *team exists* check, then `teams.deleted = true` | ⚠ not raced in this pass |

Evidence: [`team_create_race_test.go`](../../../../backend/services/team_service/team_v1/team_create_race_test.go) (`raceaudit`).

| proved | how |
| --- | --- |
| two creates with one code make exactly one team | 40 rounds of two simultaneous creates → one team each round, the other caller told `already_exists` |
| a refused Owner never keeps the code | 40 rounds of two simultaneous creates whose Owner is refused → **no** team left with the code, whichever deleted first |

**Not proved here:** the three updates and `TeamDelete` above, each a check-then-write with no row lock (a delete racing an update is the case to try). And between a create's commit and its compensating delete (one round-trip to user_service), the team
is visible. Somebody who learned its id in that window and added a member would leave that membership pointing at a
team the hard delete then removes. Nobody can learn the id but the creator, so it was not raced.

| History | |
| --- | --- |
| 2026-10-06 | first matrix — `TeamCreate` grants the NAMED Owner, and a refused grant hard-deletes the team so its code stays free |
