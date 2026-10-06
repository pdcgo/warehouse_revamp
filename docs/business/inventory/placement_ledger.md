# Placement Ledger.



## Table Should We Have For Placement Ledger.

1. Table `placements`

    Field that must have:
    - `id` as primary key
    - `warehouse_id`
    - `name`
    - `code`, code is unique with warehouse_id
    - `description`
    - `deleted_at`, for soft delete
    - `updated_at`
    - `created_at`


2. Table `product_placements`
    Field that must have:
    - `id` as primary key
    - `team_id`
    - `warehouse_id`
    - `product_id`

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

    - `change_type`
    - `stock_change`

    - `stock_after`

    - `description`
    - `created_at`
