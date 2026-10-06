# Supplier Service

## General.
1. give selling team ability to manage supplier. like:
    - create supplier
    - update supplier
    - delete supplier
    - use it in restock.

2. selling team can discover / search other team suppliers.
3. other selling team can use other selling team supplier for their restock.
4. only selling team that can have supplier.

## What Frontend Expected form this Service.
frontend use this service for 2 page supplier.
1. supplier managing page.
2. discover supplier. its for search other team supplier.


## Table Must Have.

1. table `suppliers`
    
    Field that must have:
    - `id` as primary key
    - `team_id`
    - `name`
    - `contact`
    - `address`
    - `description`
    - `updated_at`
    - `created_at`

2. table `supplier_channels`

    Field that must have:
    - `id` as primary key
    - `supplier_id`
    - `channel_type`
    - `name`
    - `uri`
    - `description`
    - `updated_at`
    - `created_at`

    field `channel_type` contain:
    - `shopee`
    - `lazada`
    - `tiktok`
    - `tokopedia`
    - `bukalapak`
    - `blibli`
    - `custom`

3. table `supplier_channel_products` 

    this table use for reference product in discover supplier frontend page.
    
    Field that must have:
    - `id` as primary key
    - `channel_id`
    - `product_id`, must be unique with `channel_id`
    - `created_at`


## Whats defer.
- defining statistic
- defining how we seed `supplier_channel_products`