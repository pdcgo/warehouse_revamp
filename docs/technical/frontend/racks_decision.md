# Decisions — the racks

The owner's decisions about the **rack screens** — the list (`/inventories/racks`, `pages/racks`) and a rack's page
(`/inventories/racks/:rackId`, `pages/rack-detail`) with its two dialogs, Move Goods and Record Sample. **Append-only**
(RULE 12): a reversed decision is renamed and its references grepped.

The rules every screen follows are in [context_decision.md](context_decision.md). What a rack holds and what may move
off it is the business record: [placement_decision.md](../../business/inventory/placement_decision.md).

| decision | what it settles |
| --- | --- |
| [the-racks-follow-the-screen-rules](#the-racks-follow-the-screen-rules) | the rack list and a rack's page follow the rules every screen does — a titled header with its icon actions, the filter strip, skeletons, hints, the growing pager, a block per row on a phone, the card strip, Mobile stories |
| [an-empty-rack-says-so](#an-empty-rack-says-so) | a rack holding nothing carries **Kosong** on its row — under its code on a desktop, beside it on a phone, in the plain tone |
| [the-rack-list-leads-with-its-figures](#the-rack-list-leads-with-its-figures) | the rack list leads with the card strip — Rak, Terisi, Kosong, Stok di rak; the three past *Rak* are the page's, and say so once the racks run past one page |

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
