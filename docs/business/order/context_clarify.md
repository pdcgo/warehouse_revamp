# Clarity — `order_context.md`

What [order_context.md](./context.md) says, and the much larger part it does
not. **That doc is yours — this one is mine.** Answered points are **deleted**, so this file is always
the current open set.

> **Re-examined after your update.** Closed and deleted from here: **how an order enters the system**
> (§How Order Enter Our System — two paths, a person and an API), and **who Customer Service is** —
> [user_context.md](../user/context.md) makes CS a **role inside the selling team**,
> not a fifth actor. What the two paths still open is a **duplicate** problem and a second door that has
> to obey the same rules as the first.
>
> **Re-examined after §What Make Our Order Unique became double entry.** ✅ **Closed and deleted — three
> items, all by one edit.** *Does a borrowed line's liability become a COST of that sale* (bullet 2 now says
> **the debit is COGS**, so both the double-count and the understatement are excluded by the text) ·
> *whose debt increases* (**payable** on the ordering team's books, **receivable** on the owner's — the
> parties are named, not described) · and **both contradictions** this file carried. The rule is renamed to
> match what the doc now says: `own-line-is-cogs-cross-line-is-liability` →
> **[every-line-debits-cogs-the-credit-differs](#every-line-debits-cogs-the-credit-differs)**.
>
> ⚠ **One residue kept:** the bullets name the legs and never the **amount** — see [Question 7](#question).
>
> **Re-examined after §How New Order Processed.** ✅ **Closed:** *is there an unattended machine path?* —
> no: a scanned order always becomes a **draft** and always needs a person to review and finalize it.
> **Narrowed, not closed:** the API question (what `finalize` enforces, and whose orders an app may
> create) · the states question (the pre-warehouse half is answered, the warehouse half is not) ·
> and the commit question, which is **re-posed in your vocabulary**: *draft, or finalize?*
>
> ⚠ **Still open and now sharper: deduplication.** One path checks by human eye, the other does not check
> at all — and it is the machine path that retries ([Critique 14](#critique)).
>
> ⚠ **§What Make Our Order Unique answers a different question from the one I asked, and the words
> collide.** Your new section says what is **distinctive** about these orders — they mix borrowed and own
> lines. My [Question 1](#question) asks what makes an order **identifiable**, so a retrying API can be
> refused. Both are "unique". **The dedup question is still open** and is reworded below to say
> *identity* — the ambiguity is worth removing before somebody reads §What Make Our Order Unique as
> having settled it.
>
> ✅ **Your block-beta parses**, and the completed picture is the mixed order in one image — two different owners' products resolving onto stock held by one warehouse.
>
> **Re-examined after §Order Draft.** ✅ **The stock half of the biggest open question is CLOSED and
> deleted** — *"When Order in draft stage, its not create this yet: Stock, Placement"*. A draft holds no
> stock and no placement, which is the answer I recommended and the one the build already implements.
> **What is left of that question is the MONEY half**, and the section is silent on it: no ledger entry,
> no debt threshold, no shared lock, no reserve is named either way. See [Question 4](#question).
>
> ⚠ **Your §Responsbility list is the more consequential half of the edit.** A draft keeps **external
> product info** — the marketplace's SKU, not our product id. That makes *nothing-at-draft*
> **structurally necessary** rather than a policy: with no mapped product a draft cannot know whose goods
> a line is, so it has no owner, no COGS, no cross-charge, no threshold to consult and no lock to honour.
> It also forces [Question 5](#question)'s answer: every check lands on `finalize`, so **finalize must be
> able to refuse**. Written up as [a-draft-holds-facts-not-commitments](#a-draft-holds-facts-not-commitments).
>
> ⚠ **Two things the section opens**, both small: *Placement* collides with the phrase the rest of the
> system uses for the finalize moment ([Question 10](#question)) · and the external-SKU→product mapping is
> remembered nowhere, so the same SKU is mapped by hand on every order forever
> ([Question 11](#question)).
>
> ✅ **Also closed and deleted this round: does a draft carry its SHOP?** Yes
> ([a-draft-carries-its-shop](./context_decision.md#a-draft-carries-its-shop)) — so a draft has an owning
> team from the moment it exists, and *"unowned"*, which nothing else in this system could handle, never
> occurs. That was Critique 15, now gone.
>
> **Three sections of prose, and the order run is the warehouse's whole day.** That is still the finding:
> everything the crew physically does — pick, pack, hand over, take back — hangs off an order, and none
> of it has a rule yet.

Siblings: [business_level](../business_level_clarify.md) · [user_context](../user/context_clarify.md) ·
[product_context](../product/context_clarify.md) · [balance_context](../balance/context_clarify.md) ·
[stock_context](../stock/context_clarify.md).

---

## Proposed Design

### The rules, named

#### an-order-carries-four-facts
When an order is created it brings **shop**, **warehouse**, **marketplace order info**, and **product**.
*(§Order Anatomy)*

#### an-order-is-typed-or-posted
Two entry paths, both first-class: **Customer Service records it manually** — a role inside the selling
team *([user_context](../user/context_clarify.md#selling-roles-are-owner-admin-customer-service))* — and a
**create-order API** exists so a selling team's own external app can post orders faster.
*(§How Order Enter Our System)*

#### an-order-is-drafted-then-finalized
An order has **two states before the warehouse ever sees it**: `draft` and `finalized`.
*(§How New Order Processed)*

- **A person may skip the draft.** Path 1 branches on *"make draft first?"* — *no* goes straight to
  *"User Make and finalize Order"*, with no review step at all.
- **A machine may not.** Path 2 is unconditional: *Scan → Create Draft → User Review → User Finalize*.

✅ **That asymmetry is deliberate and it is right.** A human entering their own order does not need a
second human to check it; a scanner does. **There is no unattended machine path** — every order reaches
`finalized` through a person.

#### a-draft-holds-facts-not-commitments
A draft **creates no stock and no placement**, and it keeps only what the outside world said:
**marketplace info · warehouse info · shipping info · customer info · external product info**.
*(§Order Draft)*

✅ **This closes the stock half of [Question 4](#question)** in the direction I recommended.

⚠ **The reason is stronger than the rule, and the doc does not say it.** A draft keeps *external*
product info — the marketplace's SKU, **not our product id**. Everything the system would want to check
at draft hangs off our product: which team owns the line, what it costs, whether it is
[shared-locked](../product/context_clarify.md#shared-lock-stops-sharing-entirely), whether it breaks a
[reserve](../product/context_clarify.md#reserved-stock-is-never-shared), whose
[debt threshold](../balance/context_clarify.md#debt-threshold-limits-liability) applies. With no mapped
product **none of them are even computable**. So *nothing at draft* is not a policy choice that could
have gone the other way — it is forced.

```mermaid
flowchart LR
  subgraph "draft — facts only"
    M["marketplace info"]
    WH["warehouse info"]
    SH["shipping info"]
    CU["customer info"]
    EX["EXTERNAL product info<br/>a SKU, not our product"]
  end
  subgraph "finalize — commitments"
    MAP["map external SKU to our product"]
    OWN["line owner, own or borrowed"]
    MON["COGS, cross charge, threshold, lock, reserve"]
    ST["stock and rack placement"]
  end
  EX --> MAP
  MAP --> OWN
  OWN --> MON
  MON --> ST
  MAP -.->|"no mapping, no owner, so nothing above is computable at draft"| EX
```

**→ Recommend** two sentences in §Order Draft: *"A draft creates no ledger entry and passes no check —
it has no mapped product, so it has no owner and no cost."* and *"Because every check runs at finalize,
finalize may refuse."* The first makes the rule un-forgettable, the second states the consequence you
have already accepted by choosing it.

✅ **A draft also carries its SHOP** — and therefore its owning team — from the moment it exists
([a-draft-carries-its-shop](./context_decision.md#a-draft-carries-its-shop)). The §Responsbility list does
not name it, so the rule lives in the decision rather than the doc.

⚠ **What §Order Draft still leaves open** — two small things, each a question below: *Placement* is the
word the rest of this system uses for the **moment an order is placed** ([Question 10](#question)) · and
the **external SKU to product mapping is remembered nowhere** ([Question 11](#question)).

### The lifecycle, whole — now mostly yours, with one seam and one dangling end

⚠ **Provisional: §Complete Journey Of The Orders is visibly unfinished** — its last node,
`is Shipment Problem ?`, has **no outgoing edges**. The journey stops exactly where the hardest part
begins, so everything after *shipped* is undrawn rather than decided. Nothing below treats that as an
answer, and I have filed no questions about what the missing branches should say.

**What I had proposed for the warehouse half is deleted — you have now drawn it**, and yours is the
version below. My proposal survives only where the doc is still silent (dotted).

```mermaid
flowchart LR
  subgraph "how an order is entered"
    D["draft"] --> F["finalized"]
  end
  subgraph "the journey"
    C["Order Created"] --> A["Warehouse Accept Order"]
    A --> P["Warehouse Process Order — packing/picking"]
    P --> G["Warehouse Give to Shipping Channel"]
    G --> W["status warehouse process completed"]
    W --> S["status shipped"]
    S --> Q{"is Shipment Problem?"}
  end
  F ==>|"ONE MOMENT — order-created-is-finalize"| C
  C --> X["cancelled — the only exit drawn, and only here"]
  Q -.->|"undrawn — this is where RETURNS enter"| Z["not yet written"]
  D -.->|"a draft nobody finalizes — still no rule"| Y["abandoned?"]
```

✅ **The seam is CLOSED** — [order-created-is-finalize](./context_decision.md#order-created-is-finalize).
`finalize the order` and `Order Created` are one moment under two names, so the two flows join and
*"at creation"* now picks exactly one instant.

**One gate and one gap remain:**

| | what | where it bites |
| --- | --- | --- |
| **the gate** | cancellation is one decision, before the warehouse accepts | [Critique 6](#critique) — an order already picked has no exit |
| **the end** | `is Shipment Problem ?` has no branches | undrawn, not undecided — no questions filed |
#### the-warehouse-accepts-before-it-processes
The journey runs **Order Created → (cancel gate) → Warehouse Accept Order → Warehouse Process Order
(Packing/Picking) → Warehouse Give to Shipping Channel → status `completed` → status `shipped`**.
*(§Complete Journey Of The Orders — provisional, the flow is unfinished)*

⚠ **`Warehouse Accept Order` is a step nobody had recorded**, and it is the first named handoff between
two teams in the order path. It implies the warehouse can **decline or defer** — on what grounds, and what
becomes of the order then, is unwritten. Folded into [Question 3](#question) rather than opened separately.

⚠ **Some boxes are activities and two are status writes** — *"set status warehouse process `completed`"*
and *"set status `shipped`"*. Read literally the order carries **two** statuses, a warehouse-process one
and an order one. **→ Recommend one line in the doc separating the two**: which boxes are *things a person
does* and which are *values the order holds*. Q3 is nearly readable off this flow and stops just short.

#### an-order-mixes-own-and-borrowed-lines
*"our Order can contain partials shared products and own products"* — one order carries **both** kinds of
line at once. So every rule about cross/shared goods is a rule about a **line**, never about an order.
*(§What Make Our Order Unique 1 and its diagram)*

Your diagram now states far more than the sentence does. **Product 2 (Team A) and Product 1 (Team B)
resolve onto stock held by ONE warehouse**, the order draws from both — and the order then emits **three
obligations, each landing in a different team's block**:

| drawn as | lands in | what it is |
| --- | --- | --- |
| `o-->cogs` | **Selling Team A** — the ordering team | what these goods cost the team that sold them |
| `o-->wf` | **Warehouse Team** | the per-order handling fee — [balance cause 1](../balance/context_clarify.md#the-six-causes-and-which-direction-each-pushes) |
| `o-->loan` | **Selling Team B** — the lending team | ⚠ a **Loan**, not a purchase and not a fee |

⚠ **`Loan` is a new word in the requirement set, and it is the first affirmative statement of what a
cross-team line IS.** It is drawn, not written — but it is the owner's own picture, and it says the goods
stayed B's and A owes for them. See [product_context Contradiction](../product/context_clarify.md#the-return-path-prices-the-unit-as-the-borrowers-while-the-order-path-leaves-it-the-owners).

#### every-line-debits-cogs-the-credit-differs
*"when product in order is own team, **the debit is COGS and credit was from assets**"* · *"when product in
order is cross team, **the debit is COGS and the credit is payable to cross team**"* · *"in team that have
product side, its also increase **receivable from team that have order**."*
*(§What Make Our Order Unique 1, bullets)*

**Both line kinds produce a cost. What differs is only what the cost is credited against** — and the doc now
says so on both, in both legs:

| the line | debit | credit | the mirror, on the owner's side |
| --- | --- | --- | --- |
| **own** — A's own goods | COGS | **assets** (the inventory that left) | — |
| **cross** — B's goods | COGS | **payable to the cross team** | **receivable from the ordering team** |

Three consequences worth stating once, because everything downstream leans on them:

- **`margin = revenue − COGS − warehouse fee`, on both line kinds.** The payable is the *credit side of the
  COGS*, never a fourth thing to subtract — the order diagram's `o-->cogs` and `o-->loan` are **two legs of
  one entry**, not two charges.
- **The direction is now explicit and it is the borrower's debt that rises** — *payable* on the ordering
  team's books, *receivable* on the owner's. That is the two-mirrored-row model
  [`balance_context.md` §General 2](../balance/context.md) already requires.
- **A cross line has a real cost of goods.** It is not a balance-sheet item parked off the P&L, so a
  borrowed line's margin is not its whole sale price.

```mermaid
flowchart TB
  CS["Customer Service — types it from the marketplace screen"] --> O["an order"]
  API["a selling team's own external app — posts it"] --> O
  O --> S["1 SHOP — which storefront took it, and so which selling team owns it"]
  O --> W["2 WAREHOUSE — which building fulfils it"]
  O --> M["3 MARKETPLACE INFO — the buyer's reference, the one name support can be asked about"]
  O --> P["4 PRODUCT — what was sold, how many, and whose goods they are"]
```

### One order, several owners — what the mixed line-up forces

```mermaid
flowchart TB
  O["one order, taken by Selling Team A"]
  O --> L1["line 1 — A's own product"]
  O --> L2["line 2 — B's product, borrowed"]
  O --> L3["line 3 — C's product, borrowed"]
  L1 --> M1["COGS is the unit price — nobody is owed"]
  L2 --> M2["COGS is unit price plus B's markup — A owes B"]
  L3 --> M3["COGS is unit price plus C's markup — A owes C"]
  M2 --> T["and A may be inside its limit with B<br/>while over it with C"]
  M3 --> T
  T --> Q{"does one blocked line kill the whole order?"}
```

**→ Recommend** state the order's **atomicity** once: an order either goes through whole or not at all.
I would make it **all-or-nothing at creation** — a partly-accepted order is a parcel the buyer did not
order — with the refusal naming *which line* and *why*, so Customer Service can drop that line and retake
it rather than guess.

⚠ **Two doors, one set of rules.** Whatever the manual path checks — the stock reserve, the shared lock,
the debt threshold — the API must check identically, or the API becomes the way around them
([Critique 2](#critique)).

### What each of the four has to carry before a screen can exist

| # | The doc says | What is actually needed, and who can say |
| --- | --- | --- |
| 1 | Shop Related | which selling team owns the sale · is a shop always exactly one team's? |
| 2 | Warehouse Related | **one** warehouse per order, or may lines ship from two? ([Critique 5](#critique)) |
| 3 | Marketplace Order Info | the marketplace's own order id · and whether it is **unique**, which is now the only defence against a double post ([Critique 1](#critique)) |
| 4 | Product Related | quantity, the **frozen** cost per line, and the **owning team** per line — now required rather than merely advisable, since §What Make Our Order Unique lets ownership vary *within* one order |

### The three actors an order passes between

```mermaid
sequenceDiagram
  participant SE as Selling Team or its app
  participant WH as Warehouse Crew
  participant CU as Courier

  SE->>WH: creates the order — stock is committed
  Note over SE,WH: whose stock, and at what cost, is frozen HERE — undecided
  WH->>WH: pick, pack
  WH->>CU: handover
  Note over WH,CU: warehouse custody ends here, per business_level §Warehouse 2
  CU-->>SE: the parcel is the selling team's problem from now on
```

⚠ **Every note above is a proposal, not a reading of the doc** — none of these moments is written down.

---

## Critique

| | Problem | → Recommend |
| --- | --- | --- |
| **1** | **Two entry paths means the same order can be recorded twice, and nothing says what IDENTIFIES an order.** ⚠ §What Make Our Order Unique is about what is *distinctive* about these orders, not about what makes one *tellable from another* — so this is still open, under a heading that now sounds like it answers it. A CS agent types it while the team's app posts it — or the app retries a request whose response was lost. Both produce two orders, two stock commitments, two warehouse fees, and one confused customer. A machine path makes retries routine rather than rare. | Make the **marketplace order id** the thing that identifies an order within a shop, and **refuse a second one** with the same pair. Then a retry is harmless and a double entry is impossible by construction. It also needs an answer for orders with **no** marketplace id (a phone order): I would let those through, since only the machine path retries. |
| **2** | **The API is a second door and the doc does not say it obeys the same rules.** [an-order-is-typed-or-posted](#an-order-is-typed-or-posted) exists to *"speed up record the orders"* — and speed is exactly what makes people route around checks. If the manual path enforces the [reserve](../product/context_clarify.md#reserved-stock-is-never-shared), the [shared lock](../product/context_clarify.md#shared-lock-stops-sharing-entirely) and the [debt threshold](../balance/context_clarify.md#debt-threshold-limits-liability) and the API does not, every one of those controls is optional. | State it once: **every rule is enforced on the order, not on the screen.** And say whether the API may create an order for a **different team** than the one whose credentials posted it — I would say no, ever. |
| **3** | **There is no lifecycle.** An order is created and then nothing. No states, no transitions, no actor moving it. The crew cannot see what to work on next, and the business cannot say when a sale is a sale. | State the **states a person starts and finishes**, so an order being worked on right now looks different from one nobody has touched. My proposal: **placed → picking → packed → handed over → cancelled**, with any later "delivered" fact treated as information *about* the order and not as a state the warehouse owns (see [business_level Contradiction](../business_level_clarify.md#one-sentence-two-endpoints-for-warehouse-responsibility)). |
| **4** | **Nothing says when stock is COMMITTED.** At creation, or when a picker starts? This is the most consequential unanswered question in the requirement set: it decides whether two selling teams can sell the same last unit — and with [reserved-stock-is-never-shared](../product/context_clarify.md#reserved-stock-is-never-shared) now in the doc, it also decides **when the reserve is checked**. A reserve tested at creation and a reserve tested at picking protect different things. | Commit **at creation**, and test the reserve there. It is the only choice that makes "available" mean something to the person taking the order, and its cost — stock held by an order nobody picks — is fixed by cancellation, which you need anyway. |
| **5** | **One order, one warehouse — is that a rule or an accident?** [an-order-carries-four-facts](#an-order-carries-four-facts) names a *warehouse* singular, but [stock-splits-across-warehouses](../business_level_clarify.md#stock-splits-across-warehouses) says a team's goods sit in several. So an order for two products may have no single warehouse holding both. | Make it a stated rule: **one order ships from one warehouse**, and an order that cannot be filled from one is split by whoever takes it. Splitting later, inside the system, means a parcel, a courier fee and a marketplace order id that no longer map one-to-one. |
| **6** | **Cancellation is now drawn — as ONE gate, before the warehouse accepts.** ✅ The *before-acceptance* case is answered: `Is Cancel ? → yes → User Cancel Order → End`, and the user does it. ⚠ **After that gate there is no exit at all.** An order the warehouse has accepted, picked, or packed cannot be cancelled anywhere in the drawn journey — and a buyer cancelling mid-pack is ordinary, not exotic. Goods are then in a tote with no way to say so. | Say whether the single gate is **the rule** or a **simplification of a flow still being drawn** — I am not assuming which. If it is the rule, it is defensible and should be stated as one: *"an order cannot be cancelled once the warehouse has accepted it"*, so everyone can see the cut-off. If it is not, the missing cases are cancel-during-pick (goods return to the shelf) and cancel-after-handover (which is a return, not a cancellation). Either way the money reverses with it — the order fee and the cross charge — which no doc has said yet. |
| **7** | **A partially fillable order has no answer — and [an-order-mixes-own-and-borrowed-lines](#an-order-mixes-own-and-borrowed-lines) makes it two questions, not one.** The picker reaches the shelf and there are 4 of the 5 ordered. Ship 4, hold, or split? A shortfall on an **own** line costs the team its own sale. A shortfall on a **borrowed** line also means the cross charge already computed against another team is now wrong — money that has to shrink, on somebody else's books. | Decide it once, in the doc. **I would ship what is there and record the shortfall on the order** — the buyer is waiting and a held order helps nobody. And state the money half explicitly: **a short-picked borrowed line reduces the charge to that owner to what actually shipped**, which needs the charge to be revisable up to handover, or posted at handover rather than at creation. |
| **8** | **The mixed order is now stated, and §Order Anatomy still does not carry it.** *"Product Related"* is one of the four things an order brings, and it says nothing about **whose goods** each line is — yet §What Make Our Order Unique makes ownership vary *within* one order. Nothing says the owner is **frozen** either, and a product's owner is exactly the sort of thing corrected six months after a sale. | Add it to §Order Anatomy item 4: **every line carries its owning team and its cost, frozen at creation**, never looked up later. A debt must not move when a catalogue is tidied. |
| **11** | **A blocked line has no defined effect on the order — and there are now three ways to block one.** A [shared lock](../product/context_clarify.md#shared-lock-stops-sharing-entirely) is on · the line would break the owner's [reserve](../product/context_clarify.md#reserved-stock-is-never-shared) · the buyer's team is past its [debt threshold](../balance/context_clarify.md#debt-threshold-limits-liability) **with that one owner**. Since one order can borrow from several owners, an order can be simultaneously allowed against B and refused against C. Nothing says whether that kills the order or only the line. | **All-or-nothing at creation**, with the refusal naming the line and the reason. A partly-accepted order is a parcel the buyer did not order, and silently dropping a line is worse than refusing the whole thing — the person taking the order can drop it themselves and retake it. |
| **9** | **Returns are named as a warehouse responsibility and have no doc** — yet `product_context.md` now prices a returned unit back into stock, so a return is already a *pricing* event with no *process* behind it. Nothing says who declares a return, what states it has, whether the unit rejoins sellable stock, or what happens to the money. | A **return context doc**, or a section here. It cannot live as an exception clause in a liability rule plus a formula in the pricing doc — between them they imply a whole process nobody has written down. |
| **10** | **Nothing says what the business must be able to PROVE about an order.** Which buyer, which shop, what was picked, by whom, what it cost, what was charged, which parcel left the building — and now also **which door the order came in by**. Without that, "transparency accounting" ([business_level](../business_level_clarify.md) §covered 3) has no evidence for the most common transaction in the business. | List the facts an order carries **forever**, and mark which are frozen at creation versus recorded as it moves. Frozen: shop, warehouse, lines, their owners, their cost, **its source (typed or API, and by whom)**. Recorded: who picked, who packed, when it was handed over. |
| **13** | **`User Review Order` is the sole control between a machine scan and an order that moves stock and money — and it is unspecified, and it CANNOT FAIL.** The flow has no branch out of review: `Create Draft → User Review Order → User Finalize the Order` runs one way. A reviewer who spots a bad scan has nowhere to go in the drawn process. Nothing says what they are checking, or what they may change — quantities, lines, the shop, the owning team. A review nobody can fail is a rubber stamp, and it is the only defence the machine path has. | Give review a **reject branch** and say what it produces: I recommend *approve · edit-then-approve · discard, with a reason*. And name the short list a reviewer is actually checking — I would make it the fields the rest of the system freezes: **shop, warehouse, lines, quantities, and the owning team of each line**. |
| **14** | **Deduplication is a HUMAN step on one path and ABSENT on the other — and it is absent on the path that retries.** Path 1 opens with *"User Check not recorded order on their own selling platform marketplace"*, which is a person checking by eye. Path 2 has **no equivalent step**: scan → create draft, unconditionally, so a rescan produces a second draft of the same marketplace order. **Nothing in either path is a uniqueness rule** — [Question 1](#question) recommends the marketplace order id refuse a duplicate by construction, and as drawn nothing does. ⚠ **One mitigation, stated fairly:** a duplicate draft still has to pass a human finalize, so it is not unattended — but that relies on someone spotting two identical drafts, possibly reviewed by different people at different times. | Keep the human check as a *convenience* and add the constraint underneath it: **refuse a second order with the same marketplace id in the same shop, at draft creation**. Then the scanner may retry freely and the reviewer never sees a duplicate to miss. |

---

## Question

1. **What IDENTIFIES an order, so a retried API call is refused rather than duplicated** — is it the
   marketplace order id within a shop? *(Not the same question as §What Make Our Order Unique, which
   answers what is distinctive about them.)* ([Critique 1](#critique))
   **→ I recommend the marketplace order id within a shop, and refuse a duplicate.**
2. **What does `User Finalize` ENFORCE, and may an app scan for a team other than its own?** ✅ The
   *"who"* half is closed — Path 2 always drafts and always needs a person, so there is **no unattended
   machine path**. What remains is which rules run at finalize (reserve · shared lock · debt threshold),
   and whose orders an app may create. ([Critique 2](#critique))
   **→ I recommend all three enforced at finalize, and never another team.**
3. **Which boxes in the journey are STATUSES, and may the warehouse decline at `Warehouse Accept Order`?**
   ✅ Largely answered — the sequence is drawn, and my own proposal is deleted in favour of yours. What is
   left is small and specific: the flow mixes activities with two explicit status writes
   (*warehouse process `completed`*, *`shipped`*), so it reads as **two statuses on one order** without
   saying so · and **acceptance implies a refusal nobody has described**.
   ([the-warehouse-accepts-before-it-processes](#the-warehouse-accepts-before-it-processes))
   **→ I recommend one line separating "what a person does" from "what the order holds", and a stated
   ground and outcome for a warehouse declining an order.**
4. **Does a DRAFT touch the MONEY?** ✅ **Two thirds of this question are now closed.** §Order Draft
   says a draft creates no **stock** and no **placement**
   ([a-draft-holds-facts-not-commitments](#a-draft-holds-facts-not-commitments)), and
   [order-created-is-finalize](./context_decision.md#order-created-is-finalize) joined the two flows — so
   *"at creation"* now picks one instant and that instant is `finalize`. **What is left is the financial
   half, which the section does not mention either way:** a payable to a borrowed line's owner · the
   [debt threshold](../balance/context_clarify.md#debt-threshold-limits-liability) · the
   [shared lock](../product/context_clarify.md#shared-lock-stops-sharing-entirely) · the
   [reserve](../product/context_clarify.md#reserved-stock-is-never-shared). ([Critique 4](#critique))
   **→ I recommend NONE of them at draft — no ledger entry, no check — and I think your own section
   already forces it:** a draft holds an *external* SKU, so it has no product, no owner and no cost, and
   none of those four are computable. The cost is honest and small: availability seen while drafting can
   go stale, so **finalize must re-check and may refuse**, which is [Question 5](#question) already.
5. **Does one blocked or unavailable LINE refuse the whole order?** — a lock, a reserve, or a debt
   threshold reached with one of several owners. ([Critique 11](#critique))
   **→ I recommend all-or-nothing at FINALIZE, with the refusal naming the line.**
6. **What happens on a partial pick — and does a short-picked BORROWED line reduce what that owner is
   owed?** ([Critique 7](#critique)) **→ I recommend ship what is there, record the shortfall, and charge
   the owner for what actually shipped.**
7. **Is the cross line's COGS — and so the payable — `UnitPrice + fee`?** The bullets name the legs and not
   the amount; `product_context.md` §Pricing Behavior 2 supplies it and this doc does not repeat or link it.
   ([Contradiction — the residue](#contradiction))
   **→ I recommend saying it here in four words, or linking: the two docs already agree.**
8. **What is `User Review Order` checking, and can it REJECT?** The flow runs one way — review always
   proceeds to finalize — so a reviewer who spots a bad scan has nowhere to go. ([Critique 13](#critique))
   **→ I recommend approve · edit-then-approve · discard-with-a-reason, and a stated checklist: shop,
   warehouse, lines, quantities, and each line's owning team.**
9. **Is the single cancel gate the RULE, or a simplification of a flow still being drawn?** As drawn, an
   order the warehouse has accepted can never be cancelled — no exit exists after that point.
   ([Critique 6](#critique))
   **→ I recommend stating it either way rather than leaving it implied. If it is the rule, say
   "not cancellable once accepted" so the cut-off is visible. And say that cancelling reverses the order
   fee and the cross charge, which no doc has yet.**
10. **Is "Placement" the RACK, or the moment the order is placed?** Beside "Stock" it reads as rack
    placement — but *"frozen at placement"* is the phrase the rest of this system uses for the
    **finalize** moment, so the same word now names both ends of the sentence.
    ([a-draft-holds-facts-not-commitments](#a-draft-holds-facts-not-commitments))
    **→ I recommend saying "rack placement", or dropping the word — "Stock" already covers it.**
11. **Is the external SKU to product mapping REMEMBERED between orders?** A draft keeps *external product
    info*, and somewhere between draft and finalize a person turns that SKU into one of our products.
    Nothing says that answer is kept. If it is not, the same SKU is mapped by hand on **every** order
    forever — which cancels most of what the API path was for, since the scan saves typing and then
    charges it back at review. *(This is the same shape as §What Is Product LinkMap, on a different pair:
    LinkMap bridges product-to-product, this bridges a marketplace SKU to a product.)*
    **→ I recommend remembering it per shop, so a draft arrives pre-mapped and review is a glance rather
    than data entry — with an unrecognised SKU still stopping at a person.**

---

# Contradiction

**Nothing open.** Two contradictions lived here and **both were closed this round by the same edit.**

- *The same money named by its credit side in one doc and its debit side in the other* — `order_context.md`
  now says *"the debit is **COGS**"* on the cross line, which is exactly what
  [`product_context.md`](../product/context.md) §Pricing Behavior 2 supplies a formula
  for (`COGS = UnitPrice + fee`). The two docs now name the **same leg with the same word**, and the second
  leg — the payable — is named only where it belongs. Resolved.
- *The direction of the cross-team debt* — *"increase the debt of team that have product being crossed"* is
  gone, replaced by **payable** on the ordering team's books and **receivable** on the owner's. The
  ambiguity had three readings and the current wording admits only one. Resolved, and in the direction I
  recommended.

Recorded rather than deleted silently, because the *pattern* is the useful part: both were cases of a rule
naming **one leg of a two-leg movement** and a sibling doc naming the other. What stopped it recurring was
stating both legs in the same sentence — the shape §What Make Our Order Unique now uses on every bullet.

**Also resolved: *Customer Service* has a seat** as a role in the selling team
([user_context.md](../user/context.md) §2), not a fifth team.

⚠ **One residue, and it is much smaller than the question it replaces.** The bullets name **what** is
debited and credited and never the **amount**. Is the cross line's COGS — and therefore the payable —
`UnitPrice + fee`, or `UnitPrice` with the fee charged as something separate?
[`product_context.md`](../product/context.md) §Pricing Behavior 2 says the former
(`COGS = UnitPrice + fee`), and nothing here disagrees — but `order_context.md` does not say it either, and
this is the doc a reader building the order will work from. **→ Recommend** the bullet borrow the four words:
*"the debit is COGS (`UnitPrice + fee`)"*, or link to §Pricing Behavior 2. It is a cross-reference, not a
decision — the two docs already agree, which is why this is a residue and not a contradiction.

---

# Awaiting

- **Everything after creation.** The doc now describes how an order arrives and what it holds at that
  instant. Picking, packing, handover, cancellation, partial fulfilment and returns are all absent.
- **The money.** An order triggers at least three of the six balance causes — the warehouse order fee,
  the cross/shared charge, and on cancellation their reversal — and this doc mentions none of them.
- **No mention of the buyer's own shipping or COD**, which is the money that touches an order most
  visibly and is the likeliest home for the *"cover shipping fee"* line that
  [balance_context_clarity](../balance/context_clarify.md#contradiction) still cannot place.
