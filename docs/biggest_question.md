# The 7 Biggest Questions

Every open question in every `_clarify.md`, rolled up to the seven that block the most.

> **Derived file — regenerate, never hand-edit.** Same rule as a `state_report`. It is built from
> `*_clarify.md` only, never from `*_decision.md`, so an answered question leaves here the moment it
> is recorded. Rebuild it whenever any `_clarify.md` changes.
>
> **Ranked by what is BLOCKED**, not by how interesting the question is — a question that stops a
> lifecycle pass outranks one that merely matters. Several rows below are **one question asked in two
> docs**, and merging those is most of what this file is for.

**91 open questions across 16 files.** The seven below are shown; **84 are not** — they are not
closed, only smaller. The per-file counts are at the bottom.

> **Driven by `balance_context.md` §Payment Flow** — two diagrams that specify the payment lifecycle
> end to end, the third owner edit to the balance context in a day.
>
> ✅ **One question closed the way it was recommended.** *"May the creditor REJECT a claimed payment?"*
> — yes, terminal, posting nothing
> ([the-debtor-claims-the-creditor-decides](business/balance/context_decision.md#the-debtor-claims-the-creditor-decides)).
> It is **build work** now, not a question.
>
> **Driven by three answers in one message**, all three now BUILT — the cost-line note rule, Credit
> Terms as a section of the pair detail, and payment proof.
>
> ✅ **#3 IS DONE AND #7 IS GONE.** The ledger migration ran as code (vocabulary, `actor_id`, the
> rename to `liability_logs`), the cost-kind collapse completed it, and *is Credit Terms a screen or
> a section* was answered — a section — so the `design_accept` gate that had been holding a finished
> prototype is passed.
>
> ⛔ **AND ONE OF THE ANSWERS CREATED A NEW BLOCKER, at #6.** The terms LIST was the only place the
> DEFAULT row (`counterparty_id = 0`) could be read or written, and implementing *a section of the
> pair detail* deleted it. A pair page lives at `/liability/:counterpartyId` and **team 0 is not a
> team**, so the rule every other row is an exception to is now settable **nowhere**
> ([technical balance Q6](technical/balance/team_balance_design_clarify.md#question)). This is a
> live regression, not a design gap, and one sentence settles it.
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
> ⚠ **Not a question, and still true: "Summarize All Balance" is computed over ONE PAGE.** The four
> tiles on `/liability` reduce the loaded 20 rows, so a creditor with 21 counterparties reads a
> headline that silently omits one. A defect with a known fix
> ([technical balance C16](technical/balance/team_balance_design_clarify.md#critique)), not something
> to rank here.

---

| # | The question | Blocks | Asked in | My recommendation |
| --- | --- | --- | --- | --- |
| **1** | **Is the frozen `UnitPrice` formula right — in its DENOMINATOR and in its NUMERATOR?** **Merged**, because both defects corrupt the same number. **(a)** `Calculate Unit Price` runs *before* the shortfall is known, so freight divides by the **expected** quantity — units that never arrived carry cost and the ones that did are under-priced. **(b)** `AdditionalWarehouseFee` sits inside the formula, and `balance_context.md` has now defined that money as a **courier's tip**. ⚠ Still #1: this is the only number in the system that is **frozen at receipt and read forever** by COGS, margin, and the reimbursement owed if the goods are broken. | every batch's unit price, and therefore COGS, margin and breakage payouts for the life of the batch | [stock Q1](business/stock/context_clarify.md#question) · [product Q2](business/product/context_clarify.md#question) · [product Q6](business/product/context_clarify.md#question) | **(a) Move it after `Calculate valid Qty`** — cost = money actually spent ÷ goods actually landed. **(b) Take the tip OUT, leave `ShipmentFee` in** — freight is agreed before the journey and is genuinely part of what the goods cost. ⚠ And note `freightPerUnit` floors, so a small tip contributes **0** per unit while being charged in full on the balance: it is already unreliable at exactly the sizes it is described as being. |
| **2** | **What happens when one order half-succeeds across six services?** Settlement now sits on the **critical path of order creation** ([order-service-calls-settlement](business/settlement/context_decision.md#order-service-calls-settlement)), and settlement's own *"what does a FAILED call do to the order?"* is a site of this question, not a separate one. | every cross-service write in the system | [architecture Q2](technical/architecture/context_clarify.md#question) · [settlement Q1](business/settlement/context_clarify.md#question) | **It exists completely or not at all** — draw, gate, commit, release on failure. For settlement specifically: **the order still commits**, with a visible *"account not opened"* state, because a missing account is repairable where a lost order is not. |
| **3** | **⛔ DECIDED, NO LONGER BLOCKED, and it has GROWN — the ledger vocabulary migration, now carrying two more approved changes.** Not an open question: [the-ledger-speaks-the-business-words](business/balance/context_decision.md#the-ledger-speaks-the-business-words) settles the source types — `order_fee` · **`incidental_fee`** · `broken_good` · `lost_good` · `found` — and one later decision lands on the same table: **`actor_id`** ([every-entry-names-who-posted-it](technical/balance/team_balance_design_decision.md#every-entry-names-who-posted-it)). ⚠ A third rider — renaming off *liability* — was floated and **cancelled** ([liability-stays](technical/balance/team_balance_design_decision.md#liability-stays)), so the table names do not move. Two changes, one pass over the service. ✅ **The tooling block is GONE** (2026-08-29): `buf.gen.yaml` now uses `local:` plugins pinned by the root go.mod's `tool` directives and by frontend/package.json, so `cd proto && buf generate` needs **no Buf account**. It stays in this list only because it is the highest-value BUILD item in the repo and nothing has run it yet. | a live bug: the daily statement reads `COD_FEE`, which nothing posts, so its column is permanently zero while `RESTOCK_OUTLAY` appears in none · **and every day of waiting adds ledger rows that can never say who posted them** | [decision](business/balance/context_decision.md#the-ledger-speaks-the-business-words) · [technical balance C15](technical/balance/team_balance_design_clarify.md#critique) | **Run it once, with both changes in it.** ⚠ Waiting costs history twice over and neither loss is recoverable: existing rows cannot say whether a `stock_damage` was **broken** or **lost**, and none of them can say **who posted it**. ⚠ A **table rename** now wants to ride along too ([technical Q8](technical/balance/team_balance_design_clarify.md#question)) — cheap inside this migration, a second pass outside it. |
| **4** | **What moment consumes a FIFO layer, and which service stores the frozen cost?** Layers are inventory's, COGS is ledger's — the answer sets a service boundary, not just a timing. | the inventory/ledger split, COGS correctness, order lines | [product Q5](business/product/context_clarify.md#question) · [architecture Q3](technical/architecture/context_clarify.md#question) | **At commitment, both frozen on the line.** |
| **5** | **🆕 Whose job is the SELLING team's money screen — and can one ORDER's true result be read anywhere?** Two halves of one gap opened by `0d4cbc4`. **(a)** `revenue_service` was removed and it held the selling team's income, so the daily statement is `StatementMode = "warehouse"` alone and **refuses** a selling team — while `balance_context.md` §Responsbility 2 still claims *"Serve Balance Daily Report"*. **(b)** The marketplace money is settlement's at **order** grain and the `order_fee` is balance's at **pair** grain, so *"what did order 1 make"* has no reader: `order_fees.go` writes `SourceID = orderID`, but `LiabilityEntryListFilter` accepts `counterparty_id` and nothing else. | every selling team's view of its own money — a shipped page refuses them today · the meaning of balance's second stated responsibility · order-level profitability | [balance Q8](business/balance/context_clarify.md#question) · [balance Q9](business/balance/context_clarify.md#question) | **(a) Two screens — balance serves the WAREHOUSE statement, settlement serves the SELLING one.** They subtract different things, and only the warehouse's is a pair-ledger read. §Responsbility 2 should then say *warehouse*. **(b) One `order_id` filter on `LiabilityEntryListFilter`, never a second copy of the fee** in settlement's ledger — one movement written as two rows in two services with no shared transaction is the failure [technical balance C4](technical/balance/team_balance_design_clarify.md#critique) already names. |
| **6** | **Which PRE-CHECKS does a draft run — does it touch the reserve, the shared lock, the debt threshold?** ✅ The ledger half is closed; the moment is fixed at finalize. What is unstated is which of the checks a *draft* runs before it. | the ledger's write moment, the threshold's trigger, the lock and reserve checks | [order Q4](business/order/context_clarify.md#question) | **None of it at draft** — your own section forces it: a draft holds an *external* SKU, so it has no product, no owner and no cost, and none of the four are computable. The price is that **finalize must re-check and may refuse**. |
| **7** | **🆕 Where is the DEFAULT row edited?** `counterparty_id = 0` is terms for every team without their own — the rule every other row is an exception to. It was set on the terms LIST, and [terms-live-on-the-pair-detail](technical/balance/team_balance_design_decision.md#terms-live-on-the-pair-detail) deleted that list in favour of a section on each pair. A pair page is `/liability/:counterpartyId` and **team 0 is not a team**, so there is no page the section can appear on. ⚠ **A live regression, not a design gap**: it is settable nowhere in the running app right now. | ⛔ the default credit limit, fee and markup for every counterparty without their own · §Balance Policy's threshold for teams nobody has configured | [technical balance Q6](technical/balance/team_balance_design_clarify.md#question) | **The CREDITOR's own settings** — the default belongs to the team granting credit, not to any pair. One field group on the team page reading *"terms for any team without their own"*, and the pair detail's section shows the inherited value with a *"using the default"* marker until overridden. ⚠ **Refuse a synthetic `/liability/0` route**: it puts a page in the pair namespace for something that is not a pair, and every list, breadcrumb and back-link would special-case it. |

---

## Where the other 84 are

Every file's full open count — the seven above are drawn from these, not additional to them.

| File | Open | |
| --- | ---: | --- |
| [business/order/context_clarify.md](business/order/context_clarify.md#question) | 13 | |
| [technical/architecture/context_clarify.md](technical/architecture/context_clarify.md#question) | 11 | |
| [business/balance/context_clarify.md](business/balance/context_clarify.md#question) | 10 | ▼ was 12 — proof required, and the cost-line note rule |
| [business/stock/context_clarify.md](business/stock/context_clarify.md#question) | 7 | |
| [business/ledger/context_clarify.md](business/ledger/context_clarify.md#question) | 7 | |
| [technical/balance/team_balance_design_clarify.md](technical/balance/team_balance_design_clarify.md#question) | 6 | the rename closed, the terms-column split opened |
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
