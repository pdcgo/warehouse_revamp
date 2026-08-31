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

**89 open questions across 16 files.** The seven below are shown; **82 are not** — they are not
closed, only smaller. The per-file counts are at the bottom.

> ## What changed this round
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
> ⛔ **Nothing below the contract is verified.** Migrations are written and none has run — Docker has
> never been up on this machine, so every DB-backed test skips.
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
| **1** | **What happens when one order half-succeeds across six services?** ⬆ **was #2, and it is #1 now because nothing has touched it** — several rows that outranked it turned out to be positions the code had already taken. Settlement sits on the **critical path of order creation** ([order-service-calls-settlement](business/settlement/context_decision.md#order-service-calls-settlement)), and settlement's own *"what does a FAILED call do to the order?"* is a site of this question, not a separate one. ⚠ There is no outbox, no saga and no compensation anywhere in the repo, so the failure mode is live every time an order is placed. | every cross-service write in the system | [architecture Q2](technical/architecture/context_clarify.md#question) · [settlement Q1](business/settlement/context_clarify.md#question) | **It exists completely or not at all** — draw, gate, commit, release on failure. For settlement specifically: **the order still commits**, with a visible *"account not opened"* state, because a missing account is repairable where a lost order is not. |
| **2** | **Does the courier's TIP belong inside the frozen unit cost?** ⚠ **HALVED by re-examination, and the surviving half is verified in code.** This row used to merge a denominator defect and a numerator one. **(a) The denominator is already right** — [restock_request_fulfill.go:210](backend/services/inventory_service/inventory_v1/restock_request_fulfill.go#L210) divides by `sellableTotal`, what actually arrived with damaged units excluded, and the line cost by `line.quantity`, the received one. The owner's flow diagram draws it the other way round, so [stock Q1](business/stock/context_clarify.md#question) is a question about the DIAGRAM, not a live defect. **(b) The numerator stands** — `freight := rr.ShippingCost + costLineTotal`, under the comment *"EVERY OUTLAY IS FREIGHT"*, capitalises the incidental fee that `balance_context.md` defines as a courier's *"coffe tip"* into a cost frozen for the life of the batch. ⚠ **And it compounds with a decision taken this round**: a breakage reimbursement pays at COGS, so the warehouse is repaid a tip it charged, and [found-posts-without-a-handshake](business/balance/context_decision.md#found-posts-without-a-handshake) lets it reverse that reimbursement unilaterally. | every batch's frozen unit cost — and therefore COGS, margin, the cross-charge (COGS × markup) and breakage payouts, for the life of the batch | [product Q6](business/product/context_clarify.md#question) · [stock Q1](business/stock/context_clarify.md#question) | **Take the tip OUT, leave `ShipmentFee` in** — freight is agreed before the journey and is genuinely part of what the goods cost; an unpredictable ask at the door is not. One line — `freight := rr.ShippingCost` — with `costLineTotal` still posting to the balance. ⚠ Note `freightPerUnit` is integer division and **floors**, so a small tip contributes **0 per unit** while being charged in full on the balance: it is already unreliable at exactly the sizes it is described as being. |
| **3** | **🆕 Which markup does the LEDGER charge from?** ⛔ **A live billing discrepancy, found while acting on an owner decision.** The cross-product markup is stored TWICE and nothing keeps the copies equal: `products.cross_markup_bps` is what the product detail QUOTES a borrowing team, and `liability_terms.product_markup_bp` is what [`order_fees.go:144`](backend/services/liability_service/liability_v1/order_fees.go) actually CHARGES it. Set one to 20% and leave the other at 5% and the quote and the invoice disagree — in whichever direction was edited last, silently, with neither screen able to see the other. ✅ The OWNERSHIP is settled: the rate is `product_service`'s ([the-cross-markup-belongs-to-the-product](business/balance/context_decision.md#the-cross-markup-belongs-to-the-product)), and the balance screens no longer show it. What is open is only which number the posting reads. | every cross-sold order's fee — the amount a team is quoted versus the amount it is billed | [technical balance Q10](technical/balance/team_balance_design_clarify.md#question) · [Contradiction](business/balance/context_clarify.md#two-markups-exist-and-the-screen-and-the-ledger-read-different-ones) | **`order_fees.go` reads the PRODUCT's rate when it freezes the fee, and `liability_terms.product_markup_bp` is dropped in the same migration.** Balance is then told the amount rather than asked to compute the rate — already true of every other cause. ⚠ **Three things land together or the fee breaks**: the read moves, the column goes, and the frontend's pass-through bridge is deleted. |
| **4** | **Can a team CONTEST a charge posted on its books — and does a charge ever become final?** ⛔ **Promoted by an answer, not by an edit.** [found-posts-without-a-handshake](business/balance/context_decision.md#found-posts-without-a-handshake) refused cause 5 an acknowledgement, so a warehouse posts *"found it"* and the owning team's balance moves the same instant, with no consent and no notice. Dispute was the fallback behind that handshake, and it does not exist. ⚠ **Three things compound it, each verified in code rather than supposed:** nothing binds a find to the loss it repays (`reversal` is a boolean and the entry posts under the find's own movement id — [technical C10](technical/balance/team_balance_design_clarify.md#critique)) · there is no cycle, so no entry ever becomes final ([no-overdue-only-the-threshold](business/balance/context_decision.md#no-overdue-only-the-threshold)) · and the resulting balance refuses the team's next order ([the-block-stops-orders-only](business/balance/context_decision.md#the-block-stops-orders-only)). | ⛔ every team's only recourse against a charge asserted in the asserter's favour — and, through the threshold, whether one team can stop another trading with no step at which it was asked | [balance Q5](business/balance/context_clarify.md#question) · [balance Q6](business/balance/context_clarify.md#question) | **A window on the ENTRY — disputable for N days, agreed by silence after.** It needs no statement object, no due date and no overdue state, so it does not reopen the no-cycle decision, and it gives both sides the moment of finality a cycle would have supplied. ⚠ **Build `reverses_group_id` with it** — a traceability nicety while a handshake existed, and now the only thing that could bound a find to what was conceded. |
| **5** | **Which PRE-CHECKS does a draft run — does it touch the reserve, the shared lock, the debt threshold?** ✅ The ledger half is closed and the moment is fixed at finalize. What is unstated is which of the checks a *draft* runs before it. | the ledger's write moment, the threshold's trigger, the lock and reserve checks | [order Q4](business/order/context_clarify.md#question) | **None of it at draft** — your own section forces it: a draft holds an *external* SKU, so it has no product, no owner and no cost, and none of the four are computable. The price is that **finalize must re-check and may refuse**. |
| **6** | **Can one ORDER's true result be read anywhere?** ⚠ **Halved by the deferral.** The first half — whose job is the selling team's money screen — is parked with [the-daily-report-is-deferred](business/balance/context_decision.md#the-daily-report-is-deferred). What survives: the marketplace money is settlement's at **order** grain and the `order_fee` is balance's at **pair** grain, so *"what did order 1 make"* has no reader — `order_fees.go` writes `SourceID = orderID` and `LiabilityLogListFilter` accepts `counterparty_id` and nothing else. | order-level profitability — the fee is recorded, attributable, and unaskable | [balance Q9](business/balance/context_clarify.md#question) | **One `order_id` filter on `LiabilityLogListFilter`, never a second copy of the fee** in settlement's ledger — one movement written as two rows in two services with no shared transaction is the failure [technical balance C4](technical/balance/team_balance_design_clarify.md#critique) already names. |
| **7** | **Where does a platform WITHDRAWAL live?** Wallet to bank, naming no order — so it is none of settlement's seven types, and [every-entry-names-an-order](business/settlement/context_decision.md#every-entry-names-an-order) made `order_id NOT NULL`, which forbids the obvious workaround. Asked in two docs, which is what this file exists to merge. | every shop's cash reconciliation — the wallet is fed by orders and drained by something with no home | [architecture Q7](technical/architecture/context_clarify.md#question) · [settlement Q3](business/settlement/context_clarify.md#question) | **Answer it once, in the architecture clarify, and have settlement follow.** → `order_service`, because the wallet is fed by that shop's orders and the withdrawal is reconciled against them. If a bank or cash account is ever modelled, it moves. |

## Where the other 82 are

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
