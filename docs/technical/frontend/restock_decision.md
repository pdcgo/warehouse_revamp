# Decisions — the restock screens

The owner's decisions about how the **restock screens** look and behave — first the selling team's list
(`/inventories/restock`, `pages/restock-selling`), then its detail and its form. **Append-only** (RULE 12): a reversed
decision is renamed and its references grepped.

The rules every screen follows are in [context_decision.md](context_decision.md). What a restock *is* — its statuses,
its money, who may do what — stays in [inventory/restock_decision.md](../../business/inventory/restock_decision.md).

| decision | what it decided |
| --- | --- |
| [the-restock-list-follows-the-screen-rules](#the-restock-list-follows-the-screen-rules) | the selling team's restock list takes every rule in `context_decision.md` before the owner's own pass — a title, the card strip, `FilterBar`, two-line cells, a block per restock on a phone, `EmptyHint`, `GrowingPager`. Its column order and its *Restok* column are REPLACED by [the-restock-list-leads-with-its-references](#the-restock-list-leads-with-its-references); its two in-flight cards by [the-restock-statistics-count-transactions-under-the-tabs](#the-restock-statistics-count-transactions-under-the-tabs) |
| [the-restock-list-leads-with-its-references](#the-restock-list-leads-with-its-references) | the columns run Referensi · Pemasok · Gudang · Produk · Total · Pengiriman · Status · Dibuat · Diterima · Aksi; the order number and the tracking number are copyable, cut at a width with a tooltip saying them whole |
| [the-restock-statistics-count-transactions-under-the-tabs](#the-restock-statistics-count-transactions-under-the-tabs) | the statistics sit under the status tabs, shut until opened — Semua Status: the total and a card per status, led by the transaction count; a status: Transaksi · Jumlah barang · Jumlah SKU · Nilai barang · Ongkir COD · Nilai transaksi, its Rincian › per paying account. Sample figures, marked. Its own row for the Statistik button is REPLACED by [the-statistics-button-ends-the-tab-row](#the-statistics-button-ends-the-tab-row) |
| [the-statistics-button-ends-the-tab-row](#the-statistics-button-ends-the-tab-row) | the Statistik button sits at the right end of the tab row on a desktop, and is an icon beside Filter on a phone — no row of its own. A rule for every list since: [a-statistics-button-ends-the-tab-row](context_decision.md#a-statistics-button-ends-the-tab-row) |
| [the-restock-list-exports-and-filters-by-courier](#the-restock-list-exports-and-filters-by-courier) | **Ekspor** beside *Restok Baru* and a **courier** filter after the warehouse — both on screen and marked `dropped`: the contract has neither yet |
| [a-restock-cancel-warns-it-will-be-checked](#a-restock-cancel-warns-it-will-be-checked) | the cancel dialog says, in a warning, that a cancellation is checked — on the list's ⋯ and on the detail's header alike |
| [a-phone-restock-is-four-lines](#a-phone-restock-is-four-lines) | on a phone a restock is four lines with room around them — the reference and the value lead, bold; the tracking number and the pieces; the supplier and the warehouse; the status and when — the store, the SKUs and the accepted date are the detail page's |

## the-restock-list-follows-the-screen-rules

> Owner, in chat (2026-10-31): *"sekarang kita ke inventory restock selling, inisiasi dulu"* — start the screen from the
> rules every screen follows, before deciding anything about it.

```
Restok                                                              [+ Restok Baru]
[Masuk  81            ] [Nilai barang masuk  Rp 2.785.000]
[⌕ Cari restok, resi, faktur, atau SKU] [Semua gudang ⌄] [Siapa saja yang membuat ⌄] [… menerima ⌄] [Dibuat · Semua tanggal ⌄]  Hapus filter
Semua Status · Dalam Perjalanan · Tiba · Diterima · Hilang · Dibatalkan
Restok                     Pemasok                          Tujuan        Status       Diterima   Produk  Referensi  Pengiriman  Nilai  Aksi
#501                       PT Sumber Makmur +1 pemasok lain  Gudang Pusat  Dalam Perj.  —          …       …          JNE         …      ⋯
29 Okt 13:05 · oleh Rina   [Shopee] Sumber Makmur Official
                                                                         Per halaman [20 ⌄]  ‹ [1] ›

on a phone
Restok                                                              [+]
[Masuk 81] [Nilai barang masuk Rp 2.785.000]
[⌕ Cari restok …]  [Filter]
#501 [Dalam Perjalanan]                                             ⋯
29 Okt 13:05 · oleh Rina
PT Sumber Makmur +1 pemasok lain
[Shopee] Sumber Makmur Official
▣ Gudang Pusat
3 produk · 64 pcs                                       Rp 2.080.000
SKU-BERAS-5K +2 lainnya
```

| rule | applied |
| --- | --- |
| [the-desktop-shell-has-no-top-bar](context_decision.md#the-desktop-shell-has-no-top-bar) | the page names itself — **Restok**. It had no heading and leaned on the breadcrumb, which is gone. Still no team badge and no blurb under it: the owner had taken both off, and the switcher names the team |
| [an-action-button-carries-its-icon](context_decision.md#an-action-button-carries-its-icon) · [a-phone-header-action-is-an-icon](context_decision.md#a-phone-header-action-is-an-icon) | **＋ Restok Baru**; on a phone its ＋ alone, on the title's row |
| [a-list-summary-is-the-order-lists-card-strip](context_decision.md#a-list-summary-is-the-order-lists-card-strip) | *Masuk* and *Nilai barang masuk* are two `SummaryCard`s in a `SummaryStrip` — they were Chakra `Stat`s. Unchanged in meaning: in flight over the whole team, narrowed by the warehouse filter and nothing else |
| [a-phone-filters-from-a-sheet](context_decision.md#a-phone-filters-from-a-sheet) · [clear-filters-is-red-and-bold](context_decision.md#clear-filters-is-red-and-bold) · [every-filter-clears-from-its-own-x](context_decision.md#every-filter-clears-from-its-own-x) | the shared `FilterBar`: the search (debounced now, with its × and icon), the warehouse, who raised it, who accepted it, the date. **Hapus filter** puts all of them back, the date type included. The status tab is not a filter and stays |
| [a-one-type-picker-shows-the-name-alone](context_decision.md#a-one-type-picker-shows-the-name-alone) | the warehouse filter shows its pick as the name alone |
| [one-context-per-column-and-never-three-lines](context_decision.md#one-context-per-column-and-never-three-lines) | **Restok**: the number, then *when · by whom* on one line — the author had a third line. **Pemasok**: *+1 pemasok lain* sits after the supplier's name, not under the store. `LineSupplier` gained an `after` slot for it |
| [a-table-row-lights-up](context_decision.md#a-table-row-lights-up) | every cell in `bg.muted` under the pointer; a phone block lights up and gives under a thumb, since it opens the restock |
| [a-phone-reads-each-line-as-a-block](context_decision.md#a-phone-reads-each-line-as-a-block) | a restock is a block: the number, its status, the *missing* badge and its ⋯; when and by whom; the supplier and store; the warehouse; what is in it beside its value. The accepted date, the references and the courier are the detail page's |
| [an-empty-list-shows-a-hint](context_decision.md#an-empty-list-shows-a-hint) | nothing yet: the restock icon, a line on what a restock is, and **Restok Baru**; an empty status tab: which status has none; nothing matches: *Tidak ada restok yang cocok.* and **Hapus Filter** |
| [every-list-pages-with-the-growing-pager](context_decision.md#every-list-pages-with-the-growing-pager) · [the-pager-is-always-on-screen](context_decision.md#the-pager-is-always-on-screen) | `GrowingPager`, 10 / 20 / 50 a page; it starts over when the tab, a filter or the page size changes |
| [motion-is-small-quick-and-shared](context_decision.md#motion-is-small-quick-and-shared) | the page rises in; the first load is a `ListSkeleton`; the rows fade in once |
| [every-page-has-a-mobile-story](context_decision.md#every-page-has-a-mobile-story) · [a-page-story-has-its-shells-gutter](context_decision.md#a-page-story-has-its-shells-gutter) | a **Mobile** story right after Default; the stories lost Storybook's `padded` layout |
| not applied | [a-table-sorts-from-its-headings](context_decision.md#a-table-sorts-from-its-headings) — `RestockRequestListRequest` has no sort, so no heading sorts. ⚠ My reading, not asked: the date range stays on *Semua tanggal*. [the-quick-ranges-are-days-then-months-then-years](context_decision.md#the-quick-ranges-are-days-then-months-then-years) sets *1 bulan terakhir* for the dated reports, and a work list that opened on a window would hide an old restock still in flight |
| unchanged | the columns and their order, the five status tabs and *Semua Status*, the filters in the URL, the row's ⋯ by status, the value as goods plus shipping |
| the stub | Storybook's `OwnerStockStat` gave *Masuk 0* for every team but the figured one, beside a restock in flight. Another team's in-flight figures now come from its ongoing and arrived restocks (`restockInFlight`), so the cards agree with the rows |
| e2e | *Restock requests page renders for root* accepts the table or the empty hint — a fresh database shows the hint now |

## the-restock-list-leads-with-its-references

> Owner, in chat (2026-10-31): *"dimulai dari referensi di mana order id dan resinya copyable, untuk resi kemungkinan bisa
> sangat panjang, jadi harus ada pembatasan tapi juga harus ada cara lihat fullnya, dilanjutkan pemasok, gudang, produk,
> total, pengiriman, status, tgl dibuat, tgl diterima, dan aksi"*.

```
Referensi                    Pemasok    Gudang   Produk   Total   Pengiriman  Status    Dibuat         Diterima        Aksi
Faktur INV/2026/10/1001 ⧉    PT Sumber  Gudang   3 produk  Rp …   [JNE]       Dalam P.  29 Okt 13:05   —               ⋯
Resi   JNE-CGK-2026091… ⧉    [Shopee] … Pusat    SKU …                                  oleh Rina
           └ under the pointer: JNE-CGK-20260911-0000111122-REG
```

| | |
| --- | --- |
| the order | **Referensi · Pemasok · Gudang · Produk · Total · Pengiriman · Status · Dibuat · Diterima · Aksi**, the owner's |
| Referensi | the store's order number (*Faktur*, the restock's `invoice_ref_id`) over the tracking number (*Resi*), each labelled and each a `CopyText` — a click copies it and never opens the restock. A dash when the restock has neither |
| a long reference | cut at **10rem** with an ellipsis; a **tooltip** shows it whole under the pointer or the focus — only while it is cut. The copy is always the whole value. `CopyText` gained the `maxW` that does this, so any screen can cap a long value the same way. ⚠ My reading, not asked: the order number is capped like the tracking number, since both share the cell |
| Gudang | the column was *Tujuan*; it says *Gudang* now. Still the shared `TeamItem` |
| Total | the column was *Nilai*; still goods plus shipping ([the-couriers-charge-stays-out-of-total](../../business/inventory/restock_decision.md#the-couriers-charge-stays-out-of-total)) |
| Dibuat | a column of its own: the date, and *oleh …* under it — as *Diterima* has always been |
| the restock's own #id | ⚠ no longer on the row — the owner's list does not name it. The row opens the restock and the search finds a number. It was the *Restok* column's first line |
| what it replaces | the column order of [the-restock-list-follows-the-screen-rules](#the-restock-list-follows-the-screen-rules), and its *Restok* column (*#501* over *when · by whom*) |
| unchanged | the phone's block — it still leads with *#501* and its status, and carries no reference |
| the fixture | restock 504's tracking number runs long (`JNE-CGK-20260911-0000111122-REG`), so the cut shows in Storybook |

## the-restock-statistics-count-transactions-under-the-tabs

> Owner, in chat (2026-10-31): *"untuk statistiknya adalah di bawah tab status … untuk statistik di semua status adalah
> total dan per status, dimana data per cardnya adalah transaksi, compact jumlah stok dan compact nilai stoknya, untuk di
> tab status ada transaksi, jumlah barang, jumlah sku, nilai barang, ongkir cod, nilai transaksi"*; on the transfer /
> ShopeePay split of the old screen, *"sistem baru belum tau akan dibuat seperti apa, saranmu?"*. Then: *"jumlah transaksi
> yang penting"*, *"ongkir cod itu biaya kurir yang dibayar oleh gudang, jadi cuma 1 kartu"*, and on shutting it as the
> order list does, *"kita tutup saja"*.

```
Semua Status · Dalam Perjalanan · Tiba · Diterima · Hilang · Dibatalkan
[📊 Statistik ⌄]                                                       ← shut on every visit

Semua Status                                                                          ⚠ 1
[Total          ] [Dalam Perj.   ] [Tiba           ] [Diterima       ] [Hilang  ] [Dibatalkan]
 48 transaksi      4 transaksi      2 transaksi      39 transaksi
 1,2rb pcs · Rp 24,5jt  …

a status (Diterima)
[Transaksi] [Jumlah barang] [Jumlah SKU] [Nilai barang] [Ongkir COD          ] [Nilai transaksi   Rincian ›]
 39          702 pcs         110           Rp 13.338.000  Rp 104.000             Rp 14.196.000
                             produk yang   ...            dibayar gudang ke      barang + ongkir
                             berbeda                      kurir
                                                                                 └ per akun pembayar
                                                                                   BCA Operasional [BCA]  26 · Rp 9.464.000
                                                                                   ShopeePay Melati [ShopeePay] 13 · Rp 4.732.000
```

| | |
| --- | --- |
| where | under the status tabs, behind a **Statistik** button — the order list's, shut on every visit, page state only ([the-statistics-are-shut-and-read-when-opened](order_list_decision.md#the-statistics-are-shut-and-read-when-opened)). Opened, it follows the tab |
| Semua Status | the **total**, then one card per status with its badge. A card is led by its **transaction count**; the units and the value are under it, compact (*1,2rb pcs · Rp 24,5jt*) |
| a status | six cards, whole figures: **Transaksi**, **Jumlah barang** (pcs), **Jumlah SKU** (different products, not lines), **Nilai barang**, **Ongkir COD**, **Nilai transaksi** |
| Ongkir COD | ONE card: what the warehouse paid the courier at the door. It is outside Nilai transaksi ([the-couriers-charge-stays-out-of-total](../../business/inventory/restock_decision.md#the-couriers-charge-stays-out-of-total)), so its line says who paid it and Nilai transaksi's says *barang + ongkir* |
| transfer or ShopeePay | **Rincian ›** on Nilai transaksi ([a-breakdown-opens-from-rincian](context_decision.md#a-breakdown-opens-from-rincian)) opens the value **per paying account** — the account's name, its provider badge (a bank is a transfer, ShopeePay an e-wallet) and its transaction count. A dialog on a desktop, a bottom sheet on a phone. My recommendation, accepted without objection: every restock already names its paying account, so no new concept is needed |
| a card | controls nothing — the tab above chooses the status |
| ⚠ sample | nothing in the contract counts a team's restocks by status: every figure is a SAMPLE, steady per team, that does not follow the filters (`summarySample.ts`); the accounts in the breakdown are the team's real operational ones, the split over them invented. Two marks, `summary` and `payments` (`pages/restock-selling/pending.ts`) |
| what it replaces | the two in-flight cards of [the-restock-list-follows-the-screen-rules](#the-restock-list-follows-the-screen-rules) — *Masuk* and *Nilai barang masuk*, which were real (`OwnerStockStat`) and followed the warehouse filter alone. Their hook (`useRestockOngoing`) and the stub's in-flight figures went with them; *Dalam Perjalanan* and *Tiba* say the same, split |
| the tab | bold when picked — for every screen, [a-selected-tab-is-bold](context_decision.md#a-selected-tab-is-bold) |
| `formatCountCompact` | new in `lib/money.ts` — a count on the compact rupiah's scale (*1,2rb*), so units and value read alike |

## the-statistics-button-ends-the-tab-row

> Owner, in chat (2026-10-31): *"apa ada desain lain buka tutup statistik? kurasa banyak ruang kosong"* — offered the
> button at the end of the tab row (A), a one-line summary while shut (B) and the button in the header (C): *"A, tapi
> dimobile akan masalah"*.

```
before                                               now — a desktop
Semua Status · Dalam Perjalanan · …                  Semua Status · Dalam Perjalanan · …          [📊 Statistik ⌄]
[📊 Statistik ⌄]                    ← its own row    ────────────────────────────────────────────────────────────
[cards]                                              [cards]

now — a phone
[⌕ Cari restok, resi, …] [⚙ Filter] [📊]             ← the icon lights in the main tone while open
Semua Status · Dalam Perjalanan · Tiba · Dite→       ← the tabs scroll sideways, as before
[cards]
```

| | |
| --- | --- |
| a desktop | the button — icon, *Statistik*, chevron — at the **right end of the tab row**, level with the tabs. The row's grey rule runs under both; the picked tab's underline still lands on it |
| a phone | an **icon button beside Filter**, in the search row (`FilterBar`'s `actions`) — six tabs already scroll sideways there, and a button pinned to that row would cover them. While open it is drawn in the main tone. My answer to *"dimobile akan masalah"*, not asked back |
| unchanged | shut on every visit, page state only, nothing read until opened; the cards still open under the tab row |
| `aria-expanded` | on the button, both shapes — it opens a region |
| the order list | asked whether it follows: *"samakan"* — it does, and the button is a rule for every list now, [a-statistics-button-ends-the-tab-row](context_decision.md#a-statistics-button-ends-the-tab-row), drawn by the shared `StatsToggle` |

## the-restock-list-exports-and-filters-by-courier

> Owner, in chat (2026-10-31): *"restok ada filter pengiriman dan export"*.

```
Restok                                                  [⬇ Ekspor ⚠1] [+ Restok Baru]
[⌕ Cari …] [Semua gudang ⌄] [Semua kurir ⌄]⚠2 [Siapa saja yang membuat ⌄] [… menerima ⌄] [Dibuat · …]

on a phone
Restok                                                              [⬇] [+]
[⌕ Cari …] [⚙ Filter] [📊]           ← the courier is in the sheet, after the warehouse
```

| | |
| --- | --- |
| Ekspor | an outline button with its icon, left of *Restok Baru* — the order list's pair; on a phone both are their icons ([a-phone-header-action-is-an-icon](context_decision.md#a-phone-header-action-is-an-icon)). The list as a file, as the order list's ([one-export-is-the-list-as-a-file](warehouse_order_list_decision.md#one-export-is-the-list-as-a-file)) |
| the courier | `ShipmentChannelSelect` — the picker the restock form names a courier with, live couriers, cleared back to any — after the warehouse filter. Kept in the URL (`courier`), counted on the phone's Filter button, taken back by *Hapus filter* |
| ⚠ export | `dropped`: restock has no export RPC (the order list's is `OrderExport`, a server stream ending in a file link). The click says *Ekspor restok belum tersedia.* rather than doing nothing |
| ⚠ courier | `dropped`: `RestockRequestListFilter` has no shipment channel, so the pick is held and the rows do not move; *nothing matches* is not said for it |
| the marks | numbered by where they sit — Ekspor 1, the courier 2, then the statistics 3 and the payments 4 |

## a-restock-cancel-warns-it-will-be-checked

> Owner, in chat (2026-10-31): *"untuk cancel order kasih warning akan diperiksa katanya"*.

```
┌ Batalkan Restok #501 ─────────────────────────────── × ┐
│ Restok ini masih dalam perjalanan. Setelah dibatalkan, │
│ tidak bisa dibuka lagi.                                │
│ ┌──────────────────────────────────────────────────┐   │
│ │ ⚠ Pembatalan restok akan diperiksa.               │   │  ← warning tone, before the question
│ └──────────────────────────────────────────────────┘   │
│ Apakah uangnya kembali? *   ○ Ya …   ○ Tidak …         │
│                       [Simpan Restok] [Batalkan Restok] │
└─────────────────────────────────────────────────────────┘
```

| | |
| --- | --- |
| the warning | a Chakra `Alert` in the warning tone, at the top of the dialog's body — *Pembatalan restok akan diperiksa.* — before the money question and the confirm |
| where | `CancelRestockDialog` in `SellingRestockActions`, so the list's row menu and the selling detail's header both say it |
| what it does not say | who checks a cancellation, or how — nothing on this screen does that; the sentence only warns |
| pinned by | `CancelFromTheRowAsksAboutTheMoney` reads it |
| ⚠ my reading | *"cancel order"* read as the restock's **Batalkan** — this conversation is on the restock list. The sales order's cancel is unchanged |
| ⚠ marked *(2026-10-31)* | owner: *"taruh di unimplemented juga khusus ini"* — nothing checks a cancellation, so the warning carries a `missing` mark (`cancelReview`): the restock list numbers it 5, after its other four; the selling detail gained a pending list of this one entry, its strip shown only while the restock can still be cancelled. `SellingRestockActions` takes the mark as `cancelReviewMark`, so each screen numbers it in its own list |

## a-phone-restock-is-four-lines

> Owner, in chat (2026-11-02): *"restok mobile terlalu compact dan banyak kurang bagus, ada ide?"* — offered three lines led
> by the supplier, then: *"[referensi] perlu, karena itu adalah yang paling utama"*; and on using it for every list, *"untuk
> semua, tapi lihat di sini dulu mungkin aku berubah pikiran"*.

```
before — seven lines of one weight, tight          now — four lines, one leads
#501 [Dalam Perjalanan]                  ⋯         ┌──────────────────────────────────────────┐
29 Okt 14:43 · oleh Ani Rahayu                     │ Faktur INV/2026/10/1001 ⧉   Rp 2.080.000 │  ← bold
PT Sumber Makmur +1 pemasok lain                   │ Resi JNE0123456789 ⧉              64 pcs │
[Shopee] Sumber Makmur Official                    │ PT Sumber Makmur · Gudang Pusat          │
▣ Gudang Pusat                                     │ [Dalam Perjalanan] 29 Okt 14:43 · Ani  ⋯ │
3 produk · 64 pcs                                  └──────────────────────────────────────────┘
SKU-BERAS-5K +2 lainnya       Rp 2.080.000
```

| line | |
| --- | --- |
| 1 | **the reference leads** — the store's order number, labelled *Faktur*, bold and copyable — and the **value** on the right, bold. No invoice: the restock's own *#501* |
| 2 | *Resi* and the tracking number, copyable — both references cut at 9.5rem with the whole in a tooltip ([the-restock-list-leads-with-its-references](#the-restock-list-leads-with-its-references)); a dash when there is none — and the **pieces** on the right, under the value they make |
| 3 | the supplier (with *+N pemasok lain*) · the warehouse, quiet, one line, cut when long; *Belum terhubung ke pemasok* when the lines name none |
| 4 | the status, a *kurang N* beside it, when it was raised and by whom, and the ⋯ |
| room | 16px inside a block, 8px between lines, 12px between blocks — it was 12, 6 and 8 |
| gone from the block | the store, the SKU line, the warehouse icon, *oleh* — all the detail page's, a tap away |
| ⚠ every list | the owner means it for every phone list, **after looking at it here** — not applied elsewhere yet |
