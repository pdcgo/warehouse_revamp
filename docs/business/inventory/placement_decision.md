# Decisions — `inventory/placement.md`

What the owner settled, recorded before it is acted on. **Append-only** — a decision that is later reversed is renamed
and its references grepped (RULE 12), never quietly edited away. The open set is [placement_clarify.md](./placement_clarify.md).

| decision | says | from |
| --- | --- | --- |
| [a-shelf-never-goes-below-zero](#a-shelf-never-goes-below-zero) | `stock_count` is never below 0, checked by the database; a take that would go below is refused, and order creation returns the error | chat, 2026-10-10 — answers placement Q6a, as recommended |
| [rack-codes-are-saved-lowercase](#rack-codes-are-saved-lowercase) | a rack code is trimmed and lowercased when saved, so one label has one spelling | chat, 2026-10-10 — answers placement Q6b, **against** my uppercase |
| [placements-list-detail-and-move-come-first](#placements-list-detail-and-move-come-first) | the first placement screens are the list, the detail, and a move as an action on the detail; *where is this product* ships with the product page | chat, 2026-10-10 — answers placement Q5 and 3e, as recommended |
| [the-racks-page-is-the-placement-list](#the-racks-page-is-the-placement-list) | the built Racks page is the placement list and Rack detail gets the Move; the screen says *Racks* (*Rak*), the table stays `placements`; the selling team's stub is dropped | chat, 2026-10-10 — answers placement Q7, as recommended |

---

## a-shelf-never-goes-below-zero

> Owner, in chat *(2026-10-10)*: *"for 6a, yes, in order creation, its return error"*. It answers
> [placement_clarify Q6a](./placement_clarify.md#question) — *is `stock_count` never below 0, enforced by the database?* —
> as recommended, and says what the selling team gets when an order is refused: **the error, from order creation**.

**The verdict.** A shelf never holds fewer than zero. A change that would take it below zero is refused, and nothing is
written. When the change is an order's take, the order is not created: order creation rolls back and returns the error.

```mermaid
flowchart LR
  M["a mutation - order, move, broken, lost, rollback"] --> L["lock the shelf rows"]
  L --> Q{"enough on the rack?"}
  Q -->|"yes"| W["write the log row - stock_after is 0 or more"]
  Q -->|"no"| R["refuse - Rak A holds 1, 3 asked"]
  R --> O["order creation rolls back and returns the error"]
  W -.->|"a mutation that forgot to check"| C["CHECK stock_count >= 0 fails the transaction"]
```

**The spec.**

| | |
| --- | --- |
| `product_placements.stock_count` | `CHECK (stock_count >= 0)` — the backstop: a future mutation that forgets to check fails instead of writing −1 |
| the mutation | locks the shelf rows ([batches-lock-before-shelves-by-id](./context_decision.md#batches-lock-before-shelves-by-id)), compares, and refuses with an error naming the rack and what it holds — before the database check would fire |
| `PostOrder`, too few across all racks | fails and writes nothing; [order creation](../order/order_creation.md) rolls back its own transaction and **returns the error** to the caller |
| a move · broken or lost · a rollback | refused the same way |
| a count | unaffected — it writes the real number, which is never negative |
| `product_placement_logs.stock_after` | 0 or more, as a consequence |

**What it does NOT settle** — the batch side: the same check on `batches.stock_count` belongs to
[batch.md](./batch.md), and sits with [context Q14a](./context_clarify.md#question) · whether a rollback that would go below
zero is refused, or corrected some other way — the rack half is now forced, the batch half is
[transaction Q4](./transaction_clarify.md#question).

## rack-codes-are-saved-lowercase

> Owner, in chat *(2026-10-10)*: *"for 6b, no, make always lowercase"*. It answers
> [placement_clarify Q6b](./placement_clarify.md#question) — *are codes compared after trimming spaces and ignoring case?* —
> by cleaning the code when it is saved, as I offered, but **lowercase, against my uppercase**.

**The verdict.** One label painted on one shelf has one spelling in the system. A code is cleaned once, when it is saved,
so every screen, pick list and lookup reads the same text, and a plain `=` compares it.

```mermaid
flowchart LR
  T["typed - ' A-01 '"] --> TR["trim the ends - 'A-01'"]
  TR --> LO["lowercase - 'a-01'"]
  LO --> S["stored"]
  T2["typed later - 'a-01'"] --> LO2["cleaned - 'a-01'"]
  LO2 -->|"same code, same warehouse"| D["refused as a duplicate"]
```

**The spec.**

| | |
| --- | --- |
| on save (create, edit) | trim the ends, then lowercase |
| on lookup (a search, a typed code) | the input is cleaned the same way, then compared with plain `=` |
| unique | `(warehouse_id, code)` among racks with no `deleted_at` — a plain index, because the stored value is already clean |
| backstop | `CHECK (code = lower(btrim(code)))`, so a writer that skips the cleaning fails instead of storing a second spelling |
| shown | as stored — `a-01` |
| untouched | the inner characters: `a 01`, `a-01` and `a01` stay three codes, because the painted label is the label · `name`, which is free text |

**What it does NOT settle** — ⚠ the build today stores codes as typed, with a case-sensitive index. Moving to this rule
lowercases the existing codes, and two that differ only by case (`A-01` and `a-01` in one warehouse) collide: they must be
merged or renamed before the migration runs.

## placements-list-detail-and-move-come-first

> Owner, in chat *(2026-10-10)*: *"for q5 yes i follow your recomendation"*. It answers
> [placement_clarify Q5](./placement_clarify.md#question) (which screens, and which come first) as recommended. The
> accepted table put the move on Placement detail, so it answers **3e** (where a move happens) too.

**The verdict.** Each placement job gets one screen, tied to the person who does it (HARD RULE 6). Three come first: the
list, the detail, and the move. A move is an action on the rack's own page, not a page of its own, because whoever
moves goods is already looking at the rack they are taking from.

```mermaid
flowchart LR
  L["Placements - list, create, edit, delete"] -->|"click a rack"| D["Placement detail - products, counts, log"]
  D -->|"Move action"| M["Move dialog - product, quantity, target rack"]
  M -->|"writes the move"| D
  P["product warehouse page - later"] -.->|"where is this product"| D
  R["restock accept - built"] -.->|"put-away"| D
```

**The spec.**

| job | who | screen | when |
| --- | --- | --- | --- |
| set up racks | warehouse admin | **Placements**: a list, with create, edit and delete | **first** |
| see what is on a rack | staff | **Placement detail**: its products with their counts, and its log | **first** |
| move goods | staff | **Move**: a dialog opened from Placement detail (product, quantity, target rack). Not a page | **first** |
| find where a product is | staff, picker | a section on the product's warehouse page | ships **with the product page** |
| put goods away at accept | staff | restock-accept | ✅ already built |

**What it does NOT settle.**
- The big number on Placement detail, the book count or what is physically there: [Q4](./placement_clarify.md#question).
- What a move writes, who may do one, and moving many products at once: [Q3a–c](./placement_clarify.md#question).
- ⚠ The build already has two of the three screens, under another name: **Racks** (`inventories/racks`: list, create,
  edit, delete) and **Rack detail** (stock, plus two history tabs), both in the warehouse menu. There is no Move action
  yet. `inventories/placements` is an empty stub in the **selling** team's menu. What to call the screens, and whether
  the stub stays: [Q7](./placement_clarify.md#question).

## the-racks-page-is-the-placement-list

> Owner, in chat *(2026-10-10)*: *"i follow your recomendation"*, quoting the recommendation in full. It answers
> [placement_clarify Q7](./placement_clarify.md#question) (the decided list already exists under another name, and the
> decided name sits on an empty page for the wrong team) as recommended.

**The verdict.** The screens named in
[placements-list-detail-and-move-come-first](#placements-list-detail-and-move-come-first) are the ones already built.
Nothing new is started for the list or the detail; the Move is added to Rack detail. On screen they are called by the word
staff use at the shelf, *"Rak A"*, and the schema keeps its own word. A selling team never reads a rack, so the empty
Placements page in its menu goes.

```mermaid
flowchart LR
  subgraph "decided as"
    PL["Placements list"]
    PD["Placement detail"]
    MV["Move"]
  end
  subgraph "built as"
    RL["Racks - inventories/racks"]
    RD["Rack detail - inventories/racks/:rackId"]
    RM["Move dialog on Rack detail - to build"]
  end
  PL --> RL
  PD --> RD
  MV --> RM
  ST["selling menu - Placements stub"] -->|"dropped"| X["gone"]
```

**The spec.**

| | |
| --- | --- |
| the list | `inventories/racks`, warehouse menu only, as built: list, create, edit, delete |
| the detail | `inventories/racks/:rackId`, as built; the Move is added here as a dialog (product, quantity, target rack) |
| the word on screen | **Racks** in English, **Rak** in Indonesian, for the menu, the titles and the buttons |
| the word in the schema | `placements`, `product_placements`, `product_placement_logs`, as [placement.md](./placement.md) names them |
| the selling team's `inventories/placements` | dropped: the menu entry, the route, the page and its copy |

**What it does NOT settle** — the Move's behaviour, which waits on [Q3a–c](./placement_clarify.md#question) · the count shown
on Rack detail, [Q4](./placement_clarify.md#question) · the word *placement* inside other screens (a batch's *Placements*
tab, a rack's *Placement history*), which names the act of placing rather than the screen, so it stays.
