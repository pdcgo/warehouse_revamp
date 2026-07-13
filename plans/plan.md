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

> **⚠ THIS IS THE FOUNDATION AND IT IS EMPTY. Nothing below can be designed until this is
> filled in — by the owner, from the actual operation.**

### 1.1 The people

| Role | What they physically do all day | Where they stand | What device is in their hand |
| --- | --- | --- | --- |
| _?_ | _?_ | _?_ | _?_ |

### 1.2 The jobs (the physical tasks)

For each: who does it, what triggers it, what they touch, what can go wrong.

- [ ] **Goods arrive** — a delivery shows up at the door. Then what?
- [ ] **Goods get put away** — do they go to a specific place? Who decides where?
- [ ] **An order needs picking** — how does a person know what to pick and where it is?
- [ ] **Packing** — what gets checked? what gets printed?
- [ ] **Handover to courier** — what's recorded?
- [ ] **Counting / stock-take** — how often, who, how is it reconciled?
- [ ] **Something comes back (return)** — what happens to it?
- [ ] **Goods move between warehouses** — does this happen?
- [ ] _(what's missing from this list?)_

### 1.3 The physical facts

- [ ] How many warehouses? How big? How many racks/locations?
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
