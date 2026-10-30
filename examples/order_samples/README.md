# Order export samples

What the order list's **Import** reads: a marketplace's **order export**, one shop at a time
([the-import-moves-only-after-handover](../../docs/technical/order/design_decision.md#the-import-moves-only-after-handover)).
Laid out like [settlement_samples/](../settlement_samples/): one folder per platform.

> ⚠ **Every file here is a MOCK.** Built from what the platforms' exports are known to look like, with invented refs,
> buyers and tracking numbers. The column names and the status words are a best guess. When a real export arrives,
> it goes beside these, and the mock that disagrees with it is the one that is wrong.

| file | sheet | layout |
| --- | --- | --- |
| `shopee/mock_order_all_20261020_20261023.xlsx` | `orders` | header on row 1, **one row per product**, so an order with three products repeats its `No. Pesanan` three times |
| `shopee/mock_order_all_20261020_20261027.xlsx` | `orders` | the same shop and range, exported four days later |
| `tiktok/mock_all_orders_20261020_20261023.xlsx` | `OrderSKUList` | header on row 1, **a description of each column on row 2**, then one row per product. IDs are 18 digits, stored as text |
| `tiktok/mock_all_orders_20261020_20261027.xlsx` | `OrderSKUList` | the same shop and range, exported four days later |

**Why two files per platform.** Every order they share is further along in the later file, so the pair covers
*already there* (import the same file twice) and *the file is behind ours* (import the later one first, then the earlier).

## What each order says

| Shopee `No. Pesanan` | 23 Oct | 27 Oct |
| --- | --- | --- |
| `2610201A2B3C4D` | Selesai | Selesai |
| `2610201E5F6G7H` (2 products) | Sedang Dikirim | Selesai |
| `2610212J8K9L0M` | Sedang Dikirim | Selesai, *Pengembalian Dana Disetujui* |
| `2610212N1P2Q3R` (2 products) | Perlu Dikirim, resi printed | Sedang Dikirim |
| `2610223S4T5U6V` | Perlu Dikirim | Sedang Dikirim |
| `2610223W7X8Y9Z` | Belum Bayar | Batal, unpaid |
| `2610224A1C3E5G` | Batal, by the buyer | Batal, by the buyer |
| `2610235H7J9K2L` | Sedang Dikirim | Batal, *Pengiriman gagal* |
| `2610256M4N6P8Q` (3 products) | — | Perlu Dikirim |

| TikTok `Order ID` | 23 Oct | 27 Oct |
| --- | --- | --- |
| `582034417702156311` | Completed | Completed |
| `582035120938471122` (2 products) | Shipped · Delivered | Completed |
| `582046653120988733` | Shipped · In transit | Completed, *Return/Refund* |
| `582047009875512344` (2 products) | To ship · Awaiting collection | Shipped · In transit |
| `582058311204467755` | To ship · Awaiting shipment | Shipped · In transit |
| `582059902761134466` | Unpaid | Canceled, unpaid |
| `582060177345209877` | Canceled, by the buyer | Canceled, by the buyer |
| `582081440029318866` (3 products) | — | To ship · Awaiting shipment |
