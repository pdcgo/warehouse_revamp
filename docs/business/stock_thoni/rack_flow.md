# Mekanisme Rak Gudang

Pada real world `rak` adalah tempat penyimpanan `sku`, di sistem kita rak kita simpan di table `racks`.

## Ketentuan rak:

- Rak hanya bisa di buat oleh admin gudang.
- Di satu gudang nama rak bersifat `unique`.
- Rak boleh memiliki gambar yang merepresentasikan rak itu sendiri.
- Gambar rak boleh di ganti.
- 1 rak boleh memuat banyak `sku`
- Rak tidak bisa dihapus

## RPC yang diperlukan:

- Untuk create rak
- Untuk cari rak, aksi bisa dilakukan oleh semua anggota gudang semua level. Tambahkan support paginasi.
  sorting yang diperlukan:
    - `(sku_count, id)`: count(unique(sku)), hitung termasuk yang rusak, abaikan yang 0
    - `(sku_sum, id)`: sku x quantity, hitung termasuk yang rusak, abaikan yang 0
    - `(created_at, id)`
    - `name`

    Filter yang diperlukan:
    - nama
    - hanya rak yang kosong

- Untuk update attribute rak seperti: `nama`, `gambar`. Aksi ini bisa dilakukan hanya oleh `admin` gudang.
