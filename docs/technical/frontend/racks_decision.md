# Decisions — the racks

The owner's decisions about the **rack screens** — the list (`/inventories/racks`, `pages/racks`) and a rack's page
(`/inventories/racks/:rackId`, `pages/rack-detail`) with its two dialogs, Move Goods and Record Sample. **Append-only**
(RULE 12): a reversed decision is renamed and its references grepped.

The rules every screen follows are in [context_decision.md](context_decision.md). What a rack holds and what may move
off it is the business record: [placement_decision.md](../../business/inventory/placement_decision.md).

| decision | what it settles |
| --- | --- |
| [the-racks-follow-the-screen-rules](#the-racks-follow-the-screen-rules) | the rack list and a rack's page follow the rules every screen does — a titled header with its icon actions, the filter strip, skeletons, hints, the growing pager, a block per row on a phone, the card strip, Mobile stories — 🔄 a rack page's tabs REPLACED by [a-rack-page-is-one-page-of-sections](#a-rack-page-is-one-page-of-sections) |
| [an-empty-rack-says-so](#an-empty-rack-says-so) | a rack holding nothing carries **Kosong** on its row — under its code on a desktop, beside it on a phone, in the plain tone |
| [the-rack-list-leads-with-its-figures](#the-rack-list-leads-with-its-figures) | the rack list leads with the card strip — Rak, Terisi, Kosong, Stok di rak; the three past *Rak* are the page's, and say so once the racks run past one page |
| [a-rack-page-is-one-page-of-sections](#a-rack-page-is-one-page-of-sections) | a rack's page is the other detail pages' shape — three sections under a nav (Produk priced, Info, Riwayat with a *Hanya penempatan* chip), the title that sticks, Info beside the rest on a wide screen; its five vertical tabs (#197) are gone |
| [temuan-and-sampel-are-one-word](#temuan-and-sampel-are-one-word) | on a rack's page the two acts read **Temuan** and **Sampel** — on the button, in ⋯ and in the sticky bar; their dialogs keep the verb |
| [the-found-dialog-fits-its-fields](#the-found-dialog-fits-its-fields) | Temuan's dialog: the count is a short box (10rem; a phone's full width), the note a two-row box as the rack's other dialogs' |
| [a-found-waits-in-one-line](#a-found-waits-in-one-line) | a found's waiting notice is one line — *Stok berubah setelah disetujui Owner atau Admin gudang lain.* — on Temuan and on Koreksi stok's Found |
| [the-move-reads-pindah-rak](#the-move-reads-pindah-rak) | the move off a rack reads **Pindah Rak** (en *Move*) — on the act and its dialog's title; the submit keeps *Pindahkan* |

## the-racks-follow-the-screen-rules

> Owner, in chat (2026-11-07): *"sekarang inisiasi rack"* — start the rack screens from the rules every screen follows.

```
the list                                                              a rack's page
Rak                                              [+ Rak Baru]         ←  A-01-1                      [🎁 Catat Sampel] [⇄ Pindahkan]
Rak di gudang ini — kode yang tertempel di rak…                          Aisle A bawah
[⌕ Cari kode atau nama            ×]                                    ⚠ 1 bagian layar ini belum diimplementasi
Kode    Nama           Deskripsi       Produk  Stok  Aksi              [Di rak ini 25 unit · Rp 812.000] [Opname terakhir · Belum pernah]
A-01-1  Aisle A bawah  …                    3    25  [✎][🗑]           Info Rak │ Produk  Kopi Arabika 250g   [GP] Gudang Pusat   12
                                                ‹ [1] ›                 Produk   │         …
                                                                        Harga    │                                         ‹ [1] ›
phone   Rak                                       [+]                   phone  ←  A-01-1                  [🎁] [⇄]
        A-01-1  Aisle A bawah            [✎][🗑]                               Info Rak · Produk · Harga · Riwayat …   (across, scrolling)
        3 produk · 25 pcs                                                      Kopi Arabika 250g
                                                                               [GP] Gudang Pusat          Di rak ini 12
```

**The list** (`pages/racks`)

| rule | applied |
| --- | --- |
| [the-desktop-shell-has-no-top-bar](context_decision.md#the-desktop-shell-has-no-top-bar) | the page names itself — *Rak*, a line under it on what it is; no team badge, the switcher names the team |
| [an-action-button-carries-its-icon](context_decision.md#an-action-button-carries-its-icon) · [a-phone-header-action-is-an-icon](context_decision.md#a-phone-header-action-is-an-icon) | *Rak Baru* carries its `+` — on a phone, its icon alone (`CompactActions`). The form is now opened by the page, a new rack or a row's ✎, never its own trigger |
| [a-phone-filters-from-a-sheet](context_decision.md#a-phone-filters-from-a-sheet) · [clear-filters-is-red-and-bold](context_decision.md#clear-filters-is-red-and-bold) · [every-filter-clears-from-its-own-x](context_decision.md#every-filter-clears-from-its-own-x) | the search is `FilterBar`'s `FilterSearch` with its ×; typed, then settled (debounced); still in the URL ([a-lists-filters-live-in-the-url](context_decision.md#a-lists-filters-live-in-the-url)) |
| [a-table-row-lights-up](context_decision.md#a-table-row-lights-up) | every cell of a row lights up under the pointer; on a phone a block gives under a thumb |
| [one-context-per-column-and-never-three-lines](context_decision.md#one-context-per-column-and-never-three-lines) | the name is one line and the description two, cut, the whole on hover; the table scrolls in its own box |
| [a-phone-reads-each-line-as-a-block](context_decision.md#a-phone-reads-each-line-as-a-block) | on a phone each rack is a block — the code and name, ✎ 🗑, then *3 produk · 25 pcs*, the description under |
| [an-empty-list-shows-a-hint](context_decision.md#an-empty-list-shows-a-hint) | no match: *Tidak ada rak ditemukan* with *Hapus Filter*; no racks yet: *Belum ada rak* with *Rak Baru* |
| [every-list-pages-with-the-growing-pager](context_decision.md#every-list-pages-with-the-growing-pager) | `GrowingPager`, always on screen; it was `Pagination` |
| [motion-is-small-quick-and-shared](context_decision.md#motion-is-small-quick-and-shared) | the page rises in; a first load is a skeleton, not a spinner |
| row actions | ✎ and 🗑 stay inline (two), named for the rack — *Ubah rak A-01-1* — where they were *Edit* and *Delete* in English |
| the form | [every-form-field-shows-an-example](context_decision.md#every-form-field-shows-an-example) — *Contoh: A-01-1*, *Contoh: Lorong depan, rak bawah*, *Contoh: Dekat pintu bongkar…*; [a-limited-field-shows-its-count](context_decision.md#a-limited-field-shows-its-count) — the proto's 32, 200 and 500; the description a two-row box; *Buat* / *Simpan* with their icons |
| a rack opened from the list | carries the list (`fromHere`), so its back returns to it with the search |

**A rack's page** (`pages/rack-detail`)

| rule | applied |
| --- | --- |
| [the-phone-header-is-one-row](context_decision.md#the-phone-header-is-one-row) · [a-form-returns-where-it-was-opened](context_decision.md#a-form-returns-where-it-was-opened) | back is its icon in the title's row and returns where the page was opened — the list with its search; by a link, the list. It was *← Kembali ke Rak* above the page |
| the acts | *Catat Sampel* and *Pindahkan Barang* with their icons; on a phone their two icons ([a-phone-header-action-is-an-icon](context_decision.md#a-phone-header-action-is-an-icon)) — they were a ⋯ |
| [a-list-summary-is-the-order-lists-card-strip](context_decision.md#a-list-summary-is-the-order-lists-card-strip) | the two header tiles are the card strip — *Di rak ini* (units, its value under it, and how many products have no price, in amber) leading, then *Opname terakhir* |
| [a-date-speaks-the-apps-language](context_decision.md#a-date-speaks-the-apps-language) | the last count's date is `formatUnixDate` — it was the browser's |
| the tabs | still down the left on a desktop (#197); on a phone across the top, scrolling in their own row ([nothing-runs-past-a-phones-edge](context_decision.md#nothing-runs-past-a-phones-edge)) |
| [a-table-row-lights-up](context_decision.md#a-table-row-lights-up) · [a-phone-reads-each-line-as-a-block](context_decision.md#a-phone-reads-each-line-as-a-block) | Produk and Harga light up; on a phone each product is a block — the product, whose it is, *Di rak ini 12* (and on Harga, *Rp … × 12 … Rp …*) |
| [an-empty-list-shows-a-hint](context_decision.md#an-empty-list-shows-a-hint) | an empty shelf says what fills it; an empty history is `MovementTable`'s hint — the reworked ledger, whose rows light up and which reads two lines a movement on a phone |
| [every-list-pages-with-the-growing-pager](context_decision.md#every-list-pages-with-the-growing-pager) · [motion-is-small-quick-and-shared](context_decision.md#motion-is-small-quick-and-shared) | the shelf and both histories page with `GrowingPager`; a first load is a skeleton; the page rises in |
| the dialogs | Move Goods' and Record Sample's notes are two-row boxes with their 500 count, the recipient its 200; every placeholder an example (*Contoh: …*); the submits carry their icons |
| kept | what each tab reads, the hand-rolled reads and `reloadKey`; the value on the shelf (no decision about a warehouse's money here); the pending mark `countLock` |

| | |
| --- | --- |
| pinned by | the list: `Default`, `Mobile`, `Nothing matches`, `No racks yet`, `Form, examples and counts` (and the eight before, with short names) · a rack: `Default`, `Mobile`, `Back to the list`, `An empty rack` (and the ten before) · e2e `racks.spec.ts` (an empty warehouse is the hint) |

What it replaces: the racks' own layout — a team badge by the title, a bare search box, a spinner, *Pagination*, a grey
empty line, *Edit*/*Delete* in English; on a rack's page a labelled back over the title, two plain tiles, a ⋯ on a
phone, the browser's date and vertical tabs that ran past a phone's edge.

## an-empty-rack-says-so

> Owner, in chat (2026-11-07): *"sedikit sepi, ada saran?"* — then, of four proposals, *"3, 4"*.

```
desktop   B-02-1      Aisle B bawah   …   0   0   [✎][🗑]
          [Kosong]
phone     B-02-1 [Kosong]  Aisle B bawah        [✎][🗑]
          0 produk · 0 pcs
```

| | |
| --- | --- |
| when | the rack's stock count is 0 — nothing on it |
| why | the one a delivery can be put away into, and the only one that can be deleted — worth seeing without reading the Stok column |
| where | under the code on a desktop, where a row's status sits ([one-context-per-column-and-never-three-lines](context_decision.md#one-context-per-column-and-never-three-lines)); beside the code on a phone |
| tone | `gray` — the plain tone: being empty is neither good nor bad |
| pinned by | RackList `Default` (B-02-1 alone) · `Mobile` |

What it replaces: an empty rack told apart only by the 0 in its Stok column.

## the-rack-list-leads-with-its-figures

> Owner, in chat (2026-11-07): *"3, 4"*.

```
[Rak 3] [Terisi 2] [Kosong 1] [Stok di rak 34 pcs]          every rack on the page — exact, nothing marked
[Rak 21] [Terisi ⚠1 2] [Kosong ⚠1 18] [Stok di rak ⚠1 …]     21 racks, 20 a page — the three are the page's, marked
```

| | |
| --- | --- |
| the strip | the order list's card strip ([a-list-summary-is-the-order-lists-card-strip](context_decision.md#a-list-summary-is-the-order-lists-card-strip)), between the title and the search: **Rak** leads, then **Terisi**, **Kosong**, **Stok di rak** (pcs) |
| Rak | the server's count of the racks listed — real, whatever the page |
| the three | summed from the racks on the page (RackList's STOCK slice answers for the page it serves). While every rack fits one page they are exact and nothing is marked; past it they carry ⚠ `pageTotals`, kind `missing` — racks on other pages are not in them (`pages/racks/pending.ts`) |
| a search | narrows them too — they describe the list as it is shown |
| pinned by | RackList `Default` (3 · 2 · 1 · 34 pcs, no mark) · `Figures past one page` (21; Kosong 18 of the page; ⚠ on the three, not on Rak) |

What it replaces: a list with no figures over it.

## a-rack-page-is-one-page-of-sections

> Owner, in chat (2026-11-09): *"inisiasi rack detail page"*; offered the other detail pages' shape in place of the
> tabs, *"iya seperti usulmu, gunakan detail lain sebagai referensi"*. Then, on the five sections that made: *"produk dan
> harga sama, apa pembedanya selain ada harganya / riwayat stok dan penempatanpun kelihatan sama, apa bedanya?"* — to
> three sections, *"oke"*.

```
before (#197, tabs)                         now — the product page's and the restock pages' shape
← A-01-1             [🎁] [⇄]               ┌ Produk  ┐  ← A-01-1  Aisle A bawah   [⊕ Laporkan Temuan] [🎁 Catat Sampel] [⇄ Pindahkan]
[Di rak ini] [Opname terakhir]              │ Info    │  [Di rak ini 25 unit · Rp …] [Opname terakhir · Belum pernah]
Info Rak │                                  └ Riwayat ┘  ┌ Produk ── Produk · Tim · Di rak ini · Harga/pcs · Nilai ┐  ┌ Info ─────────┐
Produk ● │  one tab's content                            ┌ Riwayat ── (Semua) (Hanya penempatan) ────────────────┐  │ Kode · Nama · │
Harga    │                                                                                                         │ Deskripsi     │
Riwayat… │  (five tabs)                                                                                            └───────────────┘
```

| | |
| --- | --- |
| the shape | ONE page of section cards (`Section`) with `SectionNav` on the left; a click jumps and the card blinks ([a-nav-jump-blinks-where-it-lands](context_decision.md#a-nav-jump-blinks-where-it-lands)); the section being read is lit (`useScrollSpy`). No tabs |
| the order | **Produk** (what somebody at the shelf came for) · **Info** · **Riwayat** — `pages/rack-detail/sections.ts`, the one list the nav and the page read |
| why three, not five | the tabs' two pairs were one read each: **Harga** was Produk's table with two more columns, and **Riwayat Penempatan** was Riwayat Stok narrowed to Diterima and Pindah rak (`PLACEMENT_KINDS`) — every row of it also a row of Riwayat Stok. Behind tabs one was on screen at a time; on one page each read twice |
| Produk | the shelf priced: Produk · Tim · Di rak ini · **Harga/pcs · Nilai** — one read, one pager (`useRackShelf`); on a phone the block's last line is *Rp … × 12 … Rp …* |
| Riwayat | the one ledger, with `FilterChips` over it — **Semua** (every movement) or **Hanya penempatan** (Diterima and Pindah rak only, what decided goods live here, its hover says so; owner: *"penempatan jadi hanya penempatan"* — the chip says it narrows); a chip resets the pager. The chips stay while the ledger under them loads |
| the title | back, the code painted on the shelf with the name under it, the acts held right — `RackTitleRow`, drawn twice: the page's, and the bar that sticks once all of it has scrolled away ([a-sticky-bar-waits-for-the-whole-title-row](context_decision.md#a-sticky-bar-waits-for-the-whole-title-row), `useStickyTitle`, `ProductStickyStrip`). The bar's acts are their icons, `-sticky` test ids |
| the figures | the card strip stays under the title, over the sections — the whole rack's, as before |
| Info | the rack's short record — Kode, Nama, Deskripsi as `Fact`s — beside the rest from `xl`, as a restock's Kiriman; in the nav's order below that. Scrolling lights only the main column's sections while it stands beside them |
| a phone | the section chips stick at the top in place of the nav; the acts are their icons, three folded into ⋯; each product a block |
| kept | every read, `reloadKey`, the dialogs; `rack-detail-stock` for the shelf's table, the panels as `rack-<key>-panel`; the ledger is `rack-history` (it was `rack-stock-history` and `rack-placement-history`) |
| stories | 22 stories, so folders by the part of the screen ([stories-are-grouped-by-the-part-of-the-screen](context_decision.md#stories-are-grouped-by-the-part-of-the-screen)): Default and Mobile under RackDetail; Found, Header, History, Move, Sample, Sections, Shelf |
| pinned by | RackDetail `Default`, `Mobile` (the block's price line) · `Sections / One page of sections` (three, Produk priced), `Nav jumps` · `Header / Title sticks` · `History / Penempatan lens` (a move stays, a sample goes) · e2e `racks.spec.ts` (the nav jumps; the Penempatan chip) |

What it replaces: the five vertical tabs of #197 — one section on screen at a time — and the *the tabs* row of
[the-racks-follow-the-screen-rules](#the-racks-follow-the-screen-rules); the Harga and Riwayat Penempatan tabs, now a
column pair and a chip.

## temuan-and-sampel-are-one-word

> Owner, in chat (2026-11-09), on the rack page's acts: *"laporan temuan ada saran 1 kata? catat sampel jadi sampel
> saja"* — offered *Temuan*, as a noun beside *Sampel*: *"temuan"*.

```
before                                              now
[⊕ Laporkan Temuan] [🎁 Catat Sampel] [⇄ Pindahkan Barang]   [⊕ Temuan] [🎁 Sampel] [⇄ Pindahkan Barang]
```

| | |
| --- | --- |
| the acts | **Temuan** and **Sampel** (en *Found*, *Sample*) — what is recorded, named alike as nouns; on the desktop button, in the phone's and the sticky bar's ⋯ (`racks.reportFound.action`, `racks.sample.action`) |
| the dialogs | keep their verb, since there it says what is being done: *Laporkan Temuan di A-01-1* · *Catat Sampel dari A-01-1*, and the submit *Catat Sampel* |
| not changed | *Pindahkan Barang* — not asked (🔄 since renamed *Pindah Rak*, [the-move-reads-pindah-rak](#the-move-reads-pindah-rak)); *Lapor* alone was not taken (report what?), nor *Ditemukan* (reads as a status, not an act) |
| pinned by | the rack page's stories find the acts by test id (`rack-action-report-found`, `rack-action-sample`), which did not change |

What it replaces: *Laporkan Temuan* and *Catat Sampel* on the acts.

## the-found-dialog-fits-its-fields

> Owner, in chat (2026-11-09), on Temuan's dialog: *"catatan textarea, jumlahnya tolong sedikit dipersempit, agak lebar"*.

```
before                                         now
Jumlah ditemukan                               Jumlah ditemukan
[ −            1                     + ]       [ −   1   + ]
Catatan                                        Catatan
[ Contoh: di belakang karton …        ]        [ Contoh: di belakang karton …        ]
                                               [                                     ]
```

| | |
| --- | --- |
| the count | `QuantityInput` 10rem (`width="40"`) on a desktop — a few units, a box its size; a phone keeps the full width for the thumb |
| the note | a two-row `Textarea` with its 200 count, as Move Goods' and Sample's notes — where it was found is often a sentence |
| where | `features/inventory/ReportFoundDialog` — the rack page's Temuan |
| pinned by | RackDetail `Found / Staff report a found` (the count under half the dialog, the note a textarea) |

What it replaces: a count box as wide as the dialog, and a one-line note.

## a-found-waits-in-one-line

> Owner, in chat (2026-11-09), on Temuan's notice: *"alertnya kepanjangan, ada yang lebih ringkas?"* — offered one line,
> and the same for Koreksi stok's Found with its extra line as a hover: *"pakai itu"*.

```
before                                                      now
ⓘ Menunggu Owner atau Admin gudang                           ⓘ Stok berubah setelah disetujui Owner atau Admin gudang lain.
  Tidak ada yang berubah sampai salah satu dari mereka …
  Owner atau Admin lain yang menyetujuinya — bukan …
```

| | |
| --- | --- |
| the line | *Stok berubah setelah disetujui Owner atau Admin gudang lain.* (`inventory.foundWaits`) — that it waits, who approves it, and that the reporter does not (*lain*); *no batch, no money* is not what somebody at a shelf needs to read |
| where | Temuan (`ReportFoundDialog`, the rack page) and Koreksi stok's Found (`AdjustStockDialog`, a warehouse product's page) |
| Koreksi's extra line | what an approval claims back first — the oldest open loss, at its price — is the notice's hover (`title`), no longer a line of it |
| retired | `inventory.adjustFoundWaitsTitle`, `adjustFoundWaitsNothing`, `adjustFoundWaitsNotYou` |
| pinned by | RackDetail `Found / Staff report a found` · `AdjustStockDialog` Found (the line, and the hover) · e2e `found_requests.spec.ts` |

What it replaces: the three-line notice on both dialogs.

## the-move-reads-pindah-rak

> Owner, in chat (2026-11-09), on the rack page's acts: *"pindah barang jadi pindah rak"*.

```
before                                               now
[⊕ Temuan] [🎁 Sampel] [⇄ Pindahkan Barang]          [⊕ Temuan] [🎁 Sampel] [⇄ Pindah Rak]
dialog  Pindahkan Barang dari A-01-1                 dialog  Pindah Rak dari A-01-1
```

| | |
| --- | --- |
| the act | **Pindah Rak** (en *Move*) — what happens to the goods is that they change rack; *barang* said nothing the rack page does not already say. On the desktop button, in the phone's and the sticky bar's ⋯ (`racks.move.action`) |
| the dialog's title | the same words: *Pindah Rak dari A-01-1* (`racks.move.title`) |
| not changed | the submit *Pindahkan* — the verb, as Sampel's *Catat Sampel* · *Ganti Rak* inside the dialog, which re-points one line |
| pinned by | RackDetail `Mobile` reads the act in ⋯ (`rack-action-move`, now *Move*) |

What it replaces: *Pindahkan Barang* on the act and the dialog's title.
