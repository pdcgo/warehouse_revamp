```mermaid

---
config:
    layout: elk
---

erDiagram

TRANSACTIONS ||--|{ TRANSACTION_ITEMS: "memiliki beberapa"
TRANSACTIONS ||--|{ TRANSACTION_STATUS_LOGS: "memiliki beberapa"

TRANSACTIONS ||--o{ SKU_SLOT: "terhubung dengan"
TRANSACTIONS ||--o{ SKU_LOST_SLOT: ""
TRANSACTIONS ||--o{ SKU_BROKEN_SLOT: ""
SKU_SLOT ||--o{ ORDER_SLOT_MAP: ""
ORDER_TAKES ||--o{ ORDER_SLOT_MAP: ""

SKU_STATEMENT {
    int id pk
    int sku_id fk
    int warehouse_id fk
    int stock_ongoing
    int stock_ready
    int stock_lost
    int stock_broken
    date created_at
    date updated_at
}

TRANSACTIONS {
    int id pk
    int ref_order_id "ref to order_id when return, nullable"
    int created_by "ref to user"
    int team_id "ref to user team"
    int shipping_id "ref to shipping_agent_id"
    int warehouse_id
    string type "restock | return"
    string receipt
    float shipping_fee "default 0"
    float additional_shipping_fee "default 0"
    string additional_shipping_proof_url  "foto nota kurir, nullable"
    string order_id "nullable"
    string notes "nullable"
    string payment_method
    date created_at
}

TRANSACTION_STATUS_LOGS {
    int id pk
    int created_by fk
    int tx_id fk
    string status
    date created_at
}

TRANSACTION_ITEMS {
    int id pk
    int tx_id fk
    int sku_id fk
    int team_id fk
    int supplier_id
    int count
    float total
}

SKU_SLOT {
    int id pk
    int count

    int sku_id fk
    int supplier_id fk
    int tx_id fk
    int warehouse_id fk
    int rack_id fk
    int team_id fk

    float unit_price
    float unit_shipping_cost
    float unit_additional_shipping_cost

    date created_at
}

SKU_LOST_SLOT {
    int id pk
    int sku_id fk
    int team_id fk
    int tx_id fk
    int warehouse_id fk
    int supplier_id fk

    int count

    float unit_price
    float unit_shipping_cost
    float unit_additional_shipping_cost

    string notes "nullable"

    date created_at
}

SKU_BROKEN_SLOT {
    int id pk
    int sku_id fk
    int team_id fk
    int tx_id fk
    int warehouse_id fk
    int supplier_id fk

    int count
    int rack_id fk

    float unit_price
    float unit_shipping_cost
    float unit_additional_shipping_cost

    string notes "nullable"
    string image_of_proof_url "nullable"

    date created_at
}

ORDER_TAKES {
    int id pk
    string take_ref "unique"
    date created_at
}

ORDER_SLOT_MAP {
    int id pk
    int order_id "ref to ORDER_TAKES"
    int slot_id fk "ref to SKU_SLOT"
    int count
    string type "taken | released"
}

```

ERD di atas dibuat untuk mendukung mekanisme FIFO.
SKU_SLOT akan dibuat ketika barang sampai di gudang.

- TRANSACTIONS `type` berupa enum `(restock | return)`.
- TRANSACTIONS `order_id` adalah order id untuk restock bukan order atau ref ke order / outbound tertentu.
- TRANSACTIONS `ref_order_id` merujuk ke id pesanan yang retur.

### SKU_STATEMENT

Table ini `UNIQUE (sku_id, warehouse_id)`, jika kombinasi keduanya belum ada maka buat baru, jika sudah ada maka tambahkan nilai nya.
baris statement selalu ditulis urut `sku_id`.
Table ini bersifat statement artinya dia bertujuan agar kita gampang menyimpulkan kondisi suatu SKU, dia bisa saja miss dalam perhitungan saat proses `restock`, `order`, ataupun `order`, maka dari itu saya berencana mentrigger kalkulasi ulang setiap tengah malam untuk merekonsiliasi statement, bisa juga ada fungsi untuk "force reconcile" yang bisa di tekan user untuk memicu reconcile, tapi saya ingin ketika force reconcile di tekan saat jam kerja berikan user warning.

---

> Todo mekanisme `adjustment`, sedang saya pikirkan dulu.
