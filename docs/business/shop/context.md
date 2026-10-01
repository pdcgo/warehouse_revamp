# Shop Service Context.

## General.

## Responsebility.
1. Manage Shop for Selling Team :
    - create 
    - edit
    - delete
    - list
    - manage access user to shop.

## Manage User Access In Shop.
1. shop can have multiple user.
2. shop have one primary customer service. Like Badge in Frontend.

## Rpc That Must Exist that Used by Settlement Importer Service.
1. rpc named `ShopAccessCheck`

    ```proto
    message Payload {
        uint64  shop_id
        uint64  user_id
    }

    message Response {
        ShopDetail      shop
        uint64          primary_user_id
        bool            is_have_access 
    }
    ```