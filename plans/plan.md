# Brainstorming — `warehouse_revamp`

> A **completely new** warehouse system. Clean slate.
> Nothing here is implemented. Nothing is decided until it's in the decision log below.

> **Decisions so far**
> - **Total rethink and rewrite.** Not a refactor, not a migration. (owner, 2026-07-13)
> - **CLEAN SLATE — no legacy concepts at the starting point.** We do **not** design from the
>   prior internal systems. Their models, their statuses, their service split, their screens are
>   **not inputs**. We design from the real warehouse and the real people in it.
>   (owner, 2026-07-13)
> - **Frontend first.** We design the experience, and let the screens dictate the API and
>   the data model — not the reverse. (owner, 2026-07-13)
> - **Proto + Connect RPC** is the contract. (owner, 2026-07-13)
> - **The contract lives in ONE place** — a single buf module at `proto/`, one `buf generate`
>   emitting the Go stubs and the TS client together. Domain separation comes from
>   directories, evolution from proto package versions (`v1`→`v2`) — not from splitting the
>   module. Rationale: with per-service buf modules, any shared type creates a
>   publish-ordering + version-pin dance, and cross-cutting changes (the *normal* change in
>   this domain) become the expensive ones; clients would also take N dependencies instead of
>   one. Revisit only if outside teams ever need to pin one domain independently of another.
> - **Repo layout: `frontend/` + `backend/` + `proto/`.** (owner, 2026-07-13)
> - **HARD RULE — every service implementation lives in `./backend/services/<service_name>/`**,
>   one directory per service. (owner, 2026-07-13)
> - **HARD RULE — brainstorming lives in `./plans/<service_name>/brainstorming.md`**, one
>   directory per service, mirroring `backend/`. A service is designed in its doc before it
>   is built. (owner, 2026-07-13)
> - **HARD RULE — models and migrations are PER SERVICE**, to keep services independent:
>   `backend/services/<svc>/<svc>_models/<model>.go` and `backend/services/<svc>/db_migrations/`.
>   Migration tool: **goose**. No shared model package, no global migration set.
>   (owner, 2026-07-13 — see [plan_service.md](plan_service.md))
> - _(everything else is open)_

---

## 0. The ground rule

The old systems exist and still run. That's an operational fact, not a design input.
When we later need to *replace* them we'll deal with migration — but **at this stage no
proposal is allowed to justify itself with "that's how it works today"**.

The only legitimate sources of truth right now:
1. **What physically happens in the warehouse** — goods, racks, people, boxes, couriers.
2. **Who the people are** and what they're trying to get done.
3. **What the business needs to know** (stock, money, accountability).

Everything else we invent fresh.

---

## 1. The real world — what actually happens in the warehouse

> **⚠ THIS IS THE FOUNDATION AND IT IS MOSTLY EMPTY. Nothing below can be designed until it is
> filled in — by the owner, from the actual operation.**
>
> **Update (2026-07-20): it is filling in sideways.** Four of §1.2's jobs are now answered, and none of
> them were answered by anyone sitting down to write this section — each was settled by the owner when
> a screen forced the question and would not build without it (the #134 family). That turns out to be
> a workable way to fill this in: **ask the §1 question the next screen actually needs, not the whole
> section at once.**
>
> **What is still blocked by what is left.** The order/fulfilment run (#69–#78, ten issues, the whole
> Ready column) waits on the *unticked* boxes below — principally **picking**, **packing**, **courier
> handover**, and **returns**. Those four are the warehouse half of an order's life, and no amount of
> selling-side work substitutes for them.

### 1.1 The people

| Role | What they physically do all day | Where they stand | What device is in their hand |
| --- | --- | --- | --- |
| _?_ | _?_ | _?_ | _?_ |

### 1.2 The jobs (the physical tasks)

For each: who does it, what triggers it, what they touch, what can go wrong.

> **Four of these are now ANSWERED — not in the abstract, but by owner decisions made when a screen
> forced the question** (the #134 family, 2026-07-17/20). They are recorded here because this section
> is the foundation the order/fulfilment work (#69–#78) is blocked on, and a decision that lives only
> in an issue thread cannot unblock anything. Ticked = decided and built; unticked = still open.
>
> Detail and reasoning for each live in `plans/inventory_service/brainstorming.md` §3/§4.

- [x] **Goods arrive** — a delivery shows up at the door. Then what? → **The warehouse COUNTS it**
      (#133). Accepting a restock is a count, not a confirmation: staff open the box and record how
      many of each line actually turned up. A short delivery is ordinary and still completes the
      request; both the asked-for and the arrived quantity are kept, because the gap is what someone
      chases the supplier about. Stock receives *the count*, never the promise.
- [x] **Goods get put away** — do they go to a specific place? Who decides where? → **Yes, a rack, and
      the person counting decides** (#137). Put-away is part of accepting: the warehouse names the
      shelf as it counts, in one step, so nothing routinely sits unplaced. Stock that has arrived but
      is not yet shelved is a real state ("unplaced"), and #136 is how it gets shelved later or moved
      shelf-to-shelf.
- [x] **An order needs picking** — how does a person know what to pick and where it is? → **ONE ORDER
      AT A TIME** (owner, 2026-07-20). A picker takes a single order, walks to the shelves it needs,
      collects it, packs it. Not batch picking — no collecting for several orders in one trip and
      sorting them at a bench.
      - **This maps straight onto what already exists**: the order names its lines, and #135–#138 know
        which shelf each product sits on, so "here is the order, here is where each line lives" needs
        no new model — only a screen. That is #71.
      - Batch picking was considered and not chosen: far more efficient at volume, but it needs a
        sorting step and guards against one order's goods being confused with another's. Worth
        revisiting when volume demands it; the per-order data does not change if it is.
- [ ] **Packing** — what gets checked? what gets printed?
- [ ] **Handover to courier** — what's recorded?
- [x] **Counting / stock-take** — how often, who, how is it reconciled? → **It counts a SHELF** (#139).
      Someone stands at A-01-3, counts what is on it, and corrects *that place*; the correction is an
      ADJUST movement in the ledger naming the shelf, so it is auditable. Warehouse owners/admins do
      it. **How often is still open** — nothing schedules or prompts a stock-take today.
- [ ] **Something comes back (return)** — what happens to it?
- [x] **Goods move between warehouses** — does this happen? → **Yes** (`StockTransfer`, a manager
      action): stock leaves one warehouse and enters another, atomically, as two ledger legs. Moving
      stock *within* one warehouse is a different act with its own kind (#136).
- [ ] _(what's missing from this list?)_

### 1.3 The physical facts

- [ ] How many warehouses? How big? How many racks/locations?
      *(Partly answered: **racks are real and labelled** — a warehouse writes down its shelves by the
      code painted on them (#129), and stock is counted per shelf (#135). The counts — how many
      warehouses, how many racks — are still unknown.)*
- [ ] How many SKUs? How many orders a day?
- [ ] How many people working at once?
- [ ] **Is anything labelled with a barcode/QR today?** Products? Racks? Boxes? Orders?
- [ ] What is the single most **time-wasting** thing a worker does today?
- [ ] What is the single most **common mistake** that costs money?

### 1.4 What the business must know

- [ ] What questions does the owner/ops ask the system every day?
- [ ] What has to be true for money to be correct?

---

## 2. The experience (design starts here)

Once §1 is real, we design the UI **for the jobs**, not for the tables.

**Working principle:** a screen exists because a *person doing a task* needs it. If we can't
name the person and the moment, the screen doesn't get built.

### 2.1 Open — the shape of the frontend

| Question | Why it matters |
| --- | --- |
| **One app, or an operator app + a back-office app?** | The person picking goods and the person reconciling money are different people, on different devices, with different success metrics (seconds-per-task vs. correctness-of-a-form). Designing one UI for both usually serves neither. |
| **What device is in the operator's hand?** | Phone/PWA (camera scanner) · handheld terminal (hardware scanner, keyboard-wedge) · desktop + USB barcode gun at the bench · plain desktop. This decides the entire interaction model. |
| **Scan-first or type-first?** | If the warehouse has (or can have) barcodes, scanning is 10× faster and near-zero error. If not — should we introduce labelling? That's a *physical process* decision, and the highest-leverage one available. |
| **Density** | An operator console lives or dies on how much is visible at a glance. Whatever component library we choose, we commit to a sizing scale on day one and enforce it. |

### 2.2 Open — the stack

Not decided. Candidates and what each buys us — to be argued once §1 and §2.1 are answered.
(The choice should follow the device and density answers, not precede them.)

---

## 3. The system behind it

Deliberately **after** §1 and §2. The data model falls out of the screens; the screens fall
out of the jobs.

Nothing to write here yet.

---

## 4. Open questions

- [ ] **§1 — the entire section.** Owner input required; nothing proceeds without it.
- [ ] Who is the operator, on what device, and is anything barcoded today?
- [ ] Operator app + back-office app, or one app?
- [ ] What's in scope — just the warehouse, or the money/selling side too?
- [ ] What must this system be able to do that no current system can?

---

## 5. Session log

- **2026-07-13** — Owner: *"totally need rethink and rewriting new version"*.
- **2026-07-13** — Owner: *"first we talk about frontend"*.
- **2026-07-13** — Owner: *"dont bring all legacy concept of legacy at this starting point,
  we build completely new"* → the doc was reset to first principles; all legacy-derived
  content removed. Old repos are now **reference only, and only when explicitly invoked**.

---

## Appendix — the old systems (reference only, NOT a design input)

Prior internal systems exist operationally (the current Go/React platform, and older warehouse
apps before it). They are **reference only** and are **not** a design input — see the clean-slate
ground rule. Details are kept out of this public doc deliberately.

If and when we need to *replace* them, migration/cutover becomes a real chapter. Not now.
