# Development state — user

**Pass:** implementation analysis — the **prototype is built, awaiting design_accept**
([Q23](../../business/user/context_clarify.md#question)). Before it: business analysis on the owner's [user/context.md](../../business/user/context.md) — roles per team type,
Root and the System Administrator, suspend, the dev root, and how a team's members are managed. Questions:
[context_clarify.md](../../business/user/context_clarify.md), **five open**: Q21–Q23 from the prototype, Q24–Q25 from §General Data, found 2026-10-05. Q3–Q20 were answered by 2026-10-02. Decisions:
[context_decision.md](../../business/user/context_decision.md) — **44 recorded, 2 of them superseded**. One question was
re-routed: who confirms a stock count is [inventory Q12](../../business/inventory/context_clarify.md#question).

The service predates the lifecycle: every RPC in `proto/warehouse/user/v1/user.proto` (19) has a handler and a test,
and they pass against Postgres. **The decisions below are mostly NOT built yet.**

## Prototype — built, not accepted

Screens are built to the decisions; the server is unchanged. Each part the server does not do carries a pending mark
(`pages/users/pending.ts`, `features/users/pending.ts`). Preview: Storybook `Pages/Users/Users`,
`Features/Users/AddMemberDialog`. The stub `.storybook/userStub.ts` plays the decided rules in its own terms (never
imports `lib/roles.ts`), writeable, reset per story.

| | |
| --- | --- |
| contract (additive) | `UserList` MEMBERSHIP slice · `SearchUser.team_id` + `roles_in_team` · `PublicUser.phone_last4` · `UpdateUserRequest.username` · `UserErase` · `TeamMemberLogList` · `DeleteUser` deprecated. Placeholders `user_erase.go`, `team_member_log_list.go` answer `Unimplemented`, with tests |
| screen rules | `lib/roles.ts`: `roleRank`, `managesMembers`, `grantableRoles`, `canManageMember`, `canSuspendUser`, `canEraseUser`, `defaultGrant` (no role preselected in the root team) |
| Users page | tabs: My Team User · Membership History · All User (Root and the Administrator only). Role column, rank-gated ⋯ menu, Change Role dialog, Erase, no Delete. Add Member / New User only for member managers |
| Add Member popup | `features/users/AddMemberDialog.tsx` rewritten: search list → Select Role / Change Role / Create and Add |
| elsewhere | Edit has a username field (not on yourself) · New User offers `grantableRoles` · the shop grant's picker is scoped to its team · `RoleSelect` seeds its list (a prefilled role used to read blank) |
| e2e | `e2e/users.spec.ts`: roles chosen explicitly in the root team, the popup's test ids, DeleteUser test → "no Delete offered" |

## Built, and the decisions agree

| | |
| --- | --- |
| roles | one role per (user, team), enforced by `UNIQUE (team_id, user_id)` — [one-role-per-person-per-team](../../business/user/context_decision.md#one-role-per-person-per-team) |
| Root and Administrator | pass every team's scope — [root-can-do-anything](../../business/user/context_decision.md#root-can-do-anything), [the-administrator-can-do-anything](../../business/user/context_decision.md#the-administrator-can-do-anything) |
| Staff | accepts a restock, accepts, packs and ships an order — [staff-accepts-the-restock](../../business/user/context_decision.md#staff-accepts-the-restock) |
| Customer Service | orders, drafts, restock requests, settlements (post and import) — [customer-service-runs-orders-restock-requests-and-settlements](../../business/user/context_decision.md#customer-service-runs-orders-restock-requests-and-settlements) |
| members | the warehouse and selling Admins and every Owner manage them — [the-admin-team-admin-alone-does-not-manage-members](../../business/user/context_decision.md#the-admin-team-admin-alone-does-not-manage-members) |
| markup, reserve, lock | the selling Owner and Admin, not Customer Service — [the-selling-owner-and-admin-set-markup-reserve-and-lock](../../business/user/context_decision.md#the-selling-owner-and-admin-set-markup-reserve-and-lock) |

## Decided, not built

Grouped by what changes. **Do the rename first** — every later item names roles.

| # | change | decisions |
| --- | --- | --- |
| 1 | **Rename roles**, numbers kept: `TEAM_OWNER`→`SELLING_OWNER`, `TEAM_ADMIN`→`SELLING_ADMIN`, `TEAM_CUSTOMER_SERVICE`→`SELLING_CS`, `ADMIN`→`ADMINISTRATOR`. **Add** `ADMIN_OWNER`, `ADMIN_ADMINISTRATOR` and move the admin team's members onto them (team ids from team_service). 284 policy lines, both generated sides, CLAUDE.md's roling section. Then shut the admin team's Admin out of member management | [the-role-names-are-the-codes-names](../../business/user/context_decision.md#the-role-names-are-the-codes-names) · [the-admin-team-admin-alone-does-not-manage-members](../../business/user/context_decision.md#the-admin-team-admin-alone-does-not-manage-members) · [admin-team-roles-manage-only-their-team](../../business/user/context_decision.md#admin-team-roles-manage-only-their-team) — the admin roles join the team-info and member policies only, never a selling one. **On hold by the owner (2026-10-02): not yet.** No admin-type team exists in dev, so nothing has to move. ⚠ Four root-team memberships in dev hold role 4; leave them, and refuse a role that is not its team type's |
| 2 | **Grant checks** in `CreateUser` and `TeamUserUpdate`: never Root; `administrator` only by Root; nobody gives their own role; Change Role only below your own, to below your own. The role picker offers only what the caller may give | [root-is-granted-only-through-san](../../business/user/context_decision.md#root-is-granted-only-through-san) · [root-grants-the-administrator](../../business/user/context_decision.md#root-grants-the-administrator) · [an-owner-never-makes-another-owner](../../business/user/context_decision.md#an-owner-never-makes-another-owner) · [no-admin-makes-another-admin](../../business/user/context_decision.md#no-admin-makes-another-admin) · [change-role-only-below-your-own](../../business/user/context_decision.md#change-role-only-below-your-own) |
| 3 | **Add Member popup**: shows an existing member's current role and reads *Change Role*; offers *create* when the search misses | [an-existing-member-gets-change-role](../../business/user/context_decision.md#an-existing-member-gets-change-role) · [owner-root-and-administrator-add-members](../../business/user/context_decision.md#owner-root-and-administrator-add-members) |
| 4 | **Search**: `SearchUser` gains the team as its scope and a role policy; exact username/phone/email for Owners and Admins, broad for Root and the Administrator; suspended left out; results carry the phone's last four digits. The shop grant's picker passes its team | [only-member-managers-open-the-search](../../business/user/context_decision.md#only-member-managers-open-the-search) · [managers-search-by-exact-username-phone-or-email](../../business/user/context_decision.md#managers-search-by-exact-username-phone-or-email) · [a-result-shows-the-phones-last-four-digits](../../business/user/context_decision.md#a-result-shows-the-phones-last-four-digits) · [a-suspended-user-is-never-picked](../../business/user/context_decision.md#a-suspended-user-is-never-picked) · [a-shop-grant-picks-from-the-teams-members](../../business/user/context_decision.md#a-shop-grant-picks-from-the-teams-members) |
| 5 | **One account per phone or email**: a unique phone index (resolve stored duplicates first); create and edit refuse a taken one | [a-phone-or-email-belongs-to-one-account](../../business/user/context_decision.md#a-phone-or-email-belongs-to-one-account) |
| 6 | **Suspend by role, not id**: refuse a Root target always, an Administrator target unless the caller is Root. Suspend offered only where allowed | [only-root-and-the-administrator-suspend](../../business/user/context_decision.md#only-root-and-the-administrator-suspend) |
| 7 | **No delete**: remove `DeleteUser`, its handler, test, and the Users screen's Delete action | [a-user-is-never-deleted](../../business/user/context_decision.md#a-user-is-never-deleted) |
| 8 | **Erase**: blank name, email, phone, photo, password; username → `erased<id>`; suspended accounts only; Root and the Administrator | [erase-keeps-the-row](../../business/user/context_decision.md#erase-keeps-the-row) |
| 9 | **Editable username**: `UpdateUser` takes an optional username, same rule as create, still unique; user 1 keeps `root` | [the-username-is-editable](../../business/user/context_decision.md#the-username-is-editable) |
| 10 | **Dev root**: migration `00005` sets `root1234` and `root@pdc.com` only while root's password is empty / email is the old one; rewrite the FAQ, `san seed root`'s description and docs/tools/san.md in the same commit | [the-migration-writes-the-dev-root-password](../../business/user/context_decision.md#the-migration-writes-the-dev-root-password) · [dev-root-password-is-root1234](../../business/user/context_decision.md#dev-root-password-is-root1234) |
| 11 | **`tools/san` adds and removes a Root**; it refuses to remove the last one (confirmed, Q20c) | [root-can-be-several](../../business/user/context_decision.md#root-can-be-several) |
| 12 | **The admin team reads every team**: a request message declares itself a read in the proto; the access check lets an admin-type team's member past another team's scope for reads only. Lands with item 1 | [the-admin-team-monitors-all-and-manages-its-own](../../business/user/context_decision.md#the-admin-team-monitors-all-and-manages-its-own) |
| 13 | **Membership log**: a user_service table written in the same transaction as every add, change and removal; shown on the member page; `docs/database-schema.md` updated | [every-role-change-is-logged](../../business/user/context_decision.md#every-role-change-is-logged) |
| 14 | **Override stamp**: every service that records who acted also records an override. Liability's terms log already does | [an-override-is-stamped-in-every-service](../../business/user/context_decision.md#an-override-is-stamped-in-every-service) |
| 15 | **Labels**: *System Administrator* and *Admin Team Admin* in both catalogues | [the-two-administrators-have-distinct-labels](../../business/user/context_decision.md#the-two-administrators-have-distinct-labels) |
| 16 | **Removing a member**: the remove checks the caller's role against the person's, writes the log row, and publishes a *member removed* event; the shop side drops their grants in that team and clears a primary flag. Its topic is made by `san pubsub ensure` | [removing-a-member-drops-their-shop-access](../../business/user/context_decision.md#removing-a-member-drops-their-shop-access) |
| 17 | **Warehouse Admin money limits**: `LiabilityTermsSet`, `LiabilityTermsDelete`, `FinancialAccountTransfer`, `FinancialAccountCapital` lose `ROLE_WAREHOUSE_ADMIN` | [the-warehouse-admin-equals-the-owner-except-money](../../business/user/context_decision.md#the-warehouse-admin-equals-the-owner-except-money) |
| 18 | **short_code**: a unique alias column on `users`, unique system-wide. Its rules wait on Q24a–d | [short-code-is-a-unique-alias](../../business/user/context_decision.md#short-code-is-a-unique-alias) |

## Not decided

| | |
| --- | --- |
| who confirms a count or a loss | [inventory Q12](../../business/inventory/context_clarify.md#question) |
| do the restock filters stop using `SearchUser` | [user Q21](../../business/user/context_clarify.md#question) |
| an Admin changes nobody's role | [user Q22](../../business/user/context_clarify.md#question) |
| accept the prototype; remove New User | [user Q23](../../business/user/context_clarify.md#question). Waits on Q24 |
| short_code, a unique alias: does it replace `alias`, is it required, its format and who changes it, is it searchable | [user Q24](../../business/user/context_clarify.md#question) |
| is §General Data the whole record, and is phone kept. Email required? | [user Q25](../../business/user/context_clarify.md#question) |
