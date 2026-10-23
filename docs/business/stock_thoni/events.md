Berikut skema Event di service ini:

```proto

message StockRestockCreated {
    option (warehouse.events.v1.event_config).topic = "stock-restock-created";
    uint64 tx_id = 1;
    uint64 team_id = 2;
    uint64 warehouse_id = 3;
    uint64 created_by = 4;
    uint64 payment_id = 5;
    uint64 shipping_fee = 6;
    repeated Item items = 7;
}

message StockRestockCancelled {
    option (warehouse.events.v1.event_config).topic = "stock-restock-cancelled";
    uint64 tx_id = 1;
    uint64 team_id = 2;
    uint64 warehouse_id = 3;
    uint64 cancelled_by = 4;
}

message StockRestockBilling {
    option (warehouse.events.v1.event_config).topic = "stock-restock-billing";
    uint64 tx_id = 1;
    uint64 team_id = 2;
    uint64 warehouse_id = 3;
    uint64 cs_id = 4;
    uint64 additional_shipping_fee = 5;
    optional string image_of_proof_url = 6;
}

```
