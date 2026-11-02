# Decisions — `business_level.md`

What the owner decided about [business_level.md](./business_level.md), recorded before it is acted on. **Append-only**
— the opposite lifecycle to [business_level_clarify.md](./business_level_clarify.md), which holds only what is still
open. Earlier answers to this doc's questions live in the context that could answer them, linked from the clarify.

| | |
| --- | --- |
| [transparency-is-every-charge-traceable](#transparency-is-every-charge-traceable) | *transparency accounting* means: every charge a team bears shows what caused it, its frozen amount and who recorded it — never overwritten |
| [a-team-has-exactly-one-type](#a-team-has-exactly-one-type) | a team is exactly one type — root, admin, warehouse or selling; a person may span types |
| [placement-is-a-context-of-its-own](#placement-is-a-context-of-its-own) | §Warehouse 8 promotes placement: it is a context of its own, `inventory/placement.md` |

---

## transparency-is-every-charge-traceable

> Owner, in chat (2026-10-31): *"yes"* — to [Q5](./business_level_clarify.md#question), *what does "transparency
> accounting" have to prove, and to whom?*, on the claim recommended. As recommended.

**The verdict.** §covered 3, *"provide transparency accounting"*, means one testable claim:

> Any team can see, for every charge against it, **the event that caused it**, **the amount frozen at that moment**, and
> **who recorded it** — even when that person is not on their team. Nothing is overwritten; a correction is a new row.

**To whom:** each team, about the money between it and every other team — not the owner reading the whole business,
which the metrics already serve.

```mermaid
flowchart LR
  C["a charge on team A's balance"] --> E["what caused it - an order, a restock, a payment"]
  C --> M["the amount, frozen when it happened"]
  C --> P["who recorded it - even from another team"]
  C --> N["never overwritten - a correction is a new row"]
```

| the claim's part | where it is decided | built |
| --- | --- | --- |
| the cause | the log's `source_type` / `source_id` | ✅ [liability_log.go](../../backend/services/liability_service/liability_service_models/liability_log.go) |
| the frozen amount | [the-ledger-charges-the-frozen-line-total](../technical/balance/team_balance_design_decision.md#the-ledger-charges-the-frozen-line-total) | ✅ |
| who recorded it | [every-entry-names-who-posted-it](../technical/balance/team_balance_design_decision.md#every-entry-names-who-posted-it) | ✅ `actor_id` |
| both teams see it | [the-pair-detail-shows-both-logs](../technical/balance/team_balance_design_decision.md#the-pair-detail-shows-both-logs) | ✅ |
| never overwritten | append-only logs ([ledger-logs-are-append-only](../technical/ledger/mutation_and_ledger_decision.md#ledger-logs-are-append-only)); an expense corrected by a new row ([every-correction-is-a-signed-adjustment](./analytic/context_decision.md#every-correction-is-a-signed-adjustment)) | ⛔ the expense correction is not built — `ExpenseUpdate` still overwrites |

**What follows:** a new kind of charge between teams owes this claim — a cause, a frozen amount, an actor, both sides'
view — or it is not transparent by the project's own definition.

## a-team-has-exactly-one-type

> Owner, in chat (2026-11-02): *"i follow your recomendation"* — confirming the overtaken list, which named [Q3](./business_level_clarify.md#question), *can a
> TEAM be two types?*

**The verdict.** No: a team has **exactly one type** — root, admin, warehouse or selling. A person may belong to teams of
different types (`user_context.md` §General), but each team is one of them. The schema holds one `type` per team, and
the menu is built from it.

```
team 7     type = warehouse                                  one value, never two
Ani        a member of team 7 (warehouse) and team 12 (selling)   a person may span types
```

| | |
| --- | --- |
| ✅ built | nothing changes |

## placement-is-a-context-of-its-own

> Owner, in chat (2026-11-02): *"i follow your recomendation"* — confirming the overtaken list, which named [Q6](./business_level_clarify.md#question), *is
> §Warehouse 8 a promotion of placement to a first-class capability, or a restatement of §Warehouse 4?*

**The verdict.** A promotion. Placement is a context of its own — [placement.md](./inventory/placement.md), yours — so
§Warehouse 8, *"manage placements of the stocks"*, is the warehouse's job naming it. §Warehouse 4's *"warehouse managing
phisique of goods and placement of goods"* stands beside it; how the two lines read is your doc's wording, not a question.

```mermaid
flowchart LR
  W["the warehouse team"] --> P["placement, its own context"]
  P --> D["inventory/placement.md"]
```

| | |
| --- | --- |
| ✅ built | nothing changes |
