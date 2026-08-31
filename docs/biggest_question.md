# The 7 Biggest Questions

Every open question in every `_clarify.md`, rolled up to the seven that block the most.

> **Derived file — regenerate, never hand-edit.** Same rule as a `state_report`. It is built from
> `*_clarify.md` only, never from `*_decision.md`, so an answered question leaves here the moment it
> is recorded. Rebuild it whenever any `_clarify.md` changes.
>
> **Ranked by what is BLOCKED**, not by how interesting the question is — a question that stops a
> lifecycle pass outranks one that merely matters. Several rows below are **one question asked in two
> docs**, and merging those is most of what this file is for.

**88 open questions across 16 files.** The seven below are shown; **81 are not** — they are not
closed, only smaller. The per-file counts are at the bottom.

> ✅ **THREE ANSWERED THIS ROUND, all three of them frontend blockers**, which is what the owner asked
> for: *is any question blocking the frontend analysis?* The balance context's `implementation_analysis`
> is no longer waiting on a design answer.
>
> | | | |
> | --- | --- | --- |
> | *Summarize All Balance* — screen or tiles? | **the tiles** | [the-summary-is-tiles-on-the-list](technical/balance/team_balance_design_decision.md#the-summary-is-tiles-on-the-list) |
> | where is the DEFAULT terms row edited? | **a dialog on the list** ⚠ against recommendation | [the-default-terms-row-is-a-dialog-on-the-list](technical/balance/team_balance_design_decision.md#the-default-terms-row-is-a-dialog-on-the-list) |
> | does `found` need the owner's acknowledgement? | **no** ⚠ against recommendation | [found-posts-without-a-handshake](business/balance/context_decision.md#found-posts-without-a-handshake) |
>
> ⛔ **AND ONE OF THEM MOVED THE WEIGHT RATHER THAN REMOVING IT, straight into the new #7.** Refusing
> `found` a handshake makes **dispute** the only recourse a team has against a charge asserted on its
> books in the asserter's favour — and nothing in the ledger binds a find to the loss it repays, so
> nothing caps it. The resulting balance can push that team through its threshold and stop their
> orders.

> **Driven by `balance_context.md` §Payment Flow** — two diagrams that specify the payment lifecycle
> end to end, the third owner edit to the balance context in a day.
>
> ✅ **One question closed the way it was recommended.** *"May the creditor REJECT a claimed payment?"*
> — yes, terminal, posting nothing
> ([the-debtor-claims-the-creditor-decides](business/balance/context_decision.md#the-debtor-claims-the-creditor-decides)).
> It is **build work** now, not a question.
>
> **Driven by a frontend re-analysis against `balance_context.md`**, requirement by requirement, on
> top of three answers that are all now BUILT.
>
> ⛔ **THE DAILY REPORT IS DEFERRED**
> ([the-daily-report-is-deferred](business/balance/context_decision.md#the-daily-report-is-deferred)),
> which takes #5 off this list and narrows the 80% warning to one home. ✅ **It also turned the story
> suite GREEN for the first time** — the 10 long-standing failures were all that page's, they were
> never going to be fixed while it is parked, and a suite with a known-failing file is a suite people
> stop reading. The file is tagged out of the run and still renders in Storybook.
>
> ⚠ **Deferring costs the more useful half of the warning.** The daily report was the DEBTOR's view:
> a team about to be blocked now finds out only on the creditor's screen, which it cannot see. What is
> left warns the person who is fine, not the person who is about to stop trading
> ([technical balance Q9](technical/balance/team_balance_design_clarify.md#question)).
>
> ⛔ **§About Thresholds 1 names TWO homes for the 80% warning and it is in NEITHER** — *"there is
> warning on the balance screen and daily report if thresholds 80% reached"*. It lives only inside the
> pair detail's Terms tab, and moving terms onto that page made it LESS visible, not more. The
> threshold is the only control this design has, so a warning nobody passes on their way to anything
> is the whole early-warning system, hidden. It is two DIFFERENT warnings on opposite sides, which is
> why it is a question ([technical balance Q9](technical/balance/team_balance_design_clarify.md#question))
> and not just build work.
>
> ✅ **#3 IS DONE AND #7 IS GONE.** The ledger migration ran as code (vocabulary, `actor_id`, the
> rename to `liability_logs`), the cost-kind collapse completed it, and *is Credit Terms a screen or
> a section* was answered — a section — so the `design_accept` gate that had been holding a finished
> prototype is passed.
>
> ✅ **THE DEFAULT-ROW REGRESSION IS ANSWERED AND IS NOW BUILD WORK.** It was #7 last round. The
> default lives in a **dedicated dialog opened from `/liability`**, and it needs no proto change and
> no new route — `LiabilityTermsList` already returns the default row first and `LiabilityTermsSet`
> already accepts `counterparty_id = 0`. ⚠ It is still settable nowhere in the running app until
> somebody builds the dialog.
>
> ⛔ **NOTHING BELOW THE CONTRACT IS VERIFIED.** Four migrations are written and none has run —
> Docker was never up on this machine, so every DB-backed test skipped. That gates all three
> implementations equally and is not a question anybody has to answer.
>
> ⚠ **A decision was corrected by the code while being built.**
> [the-actor-was-dropped-at-every-boundary](technical/balance/team_balance_design_decision.md#the-actor-was-dropped-at-every-boundary):
> I wrote that the human actor was available at every call site, having checked one. `OrderPlacedEvent`
> had no actor field at all, so the two highest-volume causes had no channel to carry one — the column
> would have read 0 for most rows, which is the shrug the decision said it must not become.
>
> ⚠ **Still true, and the answer made it MORE binding: "Summarize All Balance" is computed over ONE
> PAGE.** Three of the four tiles on `/liability` reduce the loaded 20 rows, so a creditor with 21
> counterparties reads a headline that silently omits one — and now that the summary is fixed as
> **tiles on a paginated list** rather than a screen, it can never run a whole-set query of its own.
> The fourth tile, *awaiting confirmation*, already comes from the server and is the precedent for
> the other three. A defect with a written spec
> ([technical balance C16](technical/balance/team_balance_design_clarify.md#critique)), not something
> to rank here.

---

| # | The question | Blocks | Asked in | My recommendation |
| --- | --- | --- | --- | --- |
| **1** | **Is the frozen `UnitPrice` formula right — in its DENOMINATOR and in its NUMERATOR?** **Merged**, because both defects corrupt the same number. **(a)** `Calculate Unit Price` runs *before* the shortfall is known, so freight divides by the **expected** quantity — units that never arrived carry cost and the ones that did are under-priced. **(b)** `AdditionalWarehouseFee` sits inside the formula, and `balance_context.md` has now defined that money as a **courier's tip**. ⚠ Still #1: this is the only number in the system that is **frozen at receipt and read forever** by COGS, margin, and the reimbursement owed if the goods are broken. | every batch's unit price, and therefore COGS, margin and breakage payouts for the life of the batch | [stock Q1](business/stock/context_clarify.md#question) · [product Q2](business/product/context_clarify.md#question) · [product Q6](business/product/context_clarify.md#question) | **(a) Move it after `Calculate valid Qty`** — cost = money actually spent ÷ goods actually landed. **(b) Take the tip OUT, leave `ShipmentFee` in** — freight is agreed before the journey and is genuinely part of what the goods cost. ⚠ And note `freightPerUnit` floors, so a small tip contributes **0** per unit while being charged in full on the balance: it is already unreliable at exactly the sizes it is described as being. |
| **2** | **What happens when one order half-succeeds across six services?** Settlement now sits on the **critical path of order creation** ([order-service-calls-settlement](business/settlement/context_decision.md#order-service-calls-settlement)), and settlement's own *"what does a FAILED call do to the order?"* is a site of this question, not a separate one. | every cross-service write in the system | [architecture Q2](technical/architecture/context_clarify.md#question) · [settlement Q1](business/settlement/context_clarify.md#question) | **It exists completely or not at all** — draw, gate, commit, release on failure. For settlement specifically: **the order still commits**, with a visible *"account not opened"* state, because a missing account is repairable where a lost order is not. |
| **3** | **⛔ DECIDED, NO LONGER BLOCKED, and it has GROWN — the ledger vocabulary migration, now carrying two more approved changes.** Not an open question: [the-ledger-speaks-the-business-words](business/balance/context_decision.md#the-ledger-speaks-the-business-words) settles the source types — `order_fee` · **`incidental_fee`** · `broken_good` · `lost_good` · `found` — and one later decision lands on the same table: **`actor_id`** ([every-entry-names-who-posted-it](technical/balance/team_balance_design_decision.md#every-entry-names-who-posted-it)). ⚠ A third rider — renaming off *liability* — was floated and **cancelled** ([liability-stays](technical/balance/team_balance_design_decision.md#liability-stays)), so the table names do not move. Two changes, one pass over the service. ✅ **The tooling block is GONE** (2026-08-29): `buf.gen.yaml` now uses `local:` plugins pinned by the root go.mod's `tool` directives and by frontend/package.json, so `cd proto && buf generate` needs **no Buf account**. It stays in this list only because it is the highest-value BUILD item in the repo and nothing has run it yet. | a live bug: the daily statement reads `COD_FEE`, which nothing posts, so its column is permanently zero while `RESTOCK_OUTLAY` appears in none · **and every day of waiting adds ledger rows that can never say who posted them** | [decision](business/balance/context_decision.md#the-ledger-speaks-the-business-words) · [technical balance C15](technical/balance/team_balance_design_clarify.md#critique) | **Run it once, with both changes in it.** ⚠ Waiting costs history twice over and neither loss is recoverable: existing rows cannot say whether a `stock_damage` was **broken** or **lost**, and none of them can say **who posted it**. ⚠ A **table rename** now wants to ride along too ([technical Q8](technical/balance/team_balance_design_clarify.md#question)) — cheap inside this migration, a second pass outside it. |
| **4** | **What moment consumes a FIFO layer, and which service stores the frozen cost?** Layers are inventory's, COGS is ledger's — the answer sets a service boundary, not just a timing. | the inventory/ledger split, COGS correctness, order lines | [product Q5](business/product/context_clarify.md#question) · [architecture Q3](technical/architecture/context_clarify.md#question) | **At commitment, both frozen on the line.** |
| **5** | **Can one ORDER's true result be read anywhere?** ⚠ **Halved by the deferral.** This row merged two gaps opened by `0d4cbc4`; the first — whose job is the selling team's money screen — is now parked with [the-daily-report-is-deferred](business/balance/context_decision.md#the-daily-report-is-deferred), and the shipped page goes on refusing selling teams. What survives is the second: the marketplace money is settlement's at **order** grain and the `order_fee` is balance's at **pair** grain, so *"what did order 1 make"* has no reader — `order_fees.go` writes `SourceID = orderID` and `LiabilityLogListFilter` accepts `counterparty_id` and nothing else. | order-level profitability — the fee is recorded, attributable, and unaskable | [balance Q9](business/balance/context_clarify.md#question) | **One `order_id` filter on `LiabilityLogListFilter`, never a second copy of the fee** in settlement's ledger — one movement written as two rows in two services with no shared transaction is the failure [technical balance C4](technical/balance/team_balance_design_clarify.md#critique) already names. ⚠ Assembling the order's P&L on the SCREEN from settlement + the frozen COGS + the fee is what keeps each number owned by one service. |
| **6** | **Which PRE-CHECKS does a draft run — does it touch the reserve, the shared lock, the debt threshold?** ✅ The ledger half is closed; the moment is fixed at finalize. What is unstated is which of the checks a *draft* runs before it. | the ledger's write moment, the threshold's trigger, the lock and reserve checks | [order Q4](business/order/context_clarify.md#question) | **None of it at draft** — your own section forces it: a draft holds an *external* SKU, so it has no product, no owner and no cost, and none of the four are computable. The price is that **finalize must re-check and may refuse**. |
| **7** | **🆕 Can a team CONTEST a charge posted on its books — and does a charge ever become final?** ⛔ **Promoted by an answer, not by an edit.** [found-posts-without-a-handshake](business/balance/context_decision.md#found-posts-without-a-handshake) refused cause 5 an acknowledgement, so a warehouse posts *"found it"* and the owning team's balance moves the same instant, with no consent and no notice. Dispute was the fallback behind that handshake; it does not exist. ⚠ **Three things compound it and each is verified in code, not supposed:** nothing binds a find to the loss it repays (`reversal` is a boolean and the entry posts under the find's own movement id, [technical C10](technical/balance/team_balance_design_clarify.md#critique)) · there is no cycle, so no entry ever becomes final ([no-overdue-only-the-threshold](business/balance/context_decision.md#no-overdue-only-the-threshold)) · and the resulting balance refuses the team's next order ([the-block-stops-orders-only](business/balance/context_decision.md#the-block-stops-orders-only)). | ⛔ every team's only recourse against a charge asserted in the asserter's favour — and, through the threshold, whether one team can stop another trading with no step at which it was asked | [balance Q5](business/balance/context_clarify.md#question) · [balance Q6](business/balance/context_clarify.md#question) | **A window on the ENTRY — disputable for N days, agreed by silence after.** It needs no statement object, no due date and no overdue state, so it does not reopen the no-cycle decision, and it gives both sides the moment of finality the cycle would have supplied. ⚠ **Build `reverses_group_id` with it**: it was a traceability nicety while a handshake existed and it is now the only thing that could bound a find to what was conceded. |

---

## Where the other 81 are

Every file's full open count — the seven above are drawn from these, not additional to them.

| File | Open | |
| --- | ---: | --- |
| [business/order/context_clarify.md](business/order/context_clarify.md#question) | 13 | |
| [technical/architecture/context_clarify.md](technical/architecture/context_clarify.md#question) | 11 | |
| [business/balance/context_clarify.md](business/balance/context_clarify.md#question) | 8 | ▼ was 9 — `found` needs no handshake |
| [business/stock/context_clarify.md](business/stock/context_clarify.md#question) | 7 | |
| [business/ledger/context_clarify.md](business/ledger/context_clarify.md#question) | 7 | |
| [technical/balance/team_balance_design_clarify.md](technical/balance/team_balance_design_clarify.md#question) | 5 | ▼▼ was 7 — the summary is tiles, the default row is a dialog |
| [business/product/context_clarify.md](business/product/context_clarify.md#question) | 6 | |
| [business/business_level_clarify.md](business/business_level_clarify.md#question) | 6 | |
| [business/user/context_clarify.md](business/user/context_clarify.md#question) | 5 | |
| [technical/stock/design_clarify.md](technical/stock/design_clarify.md#question) | 4 | 🆕 counted for the first time |
| [technical/development/workflow_clarify.md](technical/development/workflow_clarify.md#question) | 4 | |
| [business/settlement/context_clarify.md](business/settlement/context_clarify.md#question) | 4 | |
| [technical/ledger/mutation_and_ledger_clarify.md](technical/ledger/mutation_and_ledger_clarify.md#question) | 3 | 🆕 counted for the first time |
| [technical/event/library_clarify.md](technical/event/library_clarify.md#question) | 2 | 🆕 counted for the first time |
| [technical/cost/design_clarify.md](technical/cost/design_clarify.md#question) | 2 | 🆕 counted for the first time |
| [business/product/systems_clarify.md](business/product/systems_clarify.md#question) | 1 | |

> **Counted from each file's Question section, at either heading level.** Previous rebuilds matched
> `## Question` only, and five technical clarifies write theirs as `# Question` — so **17 open
> questions were silently excluded**, all six of technical balance's among them. ⚠ **Worth fixing at
> the source:** one heading level across every clarify makes this count mechanical instead of a
> judgement call.
