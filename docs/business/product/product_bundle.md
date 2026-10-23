# Product Bundle Contexts.

## General.
1. this bundle used in creating order.

## Table Must Have in Bundle.
1. Table `bundles`

    Field That Have:
    - `id`, primary key
    - `name`
    - `description`
    - `team_id`

    - `created_by_user_id`
    - `updated_at`
    - `created_at`

2. Table `bundle_products`

    Field That Have:
    - `id`, primary key
    - `bundle_id`
    - `product_id`
    - `quantity`



