# Decisions — the supplier screens

The owner's decisions about **`/inventories/suppliers`** (the team's own suppliers) and the screens beside it — Discover,
a supplier's page, the report. **Append-only** (RULE 12): a reversed decision is renamed and its references grepped.

The rules every screen follows are in [context_decision.md](context_decision.md); the supplier *business* decisions stay
in [supplier/context_decision.md](../../business/supplier/context_decision.md), where the two lists were decided
([manage-and-discover-are-two-pages](../../business/supplier/context_decision.md#manage-and-discover-are-two-pages),
[discover-searches-every-teams-suppliers](../../business/supplier/context_decision.md#discover-searches-every-teams-suppliers)).

| decision | what it decided |
| --- | --- |
| [the-suppliers-list-follows-the-screen-rules](#the-suppliers-list-follows-the-screen-rules) | the team's supplier list applies the screen rules: Discover's columns minus the team, the shared FilterBar with the store type, the name sorting from its heading, the growing pager; a block per supplier on a phone |
| [a-store-count-sits-in-its-badge](#a-store-count-sits-in-its-badge) | a supplier's store count sits inside its marketplace badge — *Shopee ×3* — on both supplier lists |
| [a-supplier-action-is-labelled](#a-supplier-action-is-labelled) | *Tambah Pemasok* carries its ＋; a row's Ubah and Hapus are labelled buttons — at a phone block's foot |
| [the-add-supplier-form-shows-examples](#the-add-supplier-form-shows-examples) | the add dialog is *Tambah Pemasok*, its button *Tambah*, every field showing an example |
| [a-supplier-row-lights-up](#a-supplier-row-lights-up) | a supplier row lights up under the pointer, every cell of it; a phone block while pressed |

## the-suppliers-list-follows-the-screen-rules

> Owner, in chat (2026-10-09), after reading the supplier context: *"sekarang ke suppliers, coba terapkan keputusan"*.

```
Pemasok  [Toko Melati]                                          [Pemasok Baru]
Pemasok yang dikelola tim ini — vendor tempat tim membeli stoknya.
[Cari pemasok, alamat, atau saluran]  [Semua jenis saluran ⌄]        Hapus filter
Pemasok ⇅                    · Saluran                       · Kontak        Aksi
PT Sumber Makmur               [Shopee] [Tokopedia] [Other]    0812-1111-2222  ✎ 🗑
Jl. Soekarno-Hatta 112, Bandung
                                           Per halaman [20 ⌄]  ‹ [1] ›

on a phone
PT Banyak Toko                                       ✎ 🗑
[Shopee] ×3 [Tokopedia] ×2 [Lazada] …
0811-5555-6666 · Jl. Gatot Subroto 20, Jakarta
```

| rule | applied |
| --- | --- |
| the columns | **Discover's, minus the team** — *Pemasok* (the name bold, the address under it: one context, two lines, as Discover's), *Saluran*, *Kontak*, and Edit and Delete for a selling team. It was Nama · Kontak · Alamat |
| a supplier's stores | `ChannelTypes` — one badge per channel type, *Shopee ×3*, a deleted store not counted ([a-store-delete-is-soft-too](../../business/supplier/context_decision.md#a-store-delete-is-soft-too)). Moved from Discover to `features/suppliers/` — two lists read a supplier's stores the same way now. The list asks `SupplierList` for its CHANNELS slice |
| [a-phone-filters-from-a-sheet](context_decision.md#a-phone-filters-from-a-sheet) · [clear-filters-is-red-and-bold](context_decision.md#clear-filters-is-red-and-bold) | the shared `FilterBar`: the search (debounced, as Discover's) and **the store type** — the contract's `channel_type`, a live store of that type; Clear, red and bold, puts both back; the type in the sheet on a phone |
| [a-table-sorts-from-its-headings](context_decision.md#a-table-sorts-from-its-headings) | **Pemasok** sorts — the one heading the contract orders by (`SupplierRowSort.NAME`), A to Z first, then flips. The list's own order, before any click, is newest first. On a phone the sort is a select in the Filter sheet, with *Terbaru dulu* |
| the pager | `GrowingPager`, 10 / 20 / 50 a page — as the accounts list, the report and an account's statement |
| [a-phone-reads-each-line-as-a-block](context_decision.md#a-phone-reads-each-line-as-a-block) | a supplier is a block: the name, its stores (the line skipped when it has none), the contact and the address; Edit and Delete beside the name |
| the header | the title and the team's badge, the page's purpose under them; the title block takes a basis (`1 1 16rem`) so *Pemasok Baru* wraps under it rather than squeezing it |
| empty | *Tidak ada pemasok ditemukan.* with no filter; *Tidak ada pemasok yang cocok.* when a search or a type narrowed it |
| unchanged | Edit and Delete inline (two actions stay on the row), Delete confirms and keeps the supplier for its figures ([a-deleted-supplier-is-kept-for-its-figures](../../business/supplier/context_decision.md#a-deleted-supplier-is-kept-for-its-figures)); a warehouse team reads why it has none ([only-a-selling-team-has-suppliers](../../business/supplier/context_decision.md#only-a-selling-team-has-suppliers)); a row opens the supplier's page |
| the stub | `SupplierList` in Storybook now sorts by name as the server does — the name, then the id to break a tie |

## a-store-count-sits-in-its-badge

> Owner, in chat (2026-10-09): *"untuk saluran, x2 x3, masuk badge?"* — then *"ya begitu"* to the drawing.

```
before                          now
[Shopee] ×3  [Tokopedia] ×2     [Shopee ×3]  [Tokopedia ×2]  [Lazada]
```

| | |
| --- | --- |
| the count | **inside** the marketplace badge, after the name, a step quieter (70% opacity) — one chip per type, evenly spaced |
| one store | no count — *Lazada*, not *Lazada ×1* |
| where | `MarketplaceBadge`'s new `count` prop (the shared badge extended, not forked); `ChannelTypes` passes it — so the team's list and Discover change together |
| was | the count beside the badge in small muted text — a gap after every *×3* made the row of chips uneven |

## a-supplier-action-is-labelled

> Owner, in chat (2026-10-09): *"pemasok baru jadi tambah pemasok ada iconnya, actionnya kasih label"*.

```
desktop                                                    phone
Pemasok [Toko Melati]                  [＋ Tambah Pemasok]   PT Sumber Makmur
…  PT Sumber Makmur … 0812-…   [✎ Ubah] [🗑 Hapus]          [Shopee] [Tokopedia] [Other]
                                                           0812-1111-2222 · Jl. Soekarno-Hatta 112
                                                                         [✎ Ubah] [🗑 Hapus]
```

| | |
| --- | --- |
| the add button | **Tambah Pemasok** (en *Add Supplier*), its ＋ before it — the accounts list's add button, `xs` and brand. It was *Pemasok Baru*, no icon. The dialog it opens keeps its title, *Pemasok Baru* |
| a row's actions | **labelled** buttons, `xs` outline with their icon — *Ubah*, and *Hapus* in the error tone — as the accounts list's row buttons are. They were bare icons |
| on a phone | the two buttons sit at the block's **foot**, right-aligned: beside the name they squeezed the supplier into a narrow column, its badges wrapping and its address cut |
| unchanged | Hapus still confirms, and the supplier is kept for its figures |

## the-add-supplier-form-shows-examples

> Owner, in chat (2026-10-09): *"kasih placeholder untuk tambah pemasok, titlenya juga tolong diganti"* — and *"buat juga
> jadi tambah"*.

```
┌ Tambah Pemasok ─────────────────────────── × ┐
│ Nama *     [Contoh: PT Sumber Makmur       ] │
│ Kontak     [Contoh: 0812-3456-7890         ] │
│            Nomor telepon atau WhatsApp.      │
│ Alamat     [Contoh: Jl. Soekarno-Hatta 112, Bandung ] │
│ Deskripsi  [Contoh: grosir kain dan benang, minimal order 1 rol ] │
│                              [Batal] [Tambah] │
└──────────────────────────────────────────────┘
```

| | |
| --- | --- |
| the title | **Tambah Pemasok** (en *Add Supplier*) — the button that opens it says the same. It was *Pemasok Baru*. Editing keeps *Ubah Pemasok* |
| the submit | **Tambah** (en *Add*) — it was *Buat*. Editing keeps *Simpan* |
| the placeholders | an example in every field, *Contoh: …* — a name, a phone number, an address, what the supplier sells; sentence case, as every placeholder. Shown only while the field is empty, so editing a filled record shows none |

## a-supplier-row-lights-up

> Owner, in chat (2026-10-09), on the supplier list: *"hoverable"*.

| | |
| --- | --- |
| a desktop row | lights up under the pointer, **every cell** in `bg.muted` — the account statement's rule ([a-statement-row-lights-up](financial_accounts_decision.md#a-statement-row-lights-up)). It was a `bg.subtle` on the row, barely visible |
| a phone block | the same tone under a pointer and **while a thumb presses it** — the block is a control, it opens the supplier |
| a story | drives it with `data-hover`, which Chakra's `_hover` honours — a synthetic pointer sets no CSS `:hover` |

