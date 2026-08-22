# Architecture Contexts.

## Microservice For Breakdown Complexity.
There is several service:
1. `user_service`, identity, roles-per-team, the ACL
2. `team_service`, managing the 4 team kinds, membership
3. `product_service`, catalogue, markup %, reserved stock, shared lock, supplier
4. `inventory_service`,	batches/FIFO layers, placement, restock, opname, return, broken/lost
5. `order_service`, order lifecycle, marketplace order info, CS entry + external API
6. `ledger_service`, one double-entry book: COGS, payable/receivable, team balance, debt threshold, warehouse fee, expenses, payments