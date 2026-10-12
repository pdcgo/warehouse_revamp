# Shipment Contexts.

## Responsbility.
1. Provide and manage shipment channel list.
2. Provide tracking service [defered]

## Shipment Channel That Exists.
- jne
- jnt
- sicepat

## Table That Must Have.
1. `shipment_channels`

    field that must have:
    - `id`, primary key
    - `code`, unique
    - `name`
    - `desc`
    - `is_deleted`, for soft delete.
    - `created_at`

## Who can manage ?
1. only root can create, edit and delete it

## What Exposed to Public.
1. shipment channel list, its used to frontend. rpc named `ShipmentChannelList` & `ShipmentChannelByIDs`
2. provide tool for check receipt that named `ReceiptCheck`

## `ReceiptCheck` rpc
1. its use [receipt reader](../../technical/packages/receipt_readers/context.md)