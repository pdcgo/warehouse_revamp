# Decisions — the batches

The owner's decisions about the **batch screens** — the list (`/inventories/batches`, `pages/batches`) and a batch's page
(`/inventories/batches/:batchId`, `pages/batch-detail`). **Append-only** (RULE 12): a reversed decision is renamed and its
references grepped.

The rules every screen follows are in [context_decision.md](context_decision.md). What a batch is, and how it is minted
and priced, is the business record: [batch.md](../../business/inventory/batch.md),
[batch_decision.md](../../business/inventory/batch_decision.md) and restock's
[one-batch-per-line](../../business/inventory/restock_decision.md#one-batch-per-line).

| decision | what it settles |
| --- | --- |
| [the-batches-follow-the-screen-rules](#the-batches-follow-the-screen-rules) | the batch list and a batch's page follow the rules every screen does — the card strip, the filter strip, a block per row on a phone, skeletons, hints, the growing pager, Mobile stories; a batch is named by its OWN number, the restock it came from under it |
| [a-batch-says-what-it-is](#a-batch-says-what-it-is) | both batch screens say what a batch is — a line under the list's title, and *Apa itu batch?* whose tooltip holds the answer with an example; hover opens it, and a click or a tap |
| [sku-is-copyable](#sku-is-copyable) | a batch's SKU copies on a click — on the list's row and block, and under a batch's product — without opening the batch |
| [an-expiry-says-how-long-is-left](#an-expiry-says-how-long-is-left) | the batch list's *Kedaluwarsa* is the day alone at *Tiba*'s size, with how long is left under it — amber within 30 days, red once past |
| [a-batch-opens-where-it-came-from](#a-batch-opens-where-it-came-from) | a batch's source is a way there — *Restok #503* opens the restock, no resi; a return's *Retur* is marked until a batch knows its return |
| [the-batch-list-filters-by-team](#the-batch-list-filters-by-team) | the batch list filters by whose goods — a search select over the selling teams, the pick its name alone; held in the URL and marked, it narrows nothing yet |

## the-batches-follow-the-screen-rules

> Owner, in chat (2026-11-07): *"inisiasi dan kasih keterangan batch itu apa"*.

```
the list                                                               a batch's page
Batch                                                                  ←  Batch #5031 [Restok] [Kedaluwarsa 27 Nov]   [✎ Koreksi]
Stok yang masuk bersamaan dengan harga yang sama — …                       [img] Beras Pandan Wangi 5kg  [Toko Melati]
ⓘ Apa itu batch?                                                       Dari Restok #503 · SCP… · Diterima oleh Budi
[Batch 6] [Nilai siap Rp …] [Kedaluwarsa ≤ 30 hari 2]                      ⓘ Apa itu batch?
[⌕ Cari …] [Semua kedaluwarsa ⌄ ×] [Tiba · semua tanggal]               [Tiba 10] [Rusak 2] [Hilang 1] [Terpakai 0] [Siap 7]
Batch           Produk          Tim         Tiba         Siap …         Ditaruh Saat Diterima │ Tempat  Ditaruh  Opname terakhir
#5031           Beras …         [TM] Melati 1 Nov 13:05     7           Riwayat               │ A-01-1        5  Belum pernah
Restok #503 · … SKU-BERAS-5K                                                                   │ B-02-1        2
                                            ‹ [1] ›                                                          ‹ [1] ›
```

**The list** (`pages/batches`)

| rule | applied |
| --- | --- |
| [the-desktop-shell-has-no-top-bar](context_decision.md#the-desktop-shell-has-no-top-bar) | the page names itself — *Batch*, a line under it on what a batch is ([a-batch-says-what-it-is](#a-batch-says-what-it-is)); no team badge |
| [a-list-summary-is-the-order-lists-card-strip](context_decision.md#a-list-summary-is-the-order-lists-card-strip) | the three Chakra `Stat`s are the card strip — *Batch* leads, *Nilai siap*, *Kedaluwarsa ≤ 30 hari* (amber above 0); over the whole filtered set |
| [a-phone-filters-from-a-sheet](context_decision.md#a-phone-filters-from-a-sheet) · [clear-filters-is-red-and-bold](context_decision.md#clear-filters-is-red-and-bold) · [every-filter-clears-from-its-own-x](context_decision.md#every-filter-clears-from-its-own-x) | `FilterBar`: the search (debounced) in the row; the expiry a Chakra `Select` with its × (it was a `NativeSelect` with an "all" option), the date range beside it; Hapus Filter; on a phone a sheet. Still in the URL |
| the batch's number | the row and the page are named by the batch's **own** number — `#5031`, the number in a label's QR — with *Restok #503 · resi* (or *Retur*) under it. They were named by the restock's number, so two batches of one restock read alike (*Batch #503*) |
| [one-context-per-column-and-never-three-lines](context_decision.md#one-context-per-column-and-never-three-lines) · [a-team-of-a-known-type-shows-no-badge](context_decision.md#a-team-of-a-known-type-shows-no-badge) | the product is its name and SKU under it; whose it is, `TeamItem size="xs"` — the small avatar and the name, no *Selling* badge (it was a name badge); *Habis* under a ready count of 0 |
| [a-table-date-is-short-and-every-time-is-wib](context_decision.md#a-table-date-is-short-and-every-time-is-wib) | *Tiba* is `1 Nov 13:05`; the expiry a day, `27 Nov` (new `formatUnixDateShort`), amber within 30 days — both were the browser's dates |
| [a-table-row-lights-up](context_decision.md#a-table-row-lights-up) · [a-phone-reads-each-line-as-a-block](context_decision.md#a-phone-reads-each-line-as-a-block) | rows light up; on a phone each batch is a block — number and date, the product, whose it is, *Siap 7 · Rp … × 7 … Rp …*, where it came from and its expiry |
| [an-empty-list-shows-a-hint](context_decision.md#an-empty-list-shows-a-hint) | no match: *Hapus Filter*; no batches: where they come from |
| [every-list-pages-with-the-growing-pager](context_decision.md#every-list-pages-with-the-growing-pager) · RULE 10 | `GrowingPager` with a per-page size; the query spreads `listQuery` and the rows sit in `RefreshOverlay` — it had neither |
| [motion-is-small-quick-and-shared](context_decision.md#motion-is-small-quick-and-shared) | the page rises in; a first load is a skeleton |
| a batch opened from the list | carries the list (`fromHere`), so its back returns with the filters |

**A batch's page** (`pages/batch-detail`)

| rule | applied |
| --- | --- |
| [the-phone-header-is-one-row](context_decision.md#the-phone-header-is-one-row) · [a-form-returns-where-it-was-opened](context_decision.md#a-form-returns-where-it-was-opened) | back, *Batch #5031*, its origin and *Kedaluwarsa* badges, and *Koreksi* in one row; back returns where the page was opened. Koreksi sat alone over the page |
| [an-action-button-carries-its-icon](context_decision.md#an-action-button-carries-its-icon) · [a-phone-header-action-is-an-icon](context_decision.md#a-phone-header-action-is-an-icon) | Koreksi with its ✎; on a phone its icon alone |
| under the title | the product as `ProductListItem` (its picture, name, SKU), whose it is — `TeamItem size="xs"` ([a-team-of-a-known-type-shows-no-badge](context_decision.md#a-team-of-a-known-type-shows-no-badge)), it was a name badge — then *Dari Restok #503* (a link, no resi: [a-batch-opens-where-it-came-from](#a-batch-opens-where-it-came-from)) · who received it — the two header columns were one big product heading and a second batch heading |
| [a-list-summary-is-the-order-lists-card-strip](context_decision.md#a-list-summary-is-the-order-lists-card-strip) | the lifecycle is the card strip — Tiba (its cost and date), Rusak, Hilang, Terpakai, **Siap** leading — each with its value under it |
| the tabs | down the left on a desktop (#198), across the top on a phone ([nothing-runs-past-a-phones-edge](context_decision.md#nothing-runs-past-a-phones-edge)); no card around them |
| Ditaruh Saat Diterima | the rack search is `FilterSearch` with its ×; rows light up; an empty tab is a hint; the last count's date is the app's |
| Riwayat | `MovementTable`'s reworked mode — a hint when empty, rows that light up, two lines a movement on a phone |
| [every-list-pages-with-the-growing-pager](context_decision.md#every-list-pages-with-the-growing-pager) · [motion-is-small-quick-and-shared](context_decision.md#motion-is-small-quick-and-shared) | both tabs page with `GrowingPager`; skeletons; the page rises in |

| | |
| --- | --- |
| Storybook | `.storybook/batchStub.ts` — new: BatchList, BatchDetail, BatchPlacementList, StockHistory and ProductPlaces for Gudang Pusat's six batches, consistent with restocks 503 and 507; reset in preview |
| pinned by | BatchList `Default`, `Mobile`, `What is a batch`, `Search`, `Expiring soon`, `Nothing matches`, `No batches yet`, `Opens its page`, `Selling team` · BatchDetail `Default`, `Mobile`, `What is a batch`, `History`, `A return`, `Opens its restock`, `Back to the list`, `Not found` — the two pages had no stories |

What it replaces: the batch screens' own layout — a team badge, three bare `Stat`s, a bare search and a native select, a
spinner, *Pagination*, a grey empty line, the browser's dates, rows named by their restock; on a batch's page Koreksi
alone over a two-column heading, plain `Stat`s, a carded tab box and striped tables.

## a-batch-says-what-it-is

> Owner, in chat (2026-11-07): *"inisiasi dan kasih keterangan batch itu apa"* — after asking *"batch itu apa?"* and *"1
> restok dihitung batch?"*; then *"penjelasan batch jangan collapse, tooltips?"*, and *"jangan hitam"*.

```
Batch
Stok yang masuk bersamaan dengan harga yang sama — satu per produk di tiap restok yang diterima.
ⓘ Apa itu batch?
  ┌─ tooltip ─────────────────────────────────────────────────────────────────────────────┐
│ Batch adalah stok yang masuk bersamaan dengan harga yang sama — satu produk, satu     │
│ pemilik, satu harga satuan.                                                           │
│ • Dibuat saat restok diterima — satu untuk tiap produk yang ada unit bagusnya. Retur, │
│   transfer masuk, dan opname juga membuat batch.                                      │
│ • Harga satuannya harga beli + ongkir dan ongkos COD kurir, dibagi rata ke semua unit.│
│ • Barang keluar diambil dari batch terlama dulu — membawa harga saat ia masuk.        │
│ • Batch mencatat nilai, bukan tempat — letak barang ada di Rak.                       │
│ [Restok #503 diterima] → [Beras · 7 pcs] [Teh · 20 pcs]  dua batch — …                │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

| | |
| --- | --- |
| the line | under the list's title, always: what a batch is in one sentence |
| the answer | *Apa itu batch?* (a ? icon, the words dotted-underlined), on the list and on a batch's page — its **tooltip** holds the four points and an example drawn as the restock becomes its batches. Never a panel that pushes the page down |
| a phone | hover and focus open it, as every tooltip; a **click or a tap** opens and shuts it too — a phone has no hover |
| light, not black | owner: *"jangan hitam"* — the panel's own ground and ink (`bg.panel`, `fg`), a thin line and a shadow, as a popover is drawn; the default tooltip's near-black was a lot of dark for a paragraph. Other tooltips (a cut text's whole, a line's note) keep theirs |
| one component | `features/inventory/BatchExplainer` (two pages of one domain), its story `Features/Inventory/BatchExplainer` |
| what it states | the business record's rules — [one-batch-per-line](../../business/inventory/restock_decision.md#one-batch-per-line), [unit-price-is-line-price-plus-costs-per-unit](../../business/inventory/restock_decision.md#unit-price-is-line-price-plus-costs-per-unit), the batch ledger's oldest first, and that a batch is not a rack ([a-batch-shows-the-racks-it-was-put-on](../../business/inventory/batch_decision.md#a-batch-shows-the-racks-it-was-put-on)). It explains; it decides nothing |
| pinned by | BatchList `What is a batch` · BatchDetail `What is a batch` (hover) · `BatchExplainer / On hover`, `On a tap` |

What it replaces: a screen titled *Batch* with nothing saying what one is — and, the same day, the answer as a
collapsible panel under the title (*"jangan collapse"*).

## sku-is-copyable

> Owner, in chat (2026-11-07): *"sku copyable"*.

```
#5031            Beras Pandan Wangi 5kg        ← the row opens the batch
Restok #503 · …  SKU-BERAS-5K ⧉                ← the SKU copies, and opens nothing
```

| | |
| --- | --- |
| where | the list's row (under the product's name) and a phone's block — `CopyText`; a batch's page — `ProductListItem skuCopyable`, as the product list has it |
| a click | copies the SKU and reports ✓ or ⚠; it does not reach the row, so the batch does not open |
| pinned by | BatchList `SKU copies` · BatchDetail `Default` |

What it replaces: a SKU shown as plain text on the batch screens.

## an-expiry-says-how-long-is-left

> Owner, in chat (2026-11-09): *"ukuran kadaluarsa dan tiba kenapa beda? ada alasan?"* — there was none — then *"kalau
> melihat keputusan sebelumnya, kira-kira seperti apa?"*, and to the answer *"oke"*.

```
Tiba           Kedaluwarsa                      a phone's block
1 Nov 13:05    29 Nov                           Restok #503 · …     Kedaluwarsa 29 Nov · 20 hari lagi
               20 hari lagi     ← amber
28 Sep 13:17   6 Nov
               lewat 3 hari     ← red
6 Nov 13:17    —                ← no expiry
```

| | |
| --- | --- |
| the size | 12px, as *Tiba* beside it — it was the table's 14px, an oversight |
| the day | the day alone, no clock — a package's date has none ([a-day-without-a-time-is-shown-alone](context_decision.md#a-day-without-a-time-is-shown-alone)); the full date on its hover |
| how long is left | under the day, as the order list's ship-by deadline: *20 hari lagi*, *hari ini*, *lewat 3 hari*. Amber within 30 days (the server's soon window), red once past, quiet beyond. Jakarta calendar days (`daysUntilUnix`) |
| a phone | one line in the block's foot — *Kedaluwarsa 29 Nov · 20 hari lagi* |
| the component | `pages/batches/components/ExpiryCell` |
| the stub | 3981 (Gula) expired three days ago, and *Kedaluwarsa ≤ 30 hari* counts the past too, as the server's `expired_at <= cutoff` does |
| ⚠ not yet | nothing sets a batch's expiry yet — the accept takes none — so in the real app every batch has no expiry and the column is a dash. Raised in chat; not decided |
| pinned by | BatchList `Expiry` (the day, *20 days left* amber, *expired 3 days ago* red, a dash, 12px) · `Default` (3 expiring) |

What it replaces: the expiry as a 14px date beside a 12px *Tiba*, amber from 30 days out with nothing saying how near.

## a-batch-opens-where-it-came-from

> Owner, in chat (2026-11-09): *"batch restoknya tidak resi, tapi bisa redirect ke detailnya, retur juga"*.

```
before   #5031                          now   #5031
         Restok #503 · SCP5544332211          Restok #503        ← a link: /inventories/restock/503
         #9101                                #9101
         Retur                                Retur ⚠1           ← its return cannot be named yet
```

| | |
| --- | --- |
| a restock's batch | *Restok #503* (*Dari Restok #503* on a batch's page) is a link to the restock's page, carrying where it was opened so Back returns; a click on it does not open the batch the row stands for |
| no resi | the tracking number is the restock's — one click away on its page; on a batch's row it was a third fact in the cell. The list's search still finds a batch by it |
| a return's batch | *Retur* with ⚠ `returnLink`, kind `missing`: StockBatch's `delivery_id` is the restock's number (the read joins restocks only), so a batch a return made carries 0 and no return number — nothing to point `/inventories/returns/:id` at (`features/inventory/pending.ts`). The list's strip says so; a batch's page shows the strip only for a return |
| anything else | a batch with no restock number and no return (a transfer in, a count) shows a dash |
| one component | `features/inventory/BatchSource` — the list's row and block, and a batch's page; its story `Features/Inventory/BatchSource` |
| the stub | 9101, the return, carries `delivery_id` 0, as the server answers |
| pinned by | BatchList `Default` (no resi), `Opens its source` (to the restock, not the batch; the return's ⚠) · BatchDetail `Default`, `A return`, `Opens its restock` · `BatchSource / Opens the restock` |

What it replaces: *Restok #503 · resi* as plain text on the list, and on a batch's page the resi beside its restock link.

## the-batch-list-filters-by-team

> Owner, in chat (2026-11-09): *"filternya cuma ada itu saja?"* — offered Tim and Status, recommended both — then
> *"oke, kasih tim"*.

```
[⌕ Cari batch, resi, atau produk] [Semua tim ⌄] ⚠2 [Semua kedaluwarsa ⌄] [Tiba · semua tanggal]
                                   ↑ Toko Melati, the name alone — held, counted, cleared by Hapus Filter
```

| | |
| --- | --- |
| the control | `TeamSelect` over the **selling** teams, after the search — a search select, since there is no ceiling on how many teams a warehouse holds goods for; the pick is its name alone ([a-one-type-picker-shows-the-name-alone](context_decision.md#a-one-type-picker-shows-the-name-alone)) |
| the state | `?team=` in the URL, counted by the phone's Filter button, cleared by Hapus Filter and by its own × |
| ⚠ `teamFilter` | kind `dropped`, number 2: `BatchListFilter` has no owning team, so the pick is held and every batch still shows. The list's own `pages/batches/pending.ts` extends the batch screens' shared list, so a return's ⚠ keeps its 1 on both screens |
| not added | Status (Ada stok / Habis) — offered with it, not asked for |
| pinned by | BatchList `Team filter` (picked as *Toko Melati*, no *Selling*, the list unchanged, cleared), `Opens its source` (2 parts; the return still 1) |

What it replaces: a filter strip with no way to ask whose goods.
