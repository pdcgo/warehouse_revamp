# Placement Ledger.



## Table Should We Have For Placement Ledger.

1. Table `placements`

    Field that must have:
    - `id` as primary key
    - `warehouse_id`
    - `name`
    - `code`, code is unique with warehouse_id
    - `description`
    - `locked`
    - `deleted_at`, for soft delete
    - `updated_at`
    - `created_at`


2. Table `product_placements`
    Field that must have:
    - `id` as primary key
    - `team_id`
    - `warehouse_id`
    - `product_id`, its unique with `placement_id`
    - `placement_id`

    - `stock_count`
    - `updated_at`
    - `created_at`

3. Table `product_placement_logs`

    Field that must have:
    - `id` as primary key
    - `warehouse_id`
    - `team_id`
    - `product_id`
    - `placement_id`
    - `transaction_id`, related to `inventory_transactions` table

    - `change_type`
    - `stock_change`

    - `stock_after`

    - `description`
    - `actor_id`
    - `created_at`

    Field `change_type` contain:
    - `order`
    - `restock`
    - `return`
    - `sample`
    - `transfer_in`
    - `transfer_out`
    - `adjustment`



# Placement Ledger Mutation.
1. Post Order.
    - stock decrease with priority product placement that have low stock. 

