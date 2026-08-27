# The 7 Biggest Questions

Every open question in every `_clarify.md`, rolled up to the seven that block the most.

> **Derived file — regenerate, never hand-edit.** Same rule as a `state_report`. It is built from
> `*_clarify.md` only, never from `*_decision.md`, so an answered question leaves here the moment it
> is recorded. Rebuild it whenever any `_clarify.md` changes.
>
> **Ranked by what is BLOCKED**, not by how interesting the question is — a question that stops a
> lifecycle pass outranks one that merely matters. Several rows below are **one question asked in two
> docs**; merging those is most of what this file is for.

**59 open questions across 11 files.** The seven below are shown; **52 are not** — they are not
closed, only smaller. The full list is at the bottom.

---

| # | The question | Blocks | Asked in | My recommendation |
| --- | --- | --- | --- | --- |
| **1** | **Does a DRAFT commit anything — stock, ledger, threshold — and is `Order Created` the same moment as `finalized`?** Your two order flows share no vertex, so a reader cannot tell whether the journey starts before or after this moment. | the whole order path, stock reservation, ledger posting, the debt gate | [order Q4](business/order/context_clarify.md#question) | **Nothing happens at draft.** Everything commits at `finalize`, atomically — so finalize must re-check and may refuse. |
| **2** | **Is the receiving step order deliberate — `Calculate Unit Price` BEFORE the shortfall is known?** As drawn, freight and the warehouse fee divide by the *expected* quantity, so units that never arrived carry cost and the ones that did are under-priced. | every batch's unit price, and therefore COGS and margin for the life of the batch | [stock Q1](business/stock/context_clarify.md#question) · [product Q2](business/product/context_clarify.md#question) | **Move it after `Calculate valid Qty`.** One arrow. Cost = money actually spent ÷ goods actually landed. |
| **3** | **Whose shelf does a returned cross-sold unit land on — the borrower's or the owner's?** The price is decided; the custody is not, and the price is only coherent on one of the two shelves. | returns, cross-sell pricing, stock ownership | [product Q1](business/product/context_clarify.md#question) | **The borrower's** — the only shelf on which the chosen price is what its owner paid. Custody and price travel together. |
| **4** | **Where does the Debt Threshold gate live, and does it BLOCK or WARN?** `balance_context` says *prevent*, which a projection cannot do. | order finalize, the balance design, the ledger's read/write split | [ledger Q1](business/ledger/context_clarify.md#question) · [balance Q2](business/balance/context_clarify.md#question) | **A synchronous pair-exposure counter outside the ledger, and BLOCK.** |
| **5** | **What moment consumes a FIFO layer, and which service stores the frozen cost?** Layers are inventory's, COGS is ledger's — the answer sets a service boundary, not just a timing. | the inventory/ledger split, COGS correctness, order lines | [product Q5](business/product/context_clarify.md#question) · [architecture Q3](technical/architecture/context_clarify.md#question) | **At commitment, both frozen on the line.** |
| **6** | **What happens when one order half-succeeds across five services?** | every cross-service write in the system | [architecture Q2](technical/architecture/context_clarify.md#question) | **It exists completely or not at all** — draw, gate, commit, release on failure. |
| **7** | **Is the separation-of-duties rule about the ROLE or the PERSON, and which role may perform the money-setting acts?** One human can hold two roles, which makes the role version unenforceable. | the `request_policy` on every write RPC | [user Q3, Q4](business/user/context_clarify.md#question) | **The person.** Money-setting acts are Owner or Admin only — never the person counting, never Customer Service. |

---

## Where the other 52 are

| File | Open |
| --- | --- |
| [business/order/context_clarify.md](business/order/context_clarify.md#question) | 9 |
| [technical/architecture/context_clarify.md](technical/architecture/context_clarify.md#question) | 9 |
| [business/ledger/context_clarify.md](business/ledger/context_clarify.md#question) | 7 |
| [business/stock/context_clarify.md](business/stock/context_clarify.md#question) | 7 |
| [business/balance/context_clarify.md](business/balance/context_clarify.md#question) | 6 |
| [business/business_level_clarify.md](business/business_level_clarify.md#question) | 6 |
| [business/product/context_clarify.md](business/product/context_clarify.md#question) | 5 |
| [business/user/context_clarify.md](business/user/context_clarify.md#question) | 5 |
| [technical/development/workflow_clarify.md](technical/development/workflow_clarify.md#question) | 4 |
| [business/product/systems_clarify.md](business/product/systems_clarify.md#question) | 1 |

`technical/balance`, `technical/cost`, `technical/event`, `technical/ledger` and `technical/stock`
have clarify files with no open question section — critique and proposals only.

---

## Cheapest to answer

Not the biggest, but they close for one sentence each and unblock tooling work:

| Question | Asked in |
| --- | --- |
| **Does production exist yet as an environment?** "No" is a complete answer, and explains why `deploy` is a tool requirement with no workflow behind it. | [workflow Q4](technical/development/workflow_clarify.md#question) |
| **How many people build on `dev` at once?** Even "one" makes the workflow sound. | [workflow Q3](technical/development/workflow_clarify.md#question) |
| **Does anything you sell expire?** | [stock Q7](business/stock/context_clarify.md#question) |
