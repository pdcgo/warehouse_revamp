# Proposal Mekanisme Stok Gudang

Service ini bernama `Inventory Service`,
service ini memerlukan:

- [Product Service](../product/context.md)
- [Balance Service](../balance/context.md)
- [User Service](../user/context.md)
- [Team Service](../teams/context.md)
- dan `Supplier Service` (ini belum dibuat).

Padanan konteks kata:

- Product = SKU

> Untuk data pendukung saya menggambar relasi ERD sementara [di sini](./model.md)

Service ini menangani segala pencatatan terkait Inventory / SKU. Service ini akan diperlukan oleh service yang lain antara lain:

- Order service, berikut constraint terkait [OrderCreation](../order/order_creation.md)

Beberapa tanggung jawab service ini antara lain:

- Menangani proses Restock, [Lihat Selengkapnya](#proses-restock)
- Menangani proses Return, [Lihat Selengkapnya](#proses-restock)
- Menyediakan data yang diperlukan saat [OrderCreation](../order/order_creation.md)

### Batasan Service

- service ini cuma mencatat tagihan. Untuk penagihan akan diurus oleh service lain di luar service ini.

### Proses Restock

Pemilik SKU membuat transaksi restock, kemudian mengisi field yang dibutuhkan:

- pilih gudang target
- jasa kirim
- metode pembayaran (ketika belanja barang yang akan di restock)
- resi
- order id (opsional)
- ongkir (opsional)
- catatan (opsional)
- list SKU

setiap SKU membawa data:

- supplier nya siapa.
- harganya berapa
- dan berapa jumlahnya

Berikut alur `restock`: [Lihat](./restock_flow.md)

Notes:
1 `transaction` hanya boleh melewati status `ongoing`, `cancelled`, `arrived`, dan `approved` secara urut, tidak boleh status log nya double, misal jika sudah `approved` dia sudah tidak bisa di apa-apakan. transaction yang sudah diterima tidak bisa di cancel. `cancelled` juga termasuk final status, artinya `cancelled` tidak bisa jadi `approved`.

### Penyediaan data OrderCreation

Berikut merupakan alur penyediaan data untuk Order Creation, [Lihat Selengkapnya](./order_creation_provide.md)
