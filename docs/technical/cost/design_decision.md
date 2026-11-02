# Decisions — `design.md`

What the owner decided about [design.md](./design.md), recorded before it is acted on. **Append-only** — the opposite
lifecycle to [design_clarify.md](./design_clarify.md), which holds only what is still open.

| | |
| --- | --- |
| [an-operating-cost-is-an-expense-row](#an-operating-cost-is-an-expense-row) | the `costs` / `cost_logs` ledger was never built: a cost is an `expense_records` row, paid when entered, so no balance is kept |

---

## an-operating-cost-is-an-expense-row

> Owner, in chat (2026-11-02): *"i follow your recomendation"* — confirming the overtaken list, which named [Q1](./design_clarify.md#question), *cumulative or
> outstanding?*, and [Q2](./design_clarify.md#question), *how does this relate to the team balance?*

**The verdict.** Neither. The `costs` / `cost_logs` ledger this doc sketches was **never built**. An operating cost is an
**`expense_records`** row, entered by a person and paid from the account it names
([an-expense-must-name-the-account-that-paid](../../business/financial_account/context_decision.md#an-expense-must-name-the-account-that-paid)).
Nothing is owed, so nothing is outstanding, and a total spent is a sum of rows, not a balance. A mistake is a new row,
never an edit ([an-expense-is-never-edited](../../business/analytic/context_decision.md#an-expense-is-never-edited), ⛔ not
built yet). And a cost never moves a team balance:
[an-operating-cost-never-moves-a-team-balance](../../business/balance/context_decision.md#an-operating-cost-never-moves-a-team-balance).

```
the doc's sketch          what exists
costs, one per team       — never built
cost_logs                 expense_records — one row per cost, on one team
```

| | |
| --- | --- |
| `balance`, cumulative or outstanding | neither — no balance is kept |
| the total spent | the sum of `expense_records` over the range |
| a correction | a new row, never an edit (decided, not built) |
| ✅ built | nothing to build |
