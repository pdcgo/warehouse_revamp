# Acceptance — inventory / restock

Business: [restock.md](../../business/inventory/restock.md) · rules: [guide.md](../guide.md)

| given | when | then | status |
| --- | --- | --- | --- |
| `selling:all` wants to restock<br>(1 product) | create restock | restock created | ✅ ok |
| | | recorded at warehouse | ✅ ok |
| | | ongoing stock increases | ✅ ok |
| | | paying account balance decreases | ✅ ok |
| | | recorded in account history | ✅ ok |
| `selling:all` wants to restock<br>(2 products) | create restock | restock created with 2 products | ✅ ok |
| | | recorded at warehouse, both products | ✅ ok |
| | | ongoing stock of product 1 and product 2 increases | ✅ ok |
| | | paying account balance decreases by both products | ✅ ok |
| | | recorded in account history | ✅ ok |
| `selling:all` wants to restock<br>(with shipping cost) | create restock | restock created with shipping cost | ✅ ok |
| | | recorded at warehouse | ✅ ok |
| | | ongoing stock increases | ✅ ok |
| | | paying account balance decreases, shipping cost included | ✅ ok |
| | | recorded in account history | ✅ ok |
| `warehouse:all` wants to receive a restock<br>(from ongoing) | mark arrived restock | status changed from ongoing to arrived | ✅ ok |
| | | receiver and time recorded | ✅ ok |
| `warehouse:all` wants to receive a restock<br>(from lost) | mark arrived restock | status changed from lost to arrived | ✅ ok |
| | | receiver and time recorded | ✅ ok |
| `warehouse:all` wants to receive a restock<br>(set courier charge) | mark arrived restock | courier's charge recorded on restock | 🚧 unimplemented |
| `warehouse:all` wants to accept a restock<br>(from arrived) | accept restock | status changed from arrived to accepted | ✅ ok |
| | | ready stock increases | ✅ ok |
| | | ongoing stock decreases | ✅ ok |
| | | units on rack | ✅ ok |
| | | price set on batch | ✅ ok |
| `warehouse:all` wants to accept a restock<br>(from ongoing) | accept restock | status changed from ongoing to accepted | ✅ ok |
| | | ready stock increases | ✅ ok |
| | | ongoing stock decreases | ✅ ok |
| | | units on rack | ✅ ok |
| | | price set on batch | ✅ ok |
| | | receiver and time recorded | ✅ ok |
| `warehouse:all` wants to accept a restock<br>(has brokens, thrown away) | accept restock | status changed from ongoing to accepted | ✅ ok |
| | | ready stock increases, broken excluded | ✅ ok |
| | | broken items recorded | ✅ ok |
| `warehouse:all` wants to accept a restock<br>(has brokens, put on rack) | accept restock | broken items on rack | 🚧 unimplemented |
| `warehouse:all` wants to accept a restock<br>(has missing items) | accept restock | status changed from ongoing to accepted | ✅ ok |
| | | ready stock increases, missing excluded | ✅ ok |
| | | missing items recorded | ✅ ok |
| `warehouse:all` wants to accept a restock<br>(product new to warehouse) | accept restock | product listed in target warehouse | ✅ ok |
| `warehouse:all` wants to accept a restock<br>(product already listed) | accept restock | product not listed again | ✅ ok |
| `warehouse:all` wants to accept a restock<br>(set courier charge) | accept restock | courier's charge recorded on restock | ✅ ok |
| | | courier's charge recorded in liability | ✅ ok |
| `warehouse:all` wants to accept a restock<br>(1 supplier) | accept restock | recorded at supplier | ✅ ok |
| `warehouse:all` wants to accept a restock<br>(multi suppliers) | accept restock | recorded at supplier | [❌ error](#a-multi-supplier-restock-is-recorded-at-no-supplier) |
| `selling:all` wants to edit a restock<br>(ongoing) | edit | restock shows changes | ⬜ untested |
| `selling:all` wants to edit a restock<br>(arrived) | edit | restock shows changed lines | ⬜ untested |
| | | restock shows added product | ⬜ untested |
| | | ongoing stock follows new count | ⬜ untested |
| | | target warehouse sees new lines | ⬜ untested |
| `selling:all` wants to edit a restock<br>(amount changed) | edit | paying account balance follows difference | ⬜ untested |
| | | edit recorded in account history | ⬜ untested |
| `selling:all` wants to edit a restock<br>(account changed) | edit | payment moves to new account | ⬜ untested |
| `selling:all` wants to edit a restock<br>(warehouse changed) | edit | recorded at new warehouse | ⬜ untested |
| | | removed from old warehouse | ⬜ untested |

## Not discussed yet

These are the restock actions the system performs today, read from
[restock_request.proto](../../../proto/warehouse/inventory/v1/restock_request.proto). Each one's given + when is settled
only when it is discussed, so the states below are a starting point, not a decision.

| given | when |
| --- | --- |
| `selling:all` wants to cancel a restock<br>(ongoing) | cancel ← next |
| `selling:all` wants to report a lost restock<br>(ongoing) | set lost |

## Errors

### a-multi-supplier-restock-is-recorded-at-no-supplier

| | |
| --- | --- |
| then | `warehouse:all` wants to accept a restock (multi suppliers) · accept restock · recorded at supplier |
| expected | each line is recorded at its own supplier |
| actual | the restock is recorded at **no** supplier: neither supplier's Statistics shows its products. The goods still enter ready stock, and the accept itself succeeds |
| cause | supplier_service records a restock under ONE supplier for the whole restock. When the lines name different suppliers, that supplier is 0, and the restock is skipped ([restock_accepted_event.go](../../../backend/services/inventory_service/inventory_v1/restock_accepted_event.go#L146), [analytic_fold.go](../../../backend/services/supplier_service/supplier_v1/analytic_fold.go#L140)) |
| seen | the owner's check on the dev data (2026-11-11), and the e2e run for every warehouse role |
| check | `warehouse:all accept restock (multi suppliers)` in [restock.spec.ts](../../../frontend/e2e/restock.spec.ts), marked `test.fail` until this is fixed |
