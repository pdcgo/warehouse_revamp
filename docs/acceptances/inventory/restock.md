# Acceptance — inventory / restock

Business: [restock.md](../../business/inventory/restock.md) · rules: [guide.md](../guide.md)

| given | when | then | status |
| --- | --- | --- | --- |
| `selling:all` | create restock | restock is listed as ongoing | untested |
| | | the target warehouse sees it incoming | untested |
| | | ongoing stock increases | untested |
| | | paying account balance decreases | untested |
| | | the account history shows the restock | untested |
| | | product is listed in the target warehouse (if new) | untested |
| | | product is listed once (if already there) | untested |

## Not discussed yet

These are the restock actions the system performs today, read from
[restock_request.proto](../../../proto/warehouse/inventory/v1/restock_request.proto). Each one's given + when is settled
only when it is discussed, so the states below are a starting point, not a decision.

| given | when |
| --- | --- |
| `warehouse:all` | mark an ongoing restock arrived ← next |
| `warehouse:all` | accept an arrived restock |
| `selling:all` | edit a restock |
| `selling:all` | cancel an ongoing restock |
| `selling:all` | set an ongoing restock lost |
