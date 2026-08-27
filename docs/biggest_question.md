# The 7 Biggest Questions

Every open question in every `_clarify.md`, rolled up to the seven that block the most.

> **Derived file — regenerate, never hand-edit.** Same rule as a `state_report`. It is built from
> `*_clarify.md` only, never from `*_decision.md`, so an answered question leaves here the moment it
> is recorded. Rebuild it whenever any `_clarify.md` changes.
>
> **Ranked by what is BLOCKED**, not by how interesting the question is — a question that stops a
> lifecycle pass outranks one that merely matters. Several rows below are **one question asked in two
> docs**; merging those is most of what this file is for.

**68 open questions across 11 files.** The seven below are shown; **61 are not** — they are not
closed, only smaller. The per-file counts are at the bottom.

> **Four settled since the last build, all in settlement** — including a **⛔ reversal** — all recorded in
> [business/settlement/context_decision.md](business/settlement/context_decision.md).
> **[a-residual-balance-is-normal](business/settlement/context_decision.md#a-residual-balance-is-normal)**
> answered the old **#1**: the balance is a **variance**, residuals are expected, and nobody chases them,
> so the shortfall-versus-fee ambiguity is real and does not matter ·
> **[settlement-ignores-our-order-status](business/settlement/context_decision.md#settlement-ignores-our-order-status)**
> resolved the `COMPLETED` contradiction and handed it back to `order_context` ·
> **[importing-is-not-settlements-job](business/settlement/context_decision.md#importing-is-not-settlements-job)**
> moved file import, matching and the unmatched tray to a deferred `export_service`, cutting settlement
> from six screens to two ·
> **[settlement-keys-on-our-order-id](business/settlement/context_decision.md#settlement-keys-on-our-order-id)**
> ⛔ **reverses** `every-marketplace-order-carries-a-unique-platform-ref`, which was **#7** last build.
>
> ⚠ **The new #1 is what the import decision opened**: a ledger fed by another service cannot dedupe on
> a file it never sees — and the residual-is-normal decision removes the only thing that would have
> caught a double-post.

---

| # | The question | Blocks | Asked in | My recommendation |
| --- | --- | --- | --- | --- |
| **1** | **Nothing in settlement can detect a wrong entry — and a person can now type one.** Three decisions compose into it: `importing-is-not-settlements-job` took away the file (so no line reference to dedupe on), `a-residual-balance-is-normal` took away the arithmetic check (**a doubled or invented fee looks exactly like an ordinary unexplained residual**), and §What Frontend Expected added a human typing arbitrary signed amounts. Every other ledger in this design has a self-check — liability has two-phase confirm, inventory has opname, the book has a trial balance. This one has none. | settlement's whole write path, both directions — `initial_total` needs the RPC today, before `export_service` exists | [settlement Q1](business/settlement/context_clarify.md#question) · [settlement Q2](business/settlement/context_clarify.md#question) | **A caller-supplied `idempotency_key` on both paths, plus a type whitelist and a role policy for manual entry** — `marketplace_adjustment` and `other` only, restricted to the roles that may read revenue. `initial_total` is the system's; `fund` and the fee types are the platform's word, not ours. |
| **2** | **Where does the Debt Threshold gate live, and does it BLOCK or WARN?** `balance_context` says *prevent*, which a projection cannot do. ⚠ **Risen — its moment is now fixed.** `order-created-is-finalize` collapsed draft-or-finalize into one instant, so every check runs at `finalize` and only the gate's *behaviour* and *home* are unknown. | order finalize, the `liability_service` design, the ledger's read/write split | [ledger Q1](business/ledger/context_clarify.md#question) · [balance Q2](business/balance/context_clarify.md#question) | **A synchronous pair-exposure counter outside the ledger, and BLOCK.** |
| **3** | **Is the receiving step order deliberate — `Calculate Unit Price` BEFORE the shortfall is known?** As drawn, freight and the warehouse fee divide by the *expected* quantity, so units that never arrived carry cost and the ones that did are under-priced. | every batch's unit price, and therefore COGS and margin for the life of the batch | [stock Q1](business/stock/context_clarify.md#question) · [product Q2](business/product/context_clarify.md#question) | **Move it after `Calculate valid Qty`.** One arrow. Cost = money actually spent ÷ goods actually landed. |
| **4** | **What happens when one order half-succeeds across five services?** Settlement makes it six, and the payout arrives days after the write that should have recorded it. ⚠ **Sharper, not smaller:** `order-created-is-finalize` makes finalize a **single atomic act** spanning mapping, stock and money — which is exactly the multi-service write this asks about. | every cross-service write in the system | [architecture Q2](technical/architecture/context_clarify.md#question) | **It exists completely or not at all** — draw, gate, commit, release on failure. |
| **5** | **Does a DRAFT touch the MONEY — a payable, the debt threshold, the shared lock, the reserve?** §Order Draft says a draft creates no stock and no placement; `order-created-is-finalize` fixed the moment. Only the financial half is unstated. | the ledger's write moment, the threshold's trigger, the lock and reserve checks | [order Q4](business/order/context_clarify.md#question) | **None of it at draft** — and your own section forces it: a draft holds an *external* SKU, so it has no product, no owner and no cost, and none of the four are computable. The price is that **finalize must re-check and may refuse**. |
| **6** | **Whose shelf does a returned cross-sold unit land on — the borrower's or the owner's?** The price is decided; the custody is not, and the price is only coherent on one of the two shelves. | returns, cross-sell pricing, stock ownership | [product Q1](business/product/context_clarify.md#question) | **The borrower's** — the only shelf on which the chosen price is what its owner paid. Custody and price travel together. |
| **7** | **What moment consumes a FIFO layer, and which service stores the frozen cost?** Layers are inventory's, COGS is ledger's — the answer sets a service boundary, not just a timing. | the inventory/ledger split, COGS correctness, order lines | [product Q5](business/product/context_clarify.md#question) · [architecture Q3](technical/architecture/context_clarify.md#question) | **At commitment, both frozen on the line.** |

---

## Where the other 61 are

Every file's full open count — the seven above are drawn from these, not additional to them.

| File | Open |
| --- | --- |
| [business/order/context_clarify.md](business/order/context_clarify.md#question) | 11 |
| [technical/architecture/context_clarify.md](technical/architecture/context_clarify.md#question) | 9 |
| [business/ledger/context_clarify.md](business/ledger/context_clarify.md#question) | 7 |
| [business/stock/context_clarify.md](business/stock/context_clarify.md#question) | 7 |
| [business/balance/context_clarify.md](business/balance/context_clarify.md#question) | 6 |
| [business/business_level_clarify.md](business/business_level_clarify.md#question) | 6 |
| [business/settlement/context_clarify.md](business/settlement/context_clarify.md#question) | 7 |
| [business/product/context_clarify.md](business/product/context_clarify.md#question) | 5 |
| [business/user/context_clarify.md](business/user/context_clarify.md#question) | 5 |
| [technical/development/workflow_clarify.md](technical/development/workflow_clarify.md#question) | 4 |
| [business/product/systems_clarify.md](business/product/systems_clarify.md#question) | 1 |

`technical/balance`, `technical/cost`, `technical/event`, `technical/ledger` and `technical/stock`
have clarify files with no open question section — critique and proposals only.

⚠ **Settlement stayed at 6 while two of its questions were settled.** The ledger shape closed three and
opened three sharper ones, which is what a specification does.

---

## Cheapest to answer

Not the biggest, but they close for one sentence each and unblock real work:

| Question | Asked in |
| --- | --- |
| **Is `fund` the GROSS payout or the NET cash received?** One word, and it decides whether marketplace commission is ever visible in this system — the example shows `+100.000` on a 120.000 order with no commission row. | [settlement Q3](business/settlement/context_clarify.md#question) |
| **Is "Placement" the RACK, or the moment the order is placed?** One word. It is the phrase the rest of the system uses for the finalize moment, so it currently names both ends of the same sentence. | [order Q10](business/order/context_clarify.md#question) |
| **Does settlement SUBSCRIBE to order creation, or does `selling_service` call it?** `initial_total` fires on an event another service owns. | [settlement Q4](business/settlement/context_clarify.md#question) |
| **Is `problem funding` just `marketplace_adjustment`?** Your own example uses that type for a reimbursement, which is what I would call problem funding. | [settlement Q7](business/settlement/context_clarify.md#question) |
| **Does production exist yet as an environment?** "No" is a complete answer, and explains why `deploy` is a tool requirement with no workflow behind it. | [workflow Q4](technical/development/workflow_clarify.md#question) |
| **How many people build on `dev` at once?** Even "one" makes the workflow sound. | [workflow Q3](technical/development/workflow_clarify.md#question) |
| **Does anything you sell expire?** | [stock Q7](business/stock/context_clarify.md#question) |

---

## Worth more than it looks

**Is the external SKU → product mapping remembered between orders?** ([order Q11](business/order/context_clarify.md#question))
Not big enough for the seven, but it decides whether the API path saves work or only moves it: if the
mapping dies with the draft, every order of the same SKU is mapped by hand forever, and the scan saves
typing only to charge it back at review.

**`marketplace_total = 0` means "not recorded", not "worth nothing".**
([settlement Critique 3](business/settlement/context_clarify.md#critique)) A phone order has no
marketplace figure, so it would open its settlement account at 0 and every `fund` would push the balance
*positive* — reading as the platform overpaying. Same shape as `cost_known` on `order_revenues`: zero is
both a legitimate value and the unknown marker.
