# The 7 Biggest Questions

Every open question in every `_clarify.md`, rolled up to the seven that block the most.

> **Derived file — regenerate, never hand-edit.** Same rule as a `state_report`. It is built from
> `*_clarify.md` only, never from `*_decision.md`, so an answered question leaves here the moment it
> is recorded. Rebuild it whenever any `_clarify.md` changes.
>
> **Ranked by what is BLOCKED**, not by how interesting the question is — a question that stops a
> lifecycle pass outranks one that merely matters. Several rows below are **one question asked in two
> docs**, and merging those is most of what this file is for.

**71 open questions across 11 files.** The seven below are shown; **64 are not** — they are not
closed, only smaller. The per-file counts are at the bottom.

> **Driven by three answers in chat**, closing the threshold end to end:
> [warehouse-roles-count-as-their-own-team](business/balance/context_decision.md#warehouse-roles-count-as-their-own-team) ·
> [a-limit-change-is-recorded](business/balance/context_decision.md#a-limit-change-is-recorded) ·
> [the-block-stops-orders-only](business/balance/context_decision.md#the-block-stops-orders-only).
>
> ⛔ **THE DEBT THRESHOLD LEAVES THIS FILE.** It has been in the top seven since the first rollup —
> as #1, then demoted to #6, promoted back to #3, rewritten twice. Warn level, default, write set,
> reach, audit and blast radius are all now settled, and **every answer ratified the shipped code**.
> What remains is build work: the terms screen (`liabilityTermsClient` has **zero callers**), the 80%
> warning that needs it, and one migration adding `actor_id` + `reason` + a change log.
>
> ▲ **Promoted into the gap: the ledger vocabulary migration**, at #3. Nothing is blocked by it — but
> it is the only open question that gets **permanently more expensive with every row written**, and it
> fixes a live under-reporting bug in the daily statement for free.

---

| # | The question | Blocks | Asked in | My recommendation |
| --- | --- | --- | --- | --- |
| **1** | **Is the frozen `UnitPrice` formula right — in its DENOMINATOR and in its NUMERATOR?** 🆕 **Merged this rebuild**, because both defects corrupt the same number. **(a)** `Calculate Unit Price` runs *before* the shortfall is known, so freight divides by the **expected** quantity — units that never arrived carry cost and the ones that did are under-priced. **(b)** `AdditionalWarehouseFee` sits inside the formula, and `balance_context.md` has now defined that money as a **courier's tip**. ⚠ Still #1: this is the only number in the system that is **frozen at receipt and read forever** by COGS, margin, and the reimbursement owed if the goods are broken. | every batch's unit price, and therefore COGS, margin and breakage payouts for the life of the batch | [stock Q1](business/stock/context_clarify.md#question) · [product Q2](business/product/context_clarify.md#question) · [product Q6](business/product/context_clarify.md#question) | **(a) Move it after `Calculate valid Qty`** — cost = money actually spent ÷ goods actually landed. **(b) Take the tip OUT, leave `ShipmentFee` in** — freight is agreed before the journey and is genuinely part of what the goods cost. ⚠ And note `freightPerUnit` floors, so a small tip contributes **0** per unit while being charged in full on the balance: it is already unreliable at exactly the sizes it is described as being. |
| **2** | **What happens when one order half-succeeds across six services?** Settlement now sits on the **critical path of order creation** ([order-service-calls-settlement](business/settlement/context_decision.md#order-service-calls-settlement)), and settlement's own *"what does a FAILED call do to the order?"* is a site of this question, not a separate one. | every cross-service write in the system | [architecture Q2](technical/architecture/context_clarify.md#question) · [settlement Q1](business/settlement/context_clarify.md#question) | **It exists completely or not at all** — draw, gate, commit, release on failure. For settlement specifically: **the order still commits**, with a visible *"account not opened"* state, because a missing account is repairable where a lost order is not. |
| **3** | **⛔ DECIDED, and BLOCKED on tooling — the ledger vocabulary migration.** Not an open question any more: [the-ledger-speaks-the-business-words](business/balance/context_decision.md#the-ledger-speaks-the-business-words) settles the target — `order_fee` · **`incidental_fee`** · `broken_good` · `lost_good` · `found`, with the two cost-line kinds collapsed into one. It stays in this file because **it cannot be built**: every plugin in `buf.gen.yaml` is a `remote:` BSR plugin, there is no BSR login, and `clean: true` means running `buf generate` anyway **empties `backend/gen` and `frontend/src/gen` and produces nothing**. Local fallback fails too — `protoc-gen-es` is absent and the Go plugins are the wrong versions. | every proto change in the repo, not just this one · a live bug: the daily statement reads `COD_FEE`, which nothing posts, so its column is permanently zero | [decision](business/balance/context_decision.md#the-ledger-speaks-the-business-words) · [technical balance C15](technical/balance/team_balance_design_clarify.md#critique) | **`buf registry login`, or set `BUF_TOKEN`.** Then the six migration steps run in order. ⚠ Waiting costs history: existing rows cannot say whether a `stock_damage` was **broken** or **lost**, and every day adds more of them.
| **4** | **What moment consumes a FIFO layer, and which service stores the frozen cost?** Layers are inventory's, COGS is ledger's — the answer sets a service boundary, not just a timing. | the inventory/ledger split, COGS correctness, order lines | [product Q5](business/product/context_clarify.md#question) · [architecture Q3](technical/architecture/context_clarify.md#question) | **At commitment, both frozen on the line.** |
| **5** | **Which PRE-CHECKS does a draft run — does it touch the reserve, the shared lock, the debt threshold?** ✅ The ledger half is closed; the moment is fixed at finalize. What is unstated is which of the checks a *draft* runs before it. | the ledger's write moment, the threshold's trigger, the lock and reserve checks | [order Q4](business/order/context_clarify.md#question) | **None of it at draft** — your own section forces it: a draft holds an *external* SKU, so it has no product, no owner and no cost, and none of the four are computable. The price is that **finalize must re-check and may refuse**. |
| **6** | **Whose shelf does a returned cross-sold unit land on — the borrower's or the owner's?** The price is decided; the custody is not, and the price is only coherent on one of the two shelves. | returns, cross-sell pricing, stock ownership | [product Q1](business/product/context_clarify.md#question) | **The borrower's** — the only shelf on which the chosen price is what its owner paid. Custody and price travel together. |
| **7** | **Where does money that is NOT between two of our teams live?** Merged — two docs asking one question. A platform **withdrawal** (wallet to bank, naming no order) has no home now that [every-entry-names-an-order](business/settlement/context_decision.md#every-entry-names-an-order) made `order_id` NOT NULL. **Supplier and courier payables** have no home either: balance's counterparties are teams only, because a payment must be *confirmed* by the creditor and an outsider has no account — and `expense_service` records a cost once **paid**, never an obligation while **outstanding**. | settlement's write API, shop-level cash, and every obligation to a party outside our teams | [settlement Q3](business/settlement/context_clarify.md#question) · [architecture Q7](technical/architecture/context_clarify.md#question) · [balance Q7](business/balance/context_clarify.md#question) | **Answer it once, in the architecture clarify, and have the others follow.** For the withdrawal, architecture's own recommendation is `order_service`, because the wallet is fed by that shop's orders. For external payables I recommend **out of scope for v1** — but **named**, because *"nowhere"* is today's answer and nobody decided it. |

---

## Where the other 64 are

Every file's full open count — the seven above are drawn from these, not additional to them.

| File | Open | |
| --- | ---: | --- |
| [business/order/context_clarify.md](business/order/context_clarify.md#question) | 13 | |
| [business/balance/context_clarify.md](business/balance/context_clarify.md#question) | 7 | ▼ was 12 — threshold + vocabulary closed |
| [technical/architecture/context_clarify.md](technical/architecture/context_clarify.md#question) | 11 | |
| [business/ledger/context_clarify.md](business/ledger/context_clarify.md#question) | 7 | |
| [business/stock/context_clarify.md](business/stock/context_clarify.md#question) | 7 | |
| [business/business_level_clarify.md](business/business_level_clarify.md#question) | 6 | |
| [business/product/context_clarify.md](business/product/context_clarify.md#question) | 6 | ▲ was 5 |
| [business/user/context_clarify.md](business/user/context_clarify.md#question) | 5 | |
| [business/settlement/context_clarify.md](business/settlement/context_clarify.md#question) | 4 | |
| [technical/development/workflow_clarify.md](technical/development/workflow_clarify.md#question) | 4 | |
| [business/product/systems_clarify.md](business/product/systems_clarify.md#question) | 1 | |

> Counted from each file's `## Question` section. The technical clarifies for `balance`, `cost`,
> `event`, `ledger` and `stock` carry no such section — their numbered lists are design items, not open
> questions — so they contribute nothing here. **Technical balance is the exception**: it holds no
> `## Question` heading, but #3 above is asked of it by name from the ledger clarify.
