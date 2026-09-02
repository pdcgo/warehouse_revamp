# The 7 Biggest Questions

Every open question in every `_clarify.md`, rolled up to the seven that block the most.

> **Derived file — regenerate, never hand-edit.** Same rule as a `state_report`. The open SET comes
> from `*_clarify.md` only, never from `*_decision.md`, so an answered question leaves here the moment
> it is recorded. Rebuild it whenever any `_clarify.md` changes.
>
> ⚠ **But the RANK is checked against the code, not only against the docs.** A rebuild that reads the
> clarify files alone cannot see that a question has been overtaken by what shipped — which is how
> four of seven rows went stale at once (see below). Before ranking a row, open the file it is about.
>
> **Ranked by what is BLOCKED**, not by how interesting the question is — a question that stops a
> lifecycle pass outranks one that merely matters. Several rows below are **one question asked in two
> docs**, and merging those is most of what this file is for.

**110 open questions across 20 files.** The seven below are shown; **103 are not** — they are not
closed, only smaller. The per-file counts are at the bottom.

> ## What changed this round
>
> 🆕 **Settlement became THREE docs, and the split answered one of this file's questions.**
> `context.md` kept the ledger; the reports moved to
> [analytic_context.md](business/settlement/analytic_context.md) and a new
> [meta_context.md](business/settlement/meta_context.md) holds a `settlement_service_metadata` key/value
> table. ✅ The drawn `Ledger Updated → Event → Message Broker → http push → Service Webhook` settles the
> last of the three competing architectures: **the fold owns the report, not the writer**
> ([the-fold-owns-the-report-not-the-writer](business/settlement/context_decision.md#the-fold-owns-the-report-not-the-writer)).
> My clarify split with it — the report questions were **re-routed** to
> [analytic_context_clarify.md](business/settlement/analytic_context_clarify.md) and
> [meta_context_clarify.md](business/settlement/meta_context_clarify.md).
>
> ⛔ **The sharpest thing found this round is a corruption produced by two answers that were each
> correct.** `### Idempotency Layer.` keys dedup on the **broker's message id** — right, and it resolves
> the replay collision in the right direction, because `AnalyticReplayCompute` republishes under new ids
> and is therefore deliberately not deduped. But the fold **increments** (`fund += @change`). Put those
> together and **a replay adds every movement in its range a second time** — and the RPC is reached for
> precisely when the rows already hold numbers. Neither half is wrong on its own; the pair is.
> **→ Recompute the day rather than increment it**, and replay becomes harmless. If the increment stays,
> replay must zero the range in the same transaction and the doc must say so.
> → [analytic Q1](business/settlement/analytic_context_clarify.md#question)
>
> ⛔ **And the dedup row is written BEFORE the compute**, so a compute that fails after it commits is
> redelivered, recognised as *already processed*, ACKed — and the movement is never folded, with nothing
> reporting it. ⚠ The fix has a Postgres detail that decides its shape: a raw PK violation **aborts the
> transaction**, so it must be `INSERT … ON CONFLICT DO NOTHING` with a rows-affected check, never a
> caught error inside the transaction that also does the compute.
> → [analytic Q2](business/settlement/analytic_context_clarify.md#question)
>
> ✅ **The user-dimension blocker was answered — for the live fold only.** `### Events.` now carries
> `order_created_by_user_id`, which is where that person comes from. ⛔ **But it is persisted nowhere** —
> not on `settlement_logs`, not on `order_settlements`, and [`orders`](backend/services/selling_service/selling_service_models/order.go)
> still has no creator column (`AuthorUserID` is on `order_drafts`). So the user table can be folded and
> never **rebuilt**, and every writer must supply it forever on a request that has no such field.
> **→ `order_settlements.creator_user_id`, stamped once by the opening row** — the event may still carry
> it, it just stops being the only copy.
> → [analytic Q3](business/settlement/analytic_context_clarify.md#question)
>
> ⛔ **And a security hole that is not settlement's alone.** The doc specifies a webhook at
> `/event/[sub_id]/push`. [push.go:41](backend/pkgs/event_source/push.go#L41) reads the body, decodes and
> calls the handler — **no token, no signature, no check of any kind** — and the roling ACL cannot reach
> it, because it reads `request_policy` off a Connect request message and a webhook is not one. Anyone
> who can reach the port POSTs JSON and moves a shop's reported balance. This is the **one write path in
> the system the ACL does not cover**, and every future consumer inherits it.
> → [analytic Q3](business/settlement/analytic_context_clarify.md#question)
>
> ⚠ **One answer went against my last recommendation, and it was right to.** I said delete the
> `is Event Received late ?` branch. The owner instead gave it a mechanism — `update and recount upper
> date` — which is **correct given a stored carry**: a snapshot has no chain to recount, a carry does.
> So the branch was never the question; **stored-or-derived `open_balance` is**, and it is now concrete:
> as drawn, one late event rewrites every later day for that scope while the live fold writes the same
> rows.
> → [analytic Q4](business/settlement/analytic_context_clarify.md#question) ·
> [analytic Contradiction](business/settlement/analytic_context_clarify.md#contradiction)
>
> 🆕 **The fold became SQL, which is the most checkable thing in any of these docs — and it does not
> run.** Four statements: `+=` is not a Postgres operator, `SET d.col` is rejected (the alias is legal
> everywhere except the left of `SET`), and a `VALUES` list cannot see a CTE. Underneath the syntax the
> arithmetic is wrong in five places, two of them silent: `d.fund` appears **twice** in the
> `close_balance` sum, and the update recomputes `close_balance` **without** `open_balance` — so a day is
> correct until its second movement arrives and then loses all prior position, permanently, while still
> looking internally consistent. **Not a question** — the corrections are written out, and two statements
> replace four. ⛔ **What IS a question is the bucket day**: step 1 derives it from `created_at` in GMT+7
> while [posted-on-buckets-the-report](business/settlement/context_decision.md#posted-on-buckets-the-report)
> fixed it on `posted_on`, which is stamped on the **UTC** date with no timezone configured anywhere. The
> two disagree for every movement between 00:00 and 07:00 WIB.
> → [analytic — the write path](business/settlement/analytic_context_clarify.md#the-write-path-checked-statement-by-statement)
>
> **One line in the owner’s doc reversed this file’s own recommendation, and the reversal is worth more
> than the row it changes.** `settlement_context.md` gained `## General.` 1 — *"Design Analytic Principle
> is follow [this](business/analytic/context.md)"* — so the settlement report is built the **pipeline**
> way: log → broker → stream → report table, not a `GROUP BY`
> ([the-report-follows-the-analytic-principle](business/settlement/context_decision.md#the-report-follows-the-analytic-principle)).
>
> ⛔ **This is the first time #7 has been answered by a decision rather than argued about — and it makes
> #7 BLOCKING for a second context.** Settlement’s report now inherits every open question in `analytic`:
> the fold contract, the rebuild path, the midnight reconcile, the dedup layer. A context that had
> finished designing its report in a day is now waiting on the one context that has not started.
>
> ⛔ **And the pipeline has no parts.** Checked against the code: `settlement_v1.Service` takes a
> `*gorm.DB` and no `EventSender`, there is **no settlement event message in the proto**, nothing
> consumes one, there is no report table migration, and there is **no analytic or report service in
> `backend/services/`**. [settlement-publishes-to-the-book](business/settlement/context_decision.md#settlement-publishes-to-the-book)
> was decided long ago and never built — so the *"Source Truth Logs"* box that the whole analytic design
> stands on is, for its one existing log, **a table nobody publishes**.
> → [settlement Q6](business/settlement/context_clarify.md#question)
>
> ✅ **Two answers that turned out to agree.** `## Whats Number to be reported.` lists the seven ledger
> types — which is an **additive basis** for the measure decided hours earlier, not a replacement for it
> (`sales`, `net_received` and `gap` are all derivable from those seven). And `posted_on` fits a stream
> processor better than the alternative would: a fold learns of a row when its event arrives, which is
> what `posted_on` already means.
>
> ⚠ **One contradiction, and it is mine.** The measure decision also asserted *"a fold over facts, not a
> stored table"* — overtaken the same day. The property worth keeping: **a decision about a MEASURE must
> not also assert WHERE it is computed.**
> → [settlement Contradiction](business/settlement/context_clarify.md#contradiction)
>
> ⛔ **Sequencing was answered and then REVERSED, both within the day.** *Query first* was taken and is
> now cancelled — [the-report-is-the-pipeline-from-day-one](business/settlement/context_decision.md#the-report-is-the-pipeline-from-day-one)
> strikes [the-report-ships-as-a-query-first](business/settlement/context_decision.md#the-report-ships-as-a-query-first).
> So **settlement is blocked by `analytic` after all**, and by four missing pieces starting with a
> publisher it does not have. ⚠ **Two things are owed because that phase is gone**, and they are cheap now
> and expensive later: keep the aggregate as a **test oracle** even though it is never an RPC — it was the
> only independent second opinion the folded table would have had — and make the fold **re-runnable from
> the log by cursor**, because Pub/Sub retains messages for days and a definition change needs years.
> **The fourth dimension:** *Group by Customer Service* became **Group by User**
> ([the-fourth-shape-groups-by-user](business/settlement/context_decision.md#the-fourth-shape-groups-by-user)) — so the
> dimension is `actor_id`, which settlement already carries, and the *"a column that exists in no
> table"* blocker is gone without touching `selling_service`. ⚠ What replaces it is narrower: `actor_id`
> is **who wrote the row**, so an imported fee lands on the importer’s PIC rather than on whoever sold.
>
> ⛔ **Then a new section arrived that describes HOW a write happens — and it is where the day’s
> answers stop agreeing with each other.** `# Settlement Ledger.` draws the write protocol: open a
> transaction, lock the state, **call another service’s `InitOpeningBalance` inside it**, and **roll the
> ledger write back if that call fails**. Nothing of it is built — no `InitOpeningBalance`, no
> `settlement_states`, no daily shop report in the repo.
>
> | ✅ what it settles | ⛔ what it opens |
> | --- | --- |
> | **settlement DOES publish** — `Dispatch Event` finally gives [settlement-publishes-to-the-book](business/settlement/context_decision.md#settlement-publishes-to-the-book) a drawn path, which was the missing first part of the pipeline · the write is transactional and the state is **locked**, the right shape for two people on one shop | **a THIRD architecture for one report table** — a `GROUP BY` at read, a stream fold, and now a table the WRITER maintains synchronously · **a network call inside a transaction holding a row lock** · **a report failure rolls back money that really arrived** · an **opening balance**, which the measure decided hours earlier has no place for |
>
> ⚠ **It is also a concrete instance of #1 below, answered in the wrong direction.** One seam up, a
> publish failure must not fail the order — here a report-bootstrap failure fails the ledger write. The
> same question got opposite answers a paragraph apart.
> → [settlement Q7–Q9](business/settlement/context_clarify.md#question) ·
> [the protocol read in full](business/settlement/context_clarify.md#the-ledger-write-protocol--read-against-the-two-decisions-taken-today)
>
> ⚠ **And the state table now has two names** — `settlement_states` in the new section, `order_settlements`
> in the old one, in the migration, in the proto and in a recorded decision. Second time in this context
> that one concept has been written down twice.
> → [settlement Contradiction](business/settlement/context_clarify.md#contradiction)
>
> ⛔ **And then the table itself arrived — with two silent defects.** `## Smallest Grain Reports.`
> names `shop_settlement_daily_report`, unique on `(day, shop_id, team_id)`, carrying per-type movements
> **and** an open/close balance — so the opening-balance question is answered, and answered as **both**
> ([the-smallest-grain-is-the-shop-day-statement](business/settlement/context_decision.md#the-smallest-grain-is-the-shop-day-statement)).
> ✅ The statement shape is only safe because `posted_on` already guarantees a closed day never moves —
> two answers taken hours apart that turn out to depend on each other.
>
> | ⛔ the defect | why it is silent |
> | --- | --- |
> | **`affiliate_fee` is not in the tracked columns** — six of seven types are | an affiliate cut moves `close_balance` while appearing in no column, so `close − open ≠ Σ movements` and the difference has no name. It is the one failure a statement shape exists to make impossible |
> | **there is no USER dimension** | the grain serves shapes 1–3 exactly and **cannot serve shape 4 at all**. ⚠ And the fix is not a wider key: a running position belongs to an ACCOUNT, whose later movements are posted by different people, so a per-user open/close is meaningless — the second table must be **sums only** |
>
> → [settlement Q9](business/settlement/context_clarify.md#question) · [settlement Q10](business/settlement/context_clarify.md#question)
>
> ✅ **Both defects were answered within the hour — one fully, one half.** A second grain table
> `user_settlement_daily_reports` now exists, keyed `(day, user, team)` rather than widening the shop
> table’s key ([the-user-grain-is-a-second-table](business/settlement/context_decision.md#the-user-grain-is-a-second-table)),
> so shape 4 has a source. ⛔ It copies `open_balance` / `close_balance`, which is the half that does not
> transfer: a running position belongs to an **account**, whose later movements are posted by different
> people, so a user’s closing figure is not a position that user holds.
> → [settlement Q9](business/settlement/context_clarify.md#question)
>
> ✅ **And the reason for `InitOpeningBalance` is now stated — a lost update on the window aggregation.**
> The race is real and worth guarding. ⛔ But it justifies **a** guard, not **this** one: the contended
> row is the report’s, so the guard belongs there — serialize the fold on the broker’s ordering key
> `(shop_id, day)`, or `INSERT … ON CONFLICT DO NOTHING` in the report’s own transaction. Neither needs a
> network call held inside the ledger’s transaction, and neither can roll a settlement write back.
> → [settlement Q8](business/settlement/context_clarify.md#question)
>
> ✅ **And the two balance columns turned out to be simpler than the argument about them.** They are
> **snapshots aggregated from the log at the day boundaries**, never carried forward
> ([open-and-close-are-log-sums-at-the-day-boundaries](business/settlement/context_decision.md#open-and-close-are-log-sums-at-the-day-boundaries)).
> No carry means no dependency on a previous row, every day is recomputable from `settlement_logs`
> alone — which is the rebuild path the cancelled query phase was going to supply — and
> `close − open = Σ movements` stops being a convention and becomes an **identity**, which makes the
> missing `affiliate_fee` provable rather than suspected.
>
> ✅ **It is also only well-formed because the date is `posted_on`** — `balance` is stamped in WRITE
> order, so *"the position at the end of day D"* means *"the last row written by D"*, which `occurred_on`
> could not express. **Third time those two answers have turned out to depend on each other**, and worth
> naming as a pattern: this context’s decisions are compounding rather than accumulating.
>
> ⛔ **And it forces an older question.** A shop snapshot partitions the book exactly once; a user
> snapshot only does if the set is *the orders that user opened*. So the user table’s balances cannot
> exist unless shape 4 is attributed to the order’s opener rather than the row’s writer — one answer now
> decides two questions.
> → [settlement Q9](business/settlement/context_clarify.md#question) · [settlement Q5](business/settlement/context_clarify.md#question)
>
> ✅ **`affiliate_fee` landed in both grain tables**, so the identity `close − open = Σ movements` can
> hold and the one defect that would have made a statement silently fail to reconcile is gone.
>
> ⚠ **And two of this context’s questions MERGED**, which is worth more than either being answered:
> shape 4’s grouping and the user snapshot’s set cannot be decided separately, because a snapshot only
> partitions if the dimension owns the account. One answer now settles both — and it is the same shape of
> compounding this context has shown three times already, where a decision taken for one reason turns out
> to constrain something decided hours earlier.
>
> ✅ **And the attribution was answered the consistent way** — *"the user is who created the order"*
> ([the-user-is-the-order-creator](business/settlement/context_decision.md#the-user-is-the-order-creator)).
> Shape 4 is a sales report, the user snapshot partitions the book exactly once, and imported fees stop
> piling onto the importer’s PIC.
>
> ⛔ **It names a person settlement does not record.** `actor_id` is *who wrote the row* and stays that,
> so the creator needs a column — **`order_settlements.creator_user_id`, stamped by the opening row**, is
> the cheap shape, because the fold then joins log → state inside one service. ⚠ And an account whose
> `initial_total` never arrives has **no creator at all**: settlement ignores order status, the exporter
> can post a `fund` first, and a `marketplace_total = 0` order opens no account — real money with nobody
> to attribute it to.
>
> ⚠ **This raises the price of #1 below rather than lowering it.** With no `order_service → settlement`
> call built, nothing stamps a creator on anything, so the user report is not merely empty — it has no
> dimension. The unbuilt seam now blocks two tables.
> → [settlement Q5](business/settlement/context_clarify.md#question)
>
> ⛔ **Then the empty heading was filled — and it disagrees with an answer given an hour earlier.**
> `## How `*_settlement_daily_reports` Created` says today’s row takes the **last row’s `close_balance`**
> as its `open_balance`, or 0 if there is none. But *"open and close balance is sum of balance log of
> start and end of the day"* made those columns a **snapshot aggregated from the log**
> ([open-and-close-are-log-sums-at-the-day-boundaries](business/settlement/context_decision.md#open-and-close-are-log-sums-at-the-day-boundaries)).
> A snapshot and a carry are not the same number, and they diverge in three reachable ways: **`open = 0`
> is wrong for every shop that already trades**, a chain **cannot be rebuilt from one end**, and **one
> missed day poisons every day after it, silently and permanently**. The snapshot has none of those.
> → [settlement Contradiction](business/settlement/context_clarify.md#contradiction)
>
> ⛔ **And `## General.` — the line that chose the architecture — has been DELETED.** *"Design Analytic
> Principle is follow this"* is no longer in the doc, and it is the entire basis of
> [the-report-follows-the-analytic-principle](business/settlement/context_decision.md#the-report-follows-the-analytic-principle).
> ⚠ **A deletion is not a statement**, so it is not recorded as a reversal — but the decision now rests on
> a line that does not exist, and the section that replaced it describes a row **created on demand from
> the previous one**, which is the writer’s path rather than a fold’s. Both moves point away from the
> pipeline, and the query phase was cancelled on the strength of it.
> → [settlement Q7](business/settlement/context_clarify.md#question)
>
> ⚠ **A re-examination with nothing new in the doc — and the finding came from next door.**
> `settlement/context.md` changed by one byte since the last pass and no code has landed since 08-28, so
> none of settlement’s eight questions moved. What moved is the sibling: `analytic` recorded
> [reports-belong-to-the-consumer](business/analytic/context_decision.md#reports-belong-to-the-consumer),
> which relocates *"which numbers, for whom"* to each consuming service — **and cites settlement as its
> proof, on the strength of settlement *"pointing here for the principle"*. That pointer is the
> `## General.` line settlement deleted.** One context has built a decision on a reference the other no
> longer contains, which makes the deleted line a two-context question rather than a one-context one.
> → [settlement Q7](business/settlement/context_clarify.md#question)
>
> ✅ **The deleted line was deliberate: *"because its not mature"*.** Settlement will not bind its
> report to an unfinished design
> ([the-analytic-pointer-is-withdrawn-until-it-is-mature](business/settlement/context_decision.md#the-analytic-pointer-is-withdrawn-until-it-is-mature)),
> so [the-report-follows-the-analytic-principle](business/settlement/context_decision.md#the-report-follows-the-analytic-principle)
> is **withdrawn** and the reason the query phase was cancelled goes with it.
>
> ⚠ **Two of three architectures are now struck, and the survivor is the one the doc actually details** —
> the ledger’s own write path. If that holds, settlement needs **no publisher, no broker and no consumer**
> to have a working report, which is a far smaller build than the last two rounds assumed — and it makes
> the in-transaction guard argument the whole of what is left, because the ledger’s transaction really
> would be doing report work.
>
> ⚠ **This row’s own #7 loses its example.** [reports-belong-to-the-consumer](business/analytic/context_decision.md#reports-belong-to-the-consumer)
> was argued on settlement pointing at analytic *"for the principle"* — the line withdrawn here. The
> decision may still be right; its evidence is not.
> → [settlement Q7](business/settlement/context_clarify.md#question)
>
> ## The round before
>
>
> **The ledger got its first WORKLOAD, and it cannot serve any of it yet.**
> [business/settlement/context.md](business/settlement/context.md) gained `# Settlement Reports.` —
> four report shapes at three grains (team, shop, customer service) over a daterange, at daily /
> monthly / yearly resolution.
>
> | what it settles | what it opens |
> | --- | --- |
> | ✅ **the first concrete answer to #7's demand** — *name the questions a real person asks*. These are real, named, and at a grain the repo already stores · ✅ **and the whole report was settled the same day** — the measure ([the-measure-is-sales-received-and-gap](business/settlement/context_decision.md#the-measure-is-sales-received-and-gap)), the fold ([the-report-is-movement-dated](business/settlement/context_decision.md#the-report-is-movement-dated)) and the date ([posted-on-buckets-the-report](business/settlement/context_decision.md#posted-on-buckets-the-report), ⚠ against recommendation) | ⛔ **"customer service" is a column in no table** — not on `settlement_logs` (its `actor_id` is who *typed the row*), not on `orders` |
>
> ⛔ **Two of the four shapes cannot be authorized as written.** `team_id` is `use_scope` and required
> `> 0` on every settlement request; a report with one row PER team is by definition the thing the
> scope forbids. Either they are declared **admin screens** — ROOT/ADMIN in team 1, the bypass that
> already exists — or a `repeated team_id` becomes a **new authorization primitive**.
> → [settlement C5](business/settlement/context_clarify.md#critique)
>
> ⚠ **And the two docs describing this pipeline still do not cite each other.** Settlement says it
> *serves* these reports — [analytic/context.md](business/analytic/context.md) says a stream processor
> builds them, from the same three grains. **→ Settlement's own `GROUP BY` first**, on the precedent
> named below: `revenue_service` was the pipeline version of exactly this and lost to a plain
> aggregate over fact rows.
> → [settlement C6](business/settlement/context_clarify.md#critique) · [settlement Q5–Q7](business/settlement/context_clarify.md#question)
>
> ## Two rounds back
>
> **Analytic named its audiences, and a re-examination against the code found the precedent nobody
> had cited.** [business/analytic/context.md](business/analytic/context.md)'s `## Responsbility` went
> from *"Provide Analitical Data to user"* to **three named audiences** — Warehouse Team, Selling
> Team, Admin Team.
>
> | what it settles | what it opens |
> | --- | --- |
> | ✅ **half of #7.** *For whom* is answered — and answered better than it looks: all three are **`TeamType` values**, so the audience list is a **scope list**, which lands directly on the report table's grain | ⛔ *which numbers* is still unstated, so #7 stands · 🆕 **one order fact belongs to three of them at once** — `OrderPlacedEvent` carries the selling team, the fulfilling warehouse **and** a supplying team per line, against one `Report Table` box · 🆕 **"Admin Team" has no code path** — the scope bypass is by ROLE in team 1, not by `TEAM_TYPE_ADMIN` |
>
> ⛔ **The foundation is the least-built part of the system.** Of the four *"Source Truth Logs"* the
> ledger doc names and this design stands on, checked against the migrations: **one exists.**
> `settlement_logs` ✅ · `stock_movements` ⚠ close enough · **`expense_records` is not a log** — an
> entity table whose `ExpenseUpdate` rewrites **amount, kind and the month it belongs to** in place,
> publishing nothing · **purchasing has no service and no table at all**. So a folded bucket can go
> wrong twice — the month a cost left and the month it joined — with no message to tell anyone, and
> that is shipped behaviour *before* any pipeline exists.
> → [analytic C13/C14](business/analytic/context_clarify.md#critique)
>
> ⛔ **The finding that should change the argument: this repo already BUILT this design and DELETED
> it.** `revenue_service` was a push subscriber on `order-placed`/`order-cancelled` with its own
> report table and a daily rollup — six issues of work (#74, #75, #78, #153, #164, #171) — removed in
> `0d4cbc4`. Two details matter: it lost to the **actual** data (settlement, at order grain) rather
> than to a better pipeline, and its `RevenueDaily` was a **`GROUP BY` over the fact rows**, not a
> bucket table. The one daily report this repo shipped needed no incremental aggregation at all.
> → [the record](business/analytic/context_clarify.md#the-report-table-this-repo-already-deleted)
>
> ⚠ **A correction to this file's own last round.** It repeated the clarify's claim that *"nothing on
> that diagram has ever run"*. **Wrong** — [liability_service/push_handler.go](backend/services/liability_service/push_handler.go)
> consumes both order events and charges real ledger fees, so **push is the deployed mode** and the
> doc's "push *and* pull" really reads *"add pull"*. What genuinely does not exist: any **pull**
> subscriber, and any **broker** in the dev server (`event_sender.go` is a synchronous in-process
> loopback, so no retry, redelivery or dead-lettering is exercised anywhere). ⚠ Exactly the failure
> the header warns about, twice in three rounds: a claim carried forward without opening the file.
>
> ## Earlier rounds
>
> **The last unwritten context got a design — and it arrived from the far end.**
> [business/analytic/context.md](business/analytic/context.md) went from seven lines to forty, and all
> forty are architecture: Pub/Sub, push *and* pull, a stream processor, a report table. Its only
> statement of business is still line 8, *"Provide Analitical Data to user"*.
>
> | what it settles | what it opens |
> | --- | --- |
> | analytic is **no longer a blank page** — there is a concrete pipeline to argue with, authored by **Heri** for a lane that is **Toni's** ([analytic-sits-with-stock](business/project/member_decision.md#analytic-sits-with-stock)), with a second design invited for comparison | ⛔ **nobody has said which numbers, for whom** — so no part of the pipeline can be judged · the design **already exists at higher resolution** in [mutation_and_ledger `# Statistic Design.`](technical/ledger/mutation_and_ledger.md), and the two copies **already disagree** · `Source Truth Logs` is one box where [ledger/context.md](business/ledger/context.md) has four, in four services across **both** lanes |
>
> ⛔ **The contradiction is the load-bearing one.** `mutation_and_ledger.md` says statistic is
> *"streaming **and** reconcile every midnight + 1 hour"* — the analytic diagram has **no second path**.
> If reconcile is real the broker is an optimisation and a lost message is self-healing; if the diagram
> is right, the publish-after-commit hole ([mutation_and_ledger C5](technical/ledger/mutation_and_ledger_clarify.md#critique))
> becomes a permanently wrong report with nothing to detect it.
> → [analytic Contradiction](business/analytic/context_clarify.md#contradiction)
>
> ⚠ **It displaces the withdrawal question from the display** (was #7 — unchanged, still open, still
> counted below). The rule at the top is what did it: *"which numbers, for whom"* **stops a lifecycle
> pass** — analytic cannot enter `implementation_analysis` without it — where the withdrawal question
> blocks a reconciliation nothing has built yet and already has a recommended home.
>
> ✅ **Nothing on that diagram has ever run.** `san_event` has the receive half built (`Claim`,
> `Handled`/`Duplicate`/`Rejected`, rejection recording), but **no subscription consumes anything** —
> `inventory_service/push_handler.go` acks every message as a no-op. The pipeline is a proposal, not a
> thing to migrate off.
>
> ## Earlier still
>
> **A new file, and it asks a question of a different KIND: not what the system does, but who
> decides.** [business/project/member.md](business/project/member.md) is the first doc in the repo
> that names a person — Heri, Hendra, Toni — and assigns scope to two of the three.
>
> | what it settles | what it opens |
> | --- | --- |
> | **seven of the eight contexts and 10 of the 12 services** are now assigned — Heri holds 8 services (75 RPC / ~13.1k lines), Toni 2 (60 RPC / ~9.8k) plus two greenfield contexts — `stock`, `product`, `analytic` → Toni · `order`, `settlement`, `balance`, `user` → Heri ([products-follow-the-unit-price](business/project/member_decision.md#products-follow-the-unit-price) · [analytic-sits-with-stock](business/project/member_decision.md#analytic-sits-with-stock) · [identity-sits-with-order](business/project/member_decision.md#identity-sits-with-order)). Hendra is on legacy and **joins later**, so there are **two deciders, not three** ([hendra-joins-later](business/project/member_decision.md#hendra-joins-later)) · the four support services → Heri ([support-services-sit-with-order](business/project/member_decision.md#support-services-sit-with-order)) | ⛔ **`ledger` is the last unowned one** — four producers publish events into it across both lanes, one reader out of it, and **7 of the questions below** sit inside it · no boundary between the two lanes has an owner either · and with two deciders a disagreement has no majority |
>
> ⚠ **The absent member makes it worse, not smaller.** `ledger` cannot be parked on someone who has
> not arrived — a reserved scope and an unowned one are identical for every question asked in
> between — so it needs an owner among the two people here. 🔄 **→ Toni**, reversing this file's
> previous answer: the ledger is a **Pub/Sub subscriber** with four producers spanning both lanes,
> so no producer waits on it and none of them is picked out as its owner — while its **only reader,
> `analytic`, is Toni's**. ⚠ Whoever takes it inherits *purchasing*, a first-class producer in the
> owner's own diagram with **no service and no context doc**
> ([ledger C5](business/ledger/context_clarify.md#critique)).
>
> ✅ **Concurrency is not the constraint.** Exactly **one** in-process import crosses the two lanes
> (`inventory_service` → `liability_service`); everything else crosses over the proto contract. What
> two people actually collide over is generated files and registry lists, all mechanical
> ([member_clarify.md](business/project/member_clarify.md#working-concurrently--the-split-is-fine-the-shared-files-are-the-problem)).
>
> ⚠ **It does not displace a row, and the reason is worth writing down.** Every question below is
> still answerable today, because one person still answers everything — so nothing is *blocked* by
> the routing being unwritten. **The moment three people answer, this becomes #1-shaped**: 16
> `_clarify.md` files address *"the owner"*, and `CLAUDE.md` merges to `main` *"when the owner
> asks"*. Both are now ambiguous in a way no single file can resolve.
> → [member_clarify.md](business/project/member_clarify.md#question)
>
> ## Earlier than that
>
> **Three questions answered, and a re-examination that re-ordered the list.** The owner asked which
> open questions blocked the FRONTEND analysis, was given the triage, and answered all three.
>
> | the question | the answer | |
> | --- | --- | --- |
> | *Summarize All Balance* — screen or tiles? | **the tiles** | [the-summary-is-tiles-on-the-list](technical/balance/team_balance_design_decision.md#the-summary-is-tiles-on-the-list) |
> | where is the DEFAULT terms row edited? | **a dialog on the list** ⚠ against recommendation | [the-default-terms-row-is-a-dialog-on-the-list](technical/balance/team_balance_design_decision.md#the-default-terms-row-is-a-dialog-on-the-list) |
> | does `found` need the owner's acknowledgement? | **no** ⚠ against recommendation | [found-posts-without-a-handshake](business/balance/context_decision.md#found-posts-without-a-handshake) |
>
> ⛔ **One of them moved weight rather than removing it, and it landed at #3.** Refusing `found` a
> handshake makes **dispute** a team's only recourse against a charge asserted in the asserter's
> favour — and dispute does not exist.
>
> ### ⚠ The re-examination finding: this file was ranking questions the CODE had already answered
>
> Four of the seven rows were checked against the source rather than against the docs, and four had
> moved without the file noticing:
>
> | was ranked as | actually |
> | --- | --- |
> | the ledger vocabulary migration, #3 | ⛔ **not a question at all** — migration `00005` shipped the vocabulary, `actor_id` and `liability_logs`. Removed |
> | *freight divides by the EXPECTED quantity*, half of #1 | ✅ **already correct in code** — [restock_request_fulfill.go:210](backend/services/inventory_service/inventory_v1/restock_request_fulfill.go#L210) divides by what arrived. The owner's DIAGRAM draws it the other way, so the question is about the diagram |
> | *what moment consumes a FIFO layer*, #4 | ⚠ **built the way this file recommended**, unratified. Demoted to #7 as a ratification |
> | *where is the DEFAULT row edited*, #7 | ✅ answered this round |
>
> **The cause is named in [the balance state report](development_state/balance/context.md): contexts here
> were built before they were designed.** A rollup derived from `_clarify.md` alone inherits that — it
> cannot see that the code has taken a position, so a settled question keeps its rank. ⚠ **Code taking
> a position is NOT the owner deciding one** (HARD RULE 8), so none of these is closed by being built.
> But *"nobody has decided and nothing is written"* and *"it is running, please ratify it"* are
> different sizes of open, and only the first belongs near the top.
>
> **→ Every rebuild from here checks the top rows against the code**, not only against the clarify files.
>
> ## Live and not a question
>
> ✅ ~~**Nothing below the contract is verified.**~~ **Stale — removed.** This said migrations had
> never run and every DB-backed test skipped. It has been overtaken: the balance pass records unit,
> integration and e2e green together for the first time
> ([balance state](development_state/balance/context.md)), and `6ae4d55` (2026-08-31) is *"the e2e
> suite is green"*. ⚠ Exactly the failure this file's own header warns about — a claim carried
> forward without being checked against the code.
>
> ⚠ **"Summarize All Balance" is computed over ONE PAGE, and the answer made that binding.** Three of
> the four tiles on `/liability` reduce the loaded 20 rows, so a creditor with 21 counterparties reads
> a headline that omits one — and now the summary is fixed as tiles on a **paginated** list, it can
> never run a whole-set query of its own. The fourth tile, *awaiting confirmation*, already comes from
> the server and is the precedent for the other three
> ([technical balance C16](technical/balance/team_balance_design_clarify.md#critique)).
>
> ⛔ **The 80% warning has TWO homes named in §About Thresholds 1 and is in NEITHER.** One of them, the
> daily report, is parked ([the-daily-report-is-deferred](business/balance/context_decision.md#the-daily-report-is-deferred))
> — and it was the DEBTOR's view, so what survives warns the person who is fine rather than the person
> about to stop trading ([technical balance Q9](technical/balance/team_balance_design_clarify.md#question)).

---

| # | The question | Blocks | Asked in | My recommendation |
| --- | --- | --- | --- | --- |
| **1** | **What happens when one order half-succeeds across six services?** ⬆ **was #2, and it is #1 now because nothing has touched it** — several rows that outranked it turned out to be positions the code had already taken. ⚠ **A correction to this row, found by opening the file this round.** It said settlement *sits on the critical path of order creation*. It does not — **the call was never built**: nothing in `selling_service` imports `settlement_v1`, so no order opens an account, and [order-service-calls-settlement](business/settlement/context_decision.md#order-service-calls-settlement) is a decision awaiting an implementer rather than a live failure mode. What IS live next door is the opposite position, already shipped: [order_place.go:285](backend/services/selling_service/selling_v1/order_place.go#L285) publishes `OrderPlacedEvent` fire-and-forget under *"A publish failure does NOT fail the order"*. So settlement's own *"what does a FAILED call do to the order?"* is now a question about which of two shipped conventions the new seam follows. ⚠ There is no outbox, no saga and no compensation anywhere in the repo — and the one cross-service write that IS shipped (that event) is unretried, so a lost publish is a permanently missing fee with only a log line to say so. | every cross-service write in the system | [architecture Q2](technical/architecture/context_clarify.md#question) · [settlement Q1](business/settlement/context_clarify.md#question) | **It exists completely or not at all** — draw, gate, commit, release on failure. For settlement specifically: **the order still commits**, with a visible *"account not opened"* state, because a missing account is repairable where a lost order is not. |
| **2** | **🆕 Does a REPLAY double the reports — and does a failed fold lose the movement?** ⛔ **Two corruptions produced by answers that were each individually right**, found by re-reading the fold after it gained an idempotency layer. **(a)** Dedup is keyed on the broker's **message id**, which correctly leaves `AnalyticReplayCompute` un-deduped — it republishes under new ids. But the fold **increments** (`fund += @change`), so replaying a range that was already folded **adds every movement in it a second time**, and the RPC exists *"when error happen and root need to recompute"* — the moment it is reached for is the moment the rows already hold numbers. **(b)** The dedup row is written **before** the compute: *"1. insert to `settlement_event_logs`. 2. when it fails its mean event already processed."* If that insert commits and the compute then fails, the 500 makes Pub/Sub redeliver, the redelivery hits a row saying *already processed*, ACKs — and the money is never folded, with the log holding the row, the report not, and nothing disagreeing. ⚠ **The fix to (b) has a Postgres detail that decides its shape:** a raw PK violation **aborts the whole transaction**, so "insert, catch the error, carry on" cannot work inside the transaction that also computes. | ⛔ every number on both daily report tables — (a) silently doubles them, (b) silently omits from them, and neither has a counter that would notice | [analytic Q1](business/settlement/analytic_context_clarify.md#question) · [analytic Q2](business/settlement/analytic_context_clarify.md#question) | **Make the fold RECOMPUTE the day rather than increment it** — then replay, redelivery and reorder are the same harmless operation, and the dedup table becomes an optimisation instead of a correctness control. That is the same *event-is-a-doorbell* move #7 argues for the pattern generally, and settlement is now its first concrete instance. If the increment stays: replay must **zero the affected rows in the same transaction** before it starts, and the doc must say so. For (b): **one transaction, `INSERT … ON CONFLICT DO NOTHING`, duplicate = 0 rows affected.** |
| **3** | **🆕 Where is the order's creator PERSISTED?** ⚠ **Half-answered this round, and the surviving half is the durable one.** `### Events.` now carries `order_created_by_user_id`, which answers where the live fold gets it — that was the blocker, and it is closed. ⛔ What is left: it is on **no table**. Not `settlement_logs`, not `order_settlements`, and [`orders`](backend/services/selling_service/selling_service_models/order.go) has no creator column at all (`AuthorUserID` lives on `order_drafts`, so an order placed without a draft has none). `AnalyticReplayCompute` replays the **log**, and the log does not carry this field — so `user_settlement_daily_reports` can be folded live and **never rebuilt**. ⚠ It also puts the burden on every writer forever: `export_service` posting a `fund` must know who created the order, and `SettlementPostRequest` has no such field. | one of the two daily report tables cannot be rebuilt, ever — and a report you cannot rebuild is one you cannot correct after a fold bug | [analytic Q3](business/settlement/analytic_context_clarify.md#question) · [settlement Q5](business/settlement/context_clarify.md#question) | **`order_settlements.creator_user_id`, stamped once by the opening row** — set at the account's first entry, read by the fold from the state table (one service, HARD RULE 3 clean), durable so a replay is right years later. The event may still carry it; it just stops being the only copy. ⚠ **`selling_service` must record an author on the order first** — two migrations in two lanes. ⚠ And say what happens to money with no creator: an account opened by an exporter's `fund` before any `initial_total` has none, so the report needs an explicit **unattributed** bucket or its columns will silently fail to sum to the shop report. |
| **4** | **🆕 Who is allowed to POST an event webhook?** ⛔ **Not a settlement question — a hole in the shared package every future consumer inherits.** `analytic_context.md` specifies `/event/[sub_id]/push` as the path the broker calls to drive report calculation. [push.go:41](backend/pkgs/event_source/push.go#L41) reads the body, JSON-decodes it, and calls the handler: **no token, no signature, no origin check, nothing.** The system's entire ACL lives in the proto and is read by an interceptor off a Connect *request message* — **a webhook is not one**, so `request_policy` and `use_scope` do not apply and cannot be made to. Anyone who can reach the port POSTs a JSON body and moves a shop's reported balance, with `actor_id` reading as whatever they typed. ⚠ `sub_id` being unguessable is not a control: it is a URL, and it lives in logs, proxy access records and this doc. ⚠ Today the dev server uses an in-process loopback so nothing is exposed — which is exactly why this is cheap to fix now and expensive after the first real subscription. | ⛔ every event consumer in the system, present and future — the one write path the proto-based ACL does not cover | [analytic Q3](business/settlement/analytic_context_clarify.md#question) · [architecture Q2](technical/architecture/context_clarify.md#question) | **Verify Pub/Sub's OIDC token inside `event_source` before the body is decoded** — Google signs a JWT with the push subscription's service account; check issuer, audience and service-account email, and reject otherwise. ~30 lines in one shared package, and every consumer gets it without knowing. ⚠ **Write it into the doc too**, because "the ACL covers everything" is currently true of RPCs and false of this seam, and nothing says so. |
| **5** | **Does the courier's TIP belong inside the frozen unit cost?** ⚠ **HALVED by re-examination, and the surviving half is verified in code.** This row used to merge a denominator defect and a numerator one. **(a) The denominator is already right** — [restock_request_fulfill.go:210](backend/services/inventory_service/inventory_v1/restock_request_fulfill.go#L210) divides by `sellableTotal`, what actually arrived with damaged units excluded, and the line cost by `line.quantity`, the received one. The owner's flow diagram draws it the other way round, so [stock Q1](business/stock/context_clarify.md#question) is a question about the DIAGRAM, not a live defect. **(b) The numerator stands** — `freight := rr.ShippingCost + costLineTotal`, under the comment *"EVERY OUTLAY IS FREIGHT"*, capitalises the incidental fee that `balance_context.md` defines as a courier's *"coffe tip"* into a cost frozen for the life of the batch. ⚠ **And it compounds with a decision taken this round**: a breakage reimbursement pays at COGS, so the warehouse is repaid a tip it charged, and [found-posts-without-a-handshake](business/balance/context_decision.md#found-posts-without-a-handshake) lets it reverse that reimbursement unilaterally. | every batch's frozen unit cost — and therefore COGS, margin, the cross-charge (COGS × markup) and breakage payouts, for the life of the batch | [product Q6](business/product/context_clarify.md#question) · [stock Q1](business/stock/context_clarify.md#question) | **Take the tip OUT, leave `ShipmentFee` in** — freight is agreed before the journey and is genuinely part of what the goods cost; an unpredictable ask at the door is not. One line — `freight := rr.ShippingCost` — with `costLineTotal` still posting to the balance. ⚠ Note `freightPerUnit` is integer division and **floors**, so a small tip contributes **0 per unit** while being charged in full on the balance: it is already unreliable at exactly the sizes it is described as being. |
| **6** | **🆕 Which markup does the LEDGER charge from?** ⛔ **A live billing discrepancy, found while acting on an owner decision.** The cross-product markup is stored TWICE and nothing keeps the copies equal: `products.cross_markup_bps` is what the product detail QUOTES a borrowing team, and `liability_terms.product_markup_bp` is what [`order_fees.go:144`](backend/services/liability_service/liability_v1/order_fees.go) actually CHARGES it. Set one to 20% and leave the other at 5% and the quote and the invoice disagree — in whichever direction was edited last, silently, with neither screen able to see the other. ✅ The OWNERSHIP is settled: the rate is `product_service`'s ([the-cross-markup-belongs-to-the-product](business/balance/context_decision.md#the-cross-markup-belongs-to-the-product)), and the balance screens no longer show it. What is open is only which number the posting reads. | every cross-sold order's fee — the amount a team is quoted versus the amount it is billed | [technical balance Q10](technical/balance/team_balance_design_clarify.md#question) · [Contradiction](business/balance/context_clarify.md#two-markups-exist-and-the-screen-and-the-ledger-read-different-ones) | **`order_fees.go` reads the PRODUCT's rate when it freezes the fee, and `liability_terms.product_markup_bp` is dropped in the same migration.** Balance is then told the amount rather than asked to compute the rate — already true of every other cause. ⚠ **Three things land together or the fee breaks**: the read moves, the column goes, and the frontend's pass-through bridge is deleted. |
| **7** | **Is the analytic PATTERN robust — and do its 14 rules hold?** 🔄 **Reshaped by a decision about ORDER OF WORK.** The owner settled it: *"we decide later what service follow this, for now make this principle robust first"* ([the-pattern-comes-before-its-consumers](business/analytic/context_decision.md#the-pattern-comes-before-its-consumers)), on top of `## Responsbility` becoming **"Provide Analytical Design Pattern"** ([analytic-is-a-pattern-not-a-data-product](business/analytic/context_decision.md#analytic-is-a-pattern-not-a-data-product)). ✅ **Three questions closed across two rounds** — *which numbers, for whom* · *is "Admin Team" team 1* (re-routed to [settlement C5](business/settlement/context_clarify.md#critique)) · *which consumer proves it* (deferred). ⛔ **What is left is the contract itself, and it is now written rather than requested** — 14 rules, each checked against a table that exists. ⚠ **Three already fail:** `expense_records` breaks append-only (`ExpenseUpdate` rewrites amount, kind and month in place) and the immutable-bucket-date rule, and **no source anywhere has a cursor-paged `LogRead`** — the pattern's one real build cost. ⛔ And the doc still names three report tables (team, shop, **supplier**) against a stated responsibility of *a pattern*, with its likeliest consumer needing **user** and having no supplier column at all. 🆕 **And the doc gained its rationale this round** — `### Why We Need Analytical Design Pattern.`, *"separate the operational domain from the analytical domain"*. It is right and one level too abstract to choose a design with: separation has four strengths, and the section leans on the cheap ones (load — a read replica fixes that) while omitting the only one that makes the pattern **necessary rather than preferred** — **HARD RULE 3 forbids a cross-service join, so a report spanning services cannot be a query.** ⛔ It is also now the strongest argument against two things already drawn: `Preload If Needed` re-couples the domains it separates, and a *pattern* naming a `supplier` table has absorbed one consumer's vocabulary. ⚠ And it opens a structural question — **is `analytic` a LIBRARY or a SERVICE?** | ⏸ nothing is blocked *today* — the deferral was deliberate. ⚠ **But an unimplemented pattern is unfalsifiable**, and settlement has already written *"follow this"* into its own doc | [analytic Q1](business/analytic/context_clarify.md#question) · [analytic Q2](business/analytic/context_clarify.md#question) · [analytic Q3](business/analytic/context_clarify.md#question) | **Ratify or correct the contract** — [what-the-pattern-owes-an-implementer](business/analytic/context_clarify.md#what-the-pattern-owes-an-implementer). Its load-bearing move is that **the event is a DOORBELL, not a delivery**: two paths over one fold — a best-effort fast path, a convergent tick, and a claim keyed on the source row so they overlap safely. That is the reconcile pass [mutation_and_ledger.md](technical/ledger/mutation_and_ledger.md) already promises, it makes the broker **optional to correctness**, and it retires the thin-vs-fat event argument outright. **Then: a measure set is a TABLE, a dimension is a KEY, and only `day` is stored** — [a-grain-is-a-key-a-measure-set-is-a-table](business/analytic/context_clarify.md#a-grain-is-a-key-a-measure-set-is-a-table). The diagram split on the wrong axis: team and shop are two dimensions of one measure set, supplier is a different measure set in `inventory_service`. For settlement that is **one** table and **one** fold instead of three-to-twelve, and adding `user` is a value rather than a migration. ⚠ One rule it exposes is per-SOURCE, not per-pattern: *team = Σ shops* holds for `settlement_logs` and **fails** for `expense_records` (`shop_id` `0 = not attributed`), so the pattern must make an implementer state it rather than assume it. **Split library from service by one rule**: a report reading ONE service's log is that service's own, folded in-process with a shared library (`settlement_daily` belongs to `settlement_service`, HARD RULE 3 clean) — a report reading SEVERAL needs an owner, and that is what an analytic service is for. Seven of the nine known questions are single-source, so the library carries most of the value. ⚠ **This revises my own earlier recommendation** of one analytic service for everything. And `Preload If Needed` is renamed or removed — it is the one box that invites a fold to read mutable state, which makes a rebuild disagree with the live run and nothing detects it. |

**⤵ Demoted, unanswered — pushed off by newer rows, none of them closed:** **can a team CONTEST a
charge posted on its books, and does a charge ever become final?**
[found-posts-without-a-handshake](business/balance/context_decision.md#found-posts-without-a-handshake)
refused cause 5 an acknowledgement, so a warehouse posts *"found it"* and the owning team's balance moves
the same instant, with no consent, no notice and no dispute path — while the resulting balance refuses
that team's next order ([balance Q5](business/balance/context_clarify.md#question) ·
[balance Q6](business/balance/context_clarify.md#question)). Recommendation stands: **a disputable window
on the ENTRY, agreed by silence after N days**, built with `reverses_group_id`. ·
**which PRE-CHECKS does a draft run** (the ledger half is settled at finalize; what a *draft* checks

**which PRE-CHECKS does a draft run** (the ledger half is settled at finalize; what a *draft* checks is
not — [order Q4](business/order/context_clarify.md#question); recommendation stands: **none of it at
draft**, so finalize must re-check and may refuse) · **can one ORDER's true result be read anywhere**
(marketplace money is settlement's at order grain, the `order_fee` is balance's at pair grain, and
`LiabilityLogListFilter` takes `counterparty_id` and nothing else —
[balance Q9](business/balance/context_clarify.md#question); recommendation stands: **one `order_id`
filter**, never a second copy of the fee).

**⤵ Off the display, unchanged:** **where does a platform WITHDRAWAL live?** Wallet to bank, naming no
order — so it is none of settlement's seven types, and
[every-entry-names-an-order](business/settlement/context_decision.md#every-entry-names-an-order) made
`order_id NOT NULL`, which forbids the obvious workaround. Asked in two docs
([architecture Q7](technical/architecture/context_clarify.md#question) ·
[settlement Q3](business/settlement/context_clarify.md#question)). **→ Answer it once, in the
architecture clarify, and have settlement follow — `order_service`**, because the wallet is fed by that
shop's orders and the withdrawal is reconciled against them.

## Where the other 103 are

Every file's full open count — the seven above are drawn from these, not additional to them.

| File | Open | |
| --- | ---: | --- |
| [business/order/context_clarify.md](business/order/context_clarify.md#question) | 13 | |
| [technical/architecture/context_clarify.md](technical/architecture/context_clarify.md#question) | 11 | |
| [business/balance/context_clarify.md](business/balance/context_clarify.md#question) | 8 | ▼ was 9 — `found` needs no handshake |
| [business/stock/context_clarify.md](business/stock/context_clarify.md#question) | 7 | |
| [business/ledger/context_clarify.md](business/ledger/context_clarify.md#question) | 7 | |
| [technical/balance/team_balance_design_clarify.md](technical/balance/team_balance_design_clarify.md#question) | 6 | ▲ which markup does the ledger charge from |
| [business/product/context_clarify.md](business/product/context_clarify.md#question) | 6 | |
| [business/business_level_clarify.md](business/business_level_clarify.md#question) | 6 | |
| [business/user/context_clarify.md](business/user/context_clarify.md#question) | 5 | |
| [business/analytic/context_clarify.md](business/analytic/context_clarify.md#question) | 8 | ▲ the `### Why` section landed — it argues the pattern's case but names the wrong coupling, and it opens a structural one: is `analytic` a LIBRARY or a SERVICE |
| [technical/stock/design_clarify.md](technical/stock/design_clarify.md#question) | 4 | 🆕 counted for the first time |
| [business/project/member_clarify.md](business/project/member_clarify.md#question) | 5 | 🆕 who DECIDES, rather than what the system does. ▼ progress reporting is settled |
| [technical/development/workflow_clarify.md](technical/development/workflow_clarify.md#question) | 4 | |
| [business/settlement/context_clarify.md](business/settlement/context_clarify.md#question) | 5 | ▼ was 9 — the reports left this doc, and four questions went with them. What stays is the ledger, the order seam and `InitOpeningBalance` |
| [business/settlement/analytic_context_clarify.md](business/settlement/analytic_context_clarify.md#question) | 5 | 🆕 the fold now has an idempotency layer and a maintenance lock — and the pair of "dedup on message id" + "increment the row" makes a replay double every number |
| [business/settlement/meta_context_clarify.md](business/settlement/meta_context_clarify.md#question) | 1 | 🆕 `settlement_service_metadata` — `analytic_status` is gone, `process_event_lock` replaced it — is this table CONFIG (human-set) or STATE (service-set)? |
| [technical/ledger/mutation_and_ledger_clarify.md](technical/ledger/mutation_and_ledger_clarify.md#question) | 3 | 🆕 counted for the first time |
| [technical/event/library_clarify.md](technical/event/library_clarify.md#question) | 2 | 🆕 counted for the first time |
| [technical/cost/design_clarify.md](technical/cost/design_clarify.md#question) | 2 | 🆕 counted for the first time |
| [business/product/systems_clarify.md](business/product/systems_clarify.md#question) | 1 | |

> **Counted from each file's Question section, at either heading level.** Previous rebuilds matched
> `## Question` only, and five technical clarifies write theirs as `# Question` — so **17 open
> questions were silently excluded**, all six of technical balance's among them. ⚠ **Worth fixing at
> the source:** one heading level across every clarify makes this count mechanical instead of a
> judgement call.
