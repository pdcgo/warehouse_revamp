# Order Return Flow.

## General.
1. Team Selling Have Order Return Warehouse Location Configuration.
2. if Order Return Warehouse Location not configured, Selling Team Cannot Create Orders.

## Table Must Have.
1. `team_return_configurations`.

    that have fields:
    - `id` primary key
    - `team_id`, its unique.
    - `warehouse_id`
