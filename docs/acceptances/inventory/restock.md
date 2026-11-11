# Acceptance — inventory / restock

Business: [restock.md](../../business/inventory/restock.md) · rules: [guide.md](../guide.md)

| given | when | then | status |
| --- | --- | --- | --- |
| `selling:all` | create restock | restock is listed as ongoing (1 product) | ✅ ok |
| | | restock is listed as ongoing (2 products) | ✅ ok |
| | | restock is listed as ongoing (with shipping cost) | ✅ ok |
| | | the target warehouse sees it incoming | ✅ ok |
| | | ongoing stock increases | ✅ ok |
| | | paying account balance decreases | ✅ ok |
| | | the account history shows the restock | ✅ ok |
| `warehouse:all` | mark arrived | restock is listed as arrived (from ongoing) | ✅ ok |
| | | restock is listed as arrived (from lost) | ✅ ok |
| | | the seller sees it arrived | ✅ ok |
| | | the inbound list shows who signed for it and when | ✅ ok |
| | | the courier's charge shows on the restock (if noted) | 🚧 unimplemented |

## Not discussed yet

These are the restock actions the system performs today, read from
[restock_request.proto](../../../proto/warehouse/inventory/v1/restock_request.proto). Each one's given + when is settled
only when it is discussed, so the states below are a starting point, not a decision.

| given | when |
| --- | --- |
| `warehouse:all` | accept an arrived restock ← next — carries two thens moved from create: `product is listed in the target warehouse (if new)` and `product is listed once (if already there)`. The warehouse's product list shows a product once it is accepted, not while the restock is ongoing |
| `selling:all` | edit a restock |
| `selling:all` | cancel an ongoing restock |
| `selling:all` | set an ongoing restock lost |
