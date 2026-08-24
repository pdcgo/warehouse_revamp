# Architecture Contexts.

## Microservice For Breakdown Complexity.
There is several service:
1. `user_service`, identity, roles-per-team, the ACL
2. `team_service`, managing the 4 team kinds, membership
3. `product_service`, catalogue, markup %, reserve number, shared lock, supplier, LinkMap, categories — **never a quantity**
4. `inventory_service`,	batches/FIFO, placement, restock=purchase, receiving, opname, return, broken/lost · `inventory_log` + `purchasing_log`
5. `order_service`, draft→finalize→accept→pack→handover, marketplace info, CS entry + external API
6. `settlement_service`, handle settlement of the order.
7. `balance_service`, mirrored pair rows, debt threshold, **the gate**, payments between teams
8. `expense_service`, electricity/ads/payroll · `expense_log` — it's already its own box in your ledger flow
9. `shipping_service`, courier catalogue, the parcel (awb/fee/status), region
10. `document_service`, evidence blobs — what makes "transparency accounting" provable
11. `ledger_service`, the one book: entries, lines, trial balance, money statistics. ** Cannot refuse anything**