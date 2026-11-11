# Acceptance — inventory / restock

Business: [restock.md](../../business/inventory/restock.md) · rules: [guide.md](../guide.md)

| given | when | then | status |
| --- | --- | --- | --- |
| `selling:all` | create restock | restock is listed as ongoing (1 product) | ✅ ok |
| | | restock is listed as ongoing (2 products) | ✅ ok |
| | | restock is listed as ongoing (with shipping cost) | ✅ ok |
| | | the target warehouse has it incoming | ✅ ok |
| | | ongoing stock increases | ✅ ok |
| | | paying account balance decreases | ✅ ok |
| | | the restock is recorded in the account history | ✅ ok |
| `warehouse:all` | mark arrived | restock is listed as arrived (from ongoing) | ✅ ok |
| | | restock is listed as arrived (from lost) | ✅ ok |
| | | the seller sees it arrived | ✅ ok |
| | | who received it and when is recorded | ✅ ok |
| | | the courier's charge is recorded on the restock (if noted) | 🚧 unimplemented |
| `warehouse:all` | accept | restock is listed as accepted (from arrived) | ✅ ok |
| | | restock is listed as accepted (from ongoing) | ✅ ok |
| | | the seller sees it accepted | ✅ ok |
| | | ready stock increases | ✅ ok |
| | | ongoing stock decreases | ✅ ok |
| | | the units are on the rack | ✅ ok |
| | | the price is set on the batch | ✅ ok |
| | | product is listed in the target warehouse (if new) | ✅ ok |
| | | product is listed once (if already there) | ✅ ok |
| | | broken goods are recorded (if any broken) | ✅ ok |
| | | missing goods are recorded (if fewer arrived) | ✅ ok |
| | | the courier's charge is recorded on the restock (if noted) | ✅ ok |
| | | the courier's charge is recorded in liability (if noted) | ✅ ok |
| | | the restock is recorded at the supplier (if has supplier) | ✅ ok |
| | | the restock is recorded at the supplier (mixed suppliers) | [❌ error](#a-mixed-supplier-restock-is-recorded-at-no-supplier) |

## Not discussed yet

These are the restock actions the system performs today, read from
[restock_request.proto](../../../proto/warehouse/inventory/v1/restock_request.proto). Each one's given + when is settled
only when it is discussed, so the states below are a starting point, not a decision.

| given | when |
| --- | --- |
| `selling:all` | edit a restock ← next |
| `selling:all` | cancel an ongoing restock |
| `selling:all` | set an ongoing restock lost |

## Errors

### a-mixed-supplier-restock-is-recorded-at-no-supplier

| | |
| --- | --- |
| then | `warehouse:all` · accept · the restock is recorded at the supplier (mixed suppliers) |
| expected | each line is recorded at its own supplier |
| actual | the restock is recorded at **no** supplier: neither supplier's Statistics shows its products. The goods still enter ready stock, and the accept itself succeeds |
| cause | supplier_service records a restock under ONE supplier for the whole restock. When the lines name different suppliers, that supplier is 0, and the restock is skipped ([restock_accepted_event.go](../../../backend/services/inventory_service/inventory_v1/restock_accepted_event.go#L146), [analytic_fold.go](../../../backend/services/supplier_service/supplier_v1/analytic_fold.go#L140)) |
| seen | the owner's check on the dev data (2026-11-11), and the e2e run for every warehouse role |
| check | `warehouse:all accept (mixed suppliers)` in [restock.spec.ts](../../../frontend/e2e/restock.spec.ts), marked `test.fail` until this is fixed |
