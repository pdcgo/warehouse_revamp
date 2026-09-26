# Warehouse Contexts.


## Responsbility
1. we must have warehouse service that manage warehouse teams.
2. for `warehouse_fee` warehouse service just give rpc for calculate. how the fee handle and recorded is responsbility of [balance](../balance/context.md) and called by [order](../order/context.md)

## Property or Field that must Have.
1. Location Info.
2. Open/Close Order Day info.
3. Fee Configuration Info.
    - `fee_percent`
    - `max_fee`

## Rpc That Must Exist for other service use.
1. `WarehouseFeeCalculate`

    Payload: 
    ```proto
    {
        double     order_total
        uint64      warehouse_id
    }
    ```
    And The response:
    ```proto
    {
        uint64     warehouse_id
        double     order_total
        double     max_fee
        double     fee_percent

        double     calculated_warehouse_fee
    }
    ```
