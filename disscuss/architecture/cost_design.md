# Cost Design

1. **this design cover about :**
    - how much spent and in shop.
    - electricity cost.
    - internet cost.
    - and etc.

## Implementing The Ledger from [Mutation & Ledger](./mutation_and_ledger.md) on Cost.
1. Because we have balance that be tracked. the `state` should be have:
    - balance

2. Because we have balance that be tracked. the `ledger log` should be have:
    - balance_after
    - change
    
4. smallest grain that we tracked is by `team_id`

5. table `costs` is used of the ledger as `state` with field:
    - balance

6. for the `ledger log`, we table `cost_logs`.