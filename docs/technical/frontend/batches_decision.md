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
| [the-batches-follow-the-screen-rules](#the-batches-follow-the-screen-rules) | the batch list and a batch's page follow the rules every screen does — the card strip, the filter strip, a block per row on a phone, skeletons, hints, the growing pager, Mobile stories; a batch is named by its OWN number, the restock it came from under it — 🔄 a batch page's tabs REPLACED by [a-batch-page-is-one-page-of-sections](#a-batch-page-is-one-page-of-sections) |
| [a-batch-says-what-it-is](#a-batch-says-what-it-is) | both batch screens say what a batch is — a line under the list's title, and *Apa itu batch?* whose tooltip holds the answer with an example; hover opens it, and a click or a tap |
| [sku-is-copyable](#sku-is-copyable) | a batch's SKU copies on a click — on the list's row and block, and under a batch's product — without opening the batch |
| [an-expiry-says-how-long-is-left](#an-expiry-says-how-long-is-left) | the batch list's *Kedaluwarsa* is the day alone at *Tiba*'s size, with how long is left under it — amber within 30 days, red once past |
| [a-batch-opens-where-it-came-from](#a-batch-opens-where-it-came-from) | a batch's source is a way there — *Restok #503* opens the restock, no resi; a return's *Retur* is marked until a batch knows its return — 🔄 on a batch's page it is Info's *Dari*, [a-batch-page-is-one-page-of-sections](#a-batch-page-is-one-page-of-sections) |
| [the-batch-list-filters-by-team](#the-batch-list-filters-by-team) | the batch list filters by whose goods — a search select over the selling teams, the pick its name alone; held in the URL and marked, it narrows nothing yet |
| [a-batch-page-is-one-page-of-sections](#a-batch-page-is-one-page-of-sections) | a batch's page is the rack page's shape — Ditaruh, Info, Riwayat under a nav, the heading that sticks with the product under the number, Info beside the rest on a wide screen; its two tabs are gone |
| [the-adjust-dialog-picks-with-chakra-controls](#the-adjust-dialog-picks-with-chakra-controls) | Koreksi's note is a two-row `Textarea`, and its reason a Chakra control — [chakra-first-whenever-it-has-the-component](context_decision.md#chakra-first-whenever-it-has-the-component) applied |
| [the-adjust-reason-is-a-radio-pill](#the-adjust-reason-is-a-radio-pill) | Koreksi's four reasons are radio pills, all on screen — the list is bounded by the code, so it stays few |
| [a-batch-is-picked-by-its-own-number](#a-batch-is-picked-by-its-own-number) | Koreksi's batch is a search select (`BatchSelect`) — each option the batch's own number and ready count, where it came from under it; typed by the batch's or the restock's number |

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

## a-batch-page-is-one-page-of-sections

> Owner, in chat (2026-11-10): *"inisiasi bacth detail"* — after a rack's page became one page of sections, *"iya seperti
> usulmu, gunakan detail lain sebagai referensi"* ([a-rack-page-is-one-page-of-sections](racks_decision.md#a-rack-page-is-one-page-of-sections)).
> The batch's page was the last detail page on tabs.

```
before (tabs)                                      now — the rack page's shape
← Batch #5031 [Restok] [Kedaluwarsa…]  [✎ Koreksi]   ┌ Ditaruh ┐  ← Batch #5031 [Restok] [Kedaluwarsa 29 Nov]            [✎ Koreksi]
  [img] Beras …   [TM] Toko Melati                   │ Info    │     [img] Beras Pandan Wangi 5kg · SKU   [TM] Toko Melati
  Dari Restok #503 · Diterima oleh Budi              └ Riwayat ┘     ⓘ Apa itu batch?
  ⓘ Apa itu batch?                                                [Tiba 10] [Rusak 2] [Hilang 1] [Terpakai 0] [Siap 7]
[Tiba] [Rusak] [Hilang] [Terpakai] [Siap]                         ┌ Ditaruh Saat Diterima ───────────┐  ┌ Info Batch ──────────────┐
Ditaruh Saat Diterima │ one tab's content                         │ Tempat · Ditaruh · Opname        │  │ Dari          Restok #503│
Riwayat               │                                           ┌ Riwayat ── (Tiba · semua tanggal)┐  │ Diterima oleh Budi       │
                                                                                                         │ Harga satuan  Rp 48.000  │
                                                                                                         │ Kedaluwarsa   29 Nov · 20 hari lagi │
```

| | |
| --- | --- |
| the shape | ONE page of section cards (`Section`) with `SectionNav` on the left; a click jumps there; the section being read is lit (`useScrollSpy`). No tabs |
| the order | **Ditaruh Saat Diterima** · **Info Batch** · **Riwayat** — `pages/batch-detail/sections.ts`, the one list the nav and the page read |
| Ditaruh Saat Diterima | where the accept put the units — **fixed**, never where they sit now ([a-batch-shows-the-racks-it-was-put-on](../../business/inventory/batch_decision.md#a-batch-shows-the-racks-it-was-put-on)); only its *Opname terakhir* is today's. Kept a section of its own, not folded into Info, though Riwayat's first rows are the same put-away — owner: *"tidak perlu, riwayat itu beda konteks"* |
| the heading | back, *Batch #5031* with its origin and expiry badges, Koreksi held right (`BatchTitleRow`); under it the product with its picture and whose it is, then *Apa itu batch?* |
| Info | the batch's record, moved out of the heading's third line: **Dari** (*Restok #503*, still a way there — [a-batch-opens-where-it-came-from](#a-batch-opens-where-it-came-from)), **Diterima oleh**, **Harga satuan** (the frozen cost, the rack page's word for it — it was *Biaya / pcs (beku)*, never on screen), **Kedaluwarsa** (the day and how long is left, as the list says it — [an-expiry-says-how-long-is-left](#an-expiry-says-how-long-is-left); a dash when it has none). Beside the rest from `xl`, in the nav's order below that |
| the sticky bar | the title row drawn again once the WHOLE heading has scrolled away — the number with the **product under it** (*Batch #5031* alone says nothing), back, Koreksi as its icon (`batch-detail-adjust-sticky`). It waits for the product line too, so the product is never on screen twice |
| the figures | the lifecycle strip stays under the heading, over the sections — the whole batch's |
| a phone | the section chips stick at the top in place of the nav; Koreksi its icon |
| kept | every read and its pager, the rack search and the date range in the URL, the panels' tables and test ids; panels `batch-<key>-panel` |
| moved | `ExpiryCell` to `features/inventory/` — two pages read it now; it takes a `fontSize` (12px in a table, a fact's size in Info) |
| retired | `BatchSource`'s `prefix` (*Dari Restok #503*) — Info's label says *Dari*; `batchDetail.fromRestock`, `batchDetail.receivedBy` |
| stories | 10 — one file still ([stories-are-grouped-by-the-part-of-the-screen](context_decision.md#stories-are-grouped-by-the-part-of-the-screen) starts at ~15) |
| pinned by | BatchDetail `One page of sections` (the order, no tablist, Info's four facts, the expiry amber, the nav jump) · `Title sticks` (the product under the number) · `Mobile` (the chips) · `Default`, `History` |

What it replaces: the two tabs — one on screen at a time — and the *the tabs* row of
[the-batches-follow-the-screen-rules](#the-batches-follow-the-screen-rules); the heading's *Dari Restok #503 · Diterima
oleh …* line, now Info's first two facts.

## the-adjust-dialog-picks-with-chakra-controls

> Owner, in chat (2026-11-10), on a batch's Koreksi: *"di koreksi, alasan selectnya cakra, catatan textarea"*. The rule
> was already the owner's — [chakra-first-whenever-it-has-the-component](context_decision.md#chakra-first-whenever-it-has-the-component),
> 2026-10-05 — and the dialog had broken it since.

```
before                                    now
Alasan  [Hitung ulang        ▾]  native   Alasan   ( ◉ Hitung ulang ) ( ○ Rusak ) ( ○ Hilang ) ( ○ Ditemukan )
Catatan [Contoh: …              ]         Catatan  [Contoh: …                  ]
                                                   [                           ]   ← two rows, its 200 count
```

| | |
| --- | --- |
| the reason | first a Chakra `Select` — then, the same day, radio pills: [the-adjust-reason-is-a-radio-pill](#the-adjust-reason-is-a-radio-pill) |
| the note | a two-row `Textarea` with its 200 count, as Temuan's and the rack's dialogs' |
| where | `features/inventory/AdjustStockDialog` — a batch's page and a warehouse product's page open the same dialog |
| the batch | under Damaged and Lost — a search select since, [a-batch-is-picked-by-its-own-number](#a-batch-is-picked-by-its-own-number) |
| pinned by | AdjustStockDialog `Reason and note` (a textarea) · e2e `found_requests.spec.ts` |

What it replaces: the native `<select>` of reasons and the one-line note.

## the-adjust-reason-is-a-radio-pill

> Owner, in chat (2026-11-10), on the Chakra Select just made: *"alasan apa mungkin akan banyak sekali di masa depan, aku
> ingin itu jadi pilihan radio kalau masih sedikit"*. It is few, and stays few.

```
Alasan *   ( ◉ Hitung ulang )  ( ○ Rusak )  ( ○ Hilang )  ( ○ Ditemukan )     ← wraps on a phone
```

| | |
| --- | --- |
| why it stays few | the list is `StockAdjustReason` (Recount, Damaged, Lost) and Found — each with its own ledger rule on the server (a whole-shelf count, a batch's write-off, a request that waits). A fifth reason is a proto and server change, never data that grows — bounded forever, not only today |
| the control | `RadioPills` ([a-dialog-choice-is-a-radio-pill](financial_accounts_decision.md#a-dialog-choice-is-a-radio-pill)) — every reason on screen, one click to change it, the chosen one rose; Recount as it opens. A list to open was a click to see four words |
| what follows a pick | unchanged — Damaged and Lost ask for their batch, Found shows its waiting line and starts the count at 1 |
| the rule it applies | [chakra-first-whenever-it-has-the-component](context_decision.md#chakra-first-whenever-it-has-the-component): one of a few choices is a radio; a `Select` is for a longer list, a `Combobox` for one that grows |
| pinned by | AdjustStockDialog `Reason and note` (four radios, Recount checked, no combobox, Lost then asks for its batch) · `FoundWaitsForApproval`, `DamagedStillNamesItsBatch` pick through it · e2e `found_requests.spec.ts` |

What it replaces: the Chakra `Select` of reasons made earlier the same day.

## a-batch-is-picked-by-its-own-number

> Owner, in chat (2026-11-10): *"batch selectnya"* — taking the offer to make Koreksi's batch picker, under Damaged and
> Lost, the search select a growing list is.

```
Batch *   [ Cari nomor batch atau restok        × ⌄ ]
          ┌──────────────────────────────────────────┐
          │ #5031                            Siap 7  │   ← the batch's OWN number — the one on the box's label
          │ Restok #503 · 1 Nov                      │   ← where it came from, when it arrived
          │ #5032                           Siap 17  │
          │ Restok #503 · 1 Nov                      │
          └──────────────────────────────────────────┘
picked    [ #5031 · 7 siap                      × ⌄ ]
```

| | |
| --- | --- |
| the control | `components/pickers/BatchSelect` — a Chakra `Combobox`: a product gains a batch with every restock, so it is typed into, never scrolled ([a picker over data that grows is a search select](../../../CLAUDE.md)) |
| what it offers | the product's batches in this warehouse that still hold stock (`useProductBatches`, loaded whole), filtered **in the field** — as `ShopSelect` |
| an option | the batch's **own number** and its ready count; under it *Restok #503* (or *Retur*) and the day it arrived. It was the **restock's** number — *#503 · 7 siap* — so two batches of one restock read alike, the mistake [the-batches-follow-the-screen-rules](#the-batches-follow-the-screen-rules) put right on the batch screens |
| a search | the batch's number or the restock's — *#5031*, *5031*, *503*; never the ready count |
| clearing | its × empties it to none (`0n`), and Adjust is off again |
| empty | *Tidak ada batch yang masih berstok* when the product has none; *Tidak ada batch yang cocok* when the search matches none |
| inside the dialog | never portalled — a portalled list would land outside the modal, inert |
| a prefilled value | remounts once when the batches land, so it is not drawn blank; an empty field keeps its mount, so nothing typed is lost |
| retired | `inventory.moveBatchOption` (the restock's number), `inventory.adjustBatchPlaceholder` (*Unit dari pengiriman mana…*) |
| pinned by | BatchSelect `Default` (own number, ready, restock under it), `Searches by number`, `Picks and clears`, `Nothing with stock` · AdjustStockDialog `DamagedStillNamesItsBatch` (Adjust off until a batch is picked) |

What it replaces: a `NativeSelect` of batches named by their restock's number.
