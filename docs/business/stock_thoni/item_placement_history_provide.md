# Penyediaan Data Riwayat Penempatan SKU

Ini merupakan `RPC Method`, penggunaannya hanya untuk menampilkan suggestion per sku yang terlampir dalam permintaan retur, suggestion ini berguna untuk staff gudang untuk request penempatan return, staff bisa tahu per sku pernah di simpan di rak mana saja.

### Payload

payload yang diharapkan:

```proto

message GetPlacementPayload {
    option (warehouse.role_base.v1.request_policy) = { roles: [/* peran staff gudang */] };   // ← siapa yang boleh memanggil

    uint64             warehouse_id = 1 [(warehouse.role_base.v1.use_scope) = true];   // ← scope: gudang retur
    repeated uint64    sku_ids = 2 [(buf.validate.field).repeated = {
        min_items: 1, max_items: 100, unique: true, items: { uint64: { gt: 0 } }
    }];
}

```

### Response

response yang diharapkan:

```proto

message PlacementResponse {
    message Placement {
        repeated Rack  our_warehouse = 1;
        repeated Rack  foreign_warehouse = 2;
    }

    message Rack {
        uint64           id = 1;
        uint64           warehouse_id = 2;
        string           name = 3;
        optional string  image_url = 4;
        uint64           count = 5;
    }

    map<uint64, Placement> data = 1;
}


```

### Alur

- Req. masuk membawa data `GetPlacementPayload`
- Cari di table `SKU_SLOT` dengan sku_id terkait.
    - `our_warehouse`, cari dengan syarat `warehouse_id == payload.warehouse_id` dan `sku_id == payload.sku_id`
    - `foreign_warehouse`, cari dengan syarat `warehouse_id != payload.warehouse_id` dan `sku_id == payload.sku_id`, tujuan
      foreign_warehouse hanya untuk menunjukan bahwasanya order dibuat di gudang lain.
    - `count` pada response menunjukan `jumlah sku itu di rak itu`
