# Clarify — `inventory/adjustment.md`

[adjustment.md](./adjustment_decision.md#adjustment-md-is-retired) is yours, and this file is mine. When a point is answered I delete it here, and your
answer goes in an `adjustment_decision.md` beside it.

> 🆕 **Opened 2026-10-16:** you chose to keep `StockAdjust` and the one-rack `StockOpname` working through the cut-over,
> ported onto the ledgers **provisionally**
> ([old-shelf-corrections-move-onto-the-ledgers-provisionally](../../technical/stock/design_decision.md#old-shelf-corrections-move-onto-the-ledgers-provisionally)).
> Your adjustment.md is still empty, so every choice the port had to make is listed below — confirm or reverse each.
> Until then the port keeps today's behaviour wherever today had one.

## Proposed Design

The port, per reason. Every call writes `adjustment` transactions — one per owning team — and both ledgers move the
same units (both-ledgers-count-the-same-units).

```mermaid
flowchart TB
  R["recount - one product, one rack, the counted number"] --> D{"counted vs the rack"}
  D -->|"short"| S["take off the rack, and off the owner's batches oldest first"]
  D -->|"over"| O["onto the rack, and mint a batch at the owner's newest price here"]
  D -->|"equal"| Z["a 0 rack row - so the rack reads as counted"]
  B["damaged or lost - a named batch, a rack, a count"] --> T["take off that batch and that rack"]
  F["found - a named batch, a rack, a count"] --> A["back into that batch at its price, onto that rack"]
```

| call | ledgers | money — unchanged from today |
| --- | --- | --- |
| `StockAdjust` recount | as drawn above | ✅ built 2026-11-02 (`inventory_v1/stock_adjust.go`, recount branch): a shortfall is written off and owed ([a-recount-shortfall-is-written-off-and-owed](./adjustment_decision.md#a-recount-shortfall-is-written-off-and-owed)) |
| `StockAdjust` damaged / lost | the named batch, value at its share | written off to expense after commit; the owner is owed it, inside the transaction |
| `StockAdjust` found | the named batch, at its `price_unit` | the owner's debt given back; no expense |
| `StockOpname` (one rack, many lines) | each line is a recount; one transaction per owning team | the shortfall written off (one expense for the rack) and owed to each owner |
| unplaced | refused — every unit is on a rack ([there-is-no-unplaced-pile](./restock_decision.md#there-is-no-unplaced-pile)) | — |

## Critique

### A recount's surplus has no batch to land in

Today a surplus is added to the oldest batch on the shelf, at no value. The ledgers have no units without value.

**→ Recommend:** mint one batch at the owner's newest batch price in this warehouse (0 when it has none) — the rule a
found surplus already follows ([last-price-is-the-teams-newest-batch-here](./opname_decision.md#last-price-is-the-teams-newest-batch-here)).

### The same loss still moves money or not depending on the screen

A recount through `StockAdjust` books nothing; the same shortfall found by `StockOpname` is written off and owed. This
was true before the port, and the port keeps it.

**→ Recommend:** book both, as `StockOpname` does — a missing unit costs the same whichever screen counted it.

### Damaged, lost and found name a batch; the decided problem and found do not

Today a person picks the batch. The decided `problem` and `found` transactions (problem-and-found-replace-opname) take
and claim by rule, not by choice.

**→ Recommend:** keep the named batch until adjustment.md says otherwise — these are provisional, and changing who
chooses the batch changes the screen.

## Recommendation

Confirm the port as drawn, with the surplus minted at the newest price and the recount booking its loss.

## Question

1. ✅ *(2026-10-31)* **Withdrawn** — the port is not refined further: [the-finished-count-comes-next-not-a-refined-port](./adjustment_decision.md#the-finished-count-comes-next-not-a-refined-port).
2. ✅ *(2026-10-31)* **Answered: yes** — [a-recount-shortfall-is-written-off-and-owed](./adjustment_decision.md#a-recount-shortfall-is-written-off-and-owed). ✅ Built 2026-11-02. Kept as a line so the numbers hold.
3. ✅ *(2026-10-31)* **Withdrawn** — the same: [the-finished-count-comes-next-not-a-refined-port](./adjustment_decision.md#the-finished-count-comes-next-not-a-refined-port).
4. ✅ *(2026-10-31)* **Withdrawn** — the same: [the-finished-count-comes-next-not-a-refined-port](./adjustment_decision.md#the-finished-count-comes-next-not-a-refined-port).

# Contradiction

## a-recount-books-money-on-one-screen-only

✅ **Resolved 2026-10-31** by [a-recount-shortfall-is-written-off-and-owed](./adjustment_decision.md#a-recount-shortfall-is-written-off-and-owed):
a recount shortfall is written off and owed, as a stock count is. ✅ Built 2026-11-02. Kept as a heading so the links
into it hold.
