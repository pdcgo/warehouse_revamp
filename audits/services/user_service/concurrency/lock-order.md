# user_service — lock order

The service-wide matrix the `audit-sql` skill writes unconditionally. Not a finding — the reference the next
write handler is checked against.

**Verdict: one lock, the target person's `users` row, and nothing else.** Every membership write locks the
person it changes before it reads their role, so "read the role, check it, write" cannot be overtaken by another
change to the same person. Each transaction locks exactly one row, so there is no order to disagree about. The
one network call — team_service, for the team's type — is made **before** the transaction. Raced and
interleaved: **safe**.

| Handler | Lock order | Notes |
| --- | --- | --- |
| `TeamUserUpdate` (add, change) | *(team type from team_service — outside)* → `users` (1, the target) → `user_team_roles` (upsert on `team_id, user_id`) | the target's role is read **after** the lock, in a fresh statement, so it sees any change committed while waiting |
| `TeamUserUpdate` (remove) | `users` (1, the target) → `user_team_roles` (delete) | same check, same lock |
| `SuspendUser` | `users` (1, the target) → reads the target's ROOT-team role → `users` update | judged by role under the lock, so the target cannot be made an Administrator between the read and the suspend |
| `CreateUser` | *(team type — outside)* → new `users` row → new `user_team_roles` row | a new person cannot be contended; the unique indexes refuse a racing duplicate username or email |
| `DeleteUser` *(deprecated, being removed)* | `users` (delete, cascades to `user_team_roles`) | its row delete waits on the same `users` lock |

Every other writer of `user_team_roles` is `tools/san seed`, a development tool that writes directly.

Evidence: [`team_user_update_race_test.go`](../../../../backend/services/user_service/user_v1/team_user_update_race_test.go) (`raceaudit`).

| proved | how |
| --- | --- |
| an Owner never demotes a person Root is promoting | 40 rounds of *the Owner demotes Ani* ‖ *Root promotes Ani* → Ani always ends an Owner; both orders occurred (the demotion landed first in 23) |
| the lock holds, and the check uses what it read under it | **Interleave: the Owner's lock BLOCKS** until Root commits, then reads *Owner* and is refused |
| the Administrator never suspends a person Root is making an Administrator | **Interleave: the suspend BLOCKS** until Root commits, then reads *Administrator* and is refused |

**Not proved here:** the CALLER's own role is the interceptor's cached decision, read before the transaction. An
Owner demoted at the same second they act still acts as an Owner — the same window `RoleCacheTTL` bounds for every
RPC in the system, not a property of this handler.

| History | |
| --- | --- |
| 2026-10-05 | first matrix — `TeamUserUpdate` gained its role checks and the `users` row lock; `SuspendUser` judges by role under the same lock |
