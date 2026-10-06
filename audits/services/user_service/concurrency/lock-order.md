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
| `TeamUserUpdate` (add, change) | *(team type from team_service — outside)* → `users` (1, the target) → `user_team_roles` (upsert on `team_id, user_id`) → `team_member_logs` (insert) | the target's role is read **after** the lock, in a fresh statement, so it sees any change committed while waiting. A NEW member's `is_suspended` is read the same way, under the same lock — no second lock |
| `TeamUserUpdate` (remove) | `users` (1, the target) → `user_team_roles` (delete) → `team_member_logs` (insert) | same check, same lock |
| `UserErase` | `users` (1, the target) → reads the target's ROOT-team role and suspension → `users` update | the suspend rule, and suspended-only, both judged under the lock — an unsuspend racing it queues, and the erase then refuses |
| `SuspendUser` | `users` (1, the target) → reads the target's ROOT-team role → `users` update | judged by role under the lock, so the target cannot be made an Administrator between the read and the suspend |
| `CreateUser` | *(team type — outside)* → new `users` row → new `user_team_roles` row → `team_member_logs` (insert) | a new person cannot be contended; the unique indexes refuse a racing duplicate username, email or phone (`users_phone_unique`, 00008) — `refuseTakenContact` reads first only to name the field |
| `UpdateUser` | `users` (1, update) | a username taken by a racing rename is refused by the unique index on `LOWER(username)`, as `already_exists` |

Every other writer of `user_team_roles` is `tools/san seed`, a development tool that writes directly.

Evidence: [`team_user_update_race_test.go`](../../../../backend/services/user_service/user_v1/team_user_update_race_test.go) (`raceaudit`).

| proved | how |
| --- | --- |
| an Owner never demotes a person Root is promoting | 40 rounds of *the Owner demotes Ani* ‖ *Root promotes Ani* → Ani always ends an Owner; both orders occurred (the demotion landed first in 23) |
| the lock holds, and the check uses what it read under it | **Interleave: the Owner's lock BLOCKS** until Root commits, then reads *Owner* and is refused |
| the Administrator never suspends a person Root is making an Administrator | **Interleave: the suspend BLOCKS** until Root commits, then reads *Administrator* and is refused |
| an erase never blanks an account that was just unsuspended | **Interleave: the erase BLOCKS** until the unsuspend commits, then reads *not suspended* and refuses |
| a person being suspended is never added to a team ([a-suspended-user-is-never-picked](../../../../docs/business/user/context_decision.md#a-suspended-user-is-never-picked)) | **Interleave: the add BLOCKS** (309 ms) until the suspend commits, then reads *suspended* and is refused. 40 rounds of *Root suspends Ani* ‖ *Root adds Ani* → no deadlock, no unexpected error (the suspend landed first in 39) |
| one phone, one account ([a-phone-or-email-belongs-to-one-account](../../../../docs/business/user/context_decision.md#a-phone-or-email-belongs-to-one-account)) — a phantom insert: two saves can both read *nobody has it* | 20 rounds of eight creates at once, one number written eight ways → one account holds it every round. **Interleave: the second insert BLOCKS** (302 ms) on the unique index until the first commits, then fails with a unique violation (AlreadyExists to the caller). `phone_race_test.go` |

**Not proved here:** the CALLER's own role is the interceptor's cached decision, read before the transaction. An
Owner demoted at the same second they act still acts as an Owner — the same window `RoleCacheTTL` bounds for every
RPC in the system, not a property of this handler.

| History | |
| --- | --- |
| 2026-10-05 | first matrix — `TeamUserUpdate` gained its role checks and the `users` row lock; `SuspendUser` judges by role under the same lock |
| 2026-10-06 | `DeleteUser` removed; `UpdateUser` may change the username |
| 2026-10-06, later | `TeamUserUpdate` refuses a suspended newcomer, read under the existing lock; `TeamCreate` grants through it |
| 2026-10-06, erase final | `lockMembership` reads `erased_at` too. The password writers and `applyUserUpdates` refuse an erased account in the UPDATE's own WHERE, so under READ COMMITTED an erase they waited behind is re-evaluated and refuses them — no new lock. Re-ran every Interleave |
| 2026-10-06, last | the membership log: an INSERT in each membership transaction, no new lock (a log row is new, so nobody contends for it). `lockMembership` reads `is_suspended` in its locking query; the suspend-vs-add Interleave re-run on it — the blocked lock returns the row's newest version, and the add refuses |
| 2026-10-06, phones | one account per phone: a check before the write names the field, and `users_phone_unique` (00008) is the guarantee — raced and interleaved. No row lock added |
| 2026-10-06, removal announced | `TeamUserUpdate`'s removal publishes `MemberRemoved` AFTER its commit — no lock is held across the publish, nothing else changed |
