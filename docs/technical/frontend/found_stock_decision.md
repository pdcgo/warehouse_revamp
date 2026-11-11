# Decisions — Found Stock

The owner's decisions about the **Found Stock** screen — the approval list of found units
(`/inventories/found-stock`, `pages/found-requests`). **Append-only** (RULE 12): a reversed decision is renamed and its
references grepped.

The rules every screen follows are in [context_decision.md](context_decision.md). What a found is, who reports it and
who approves it is the business record: [opname_decision.md](../../business/inventory/opname_decision.md)
(an-adjust-found-waits-for-the-owner-or-admin, staff-may-report-a-found, the-reporter-may-withdraw-their-found). The
two dialogs that send a found — Temuan on a rack's page and Koreksi's Ditemukan — are in
[racks_decision.md](racks_decision.md) and [batches_decision.md](batches_decision.md).

| decision | what it settles |
| --- | --- |
| [the-found-list-follows-the-screen-rules](#the-found-list-follows-the-screen-rules) | the list follows the rules every screen does — the page rises in, a first load is a skeleton, each request shows its product with its picture and code and its owner as the small avatar and name, a posting line lights up, short dates, a Mobile story that runs past no edge — 🔄 its card REPLACED by [the-found-list-is-a-table](#the-found-list-is-a-table) |
| [the-found-tab-row-never-scrolls](#the-found-tab-row-never-scrolls) | the status tabs draw no scrollbar — `overflowY` hidden, as the other lists' tab rows; on a narrow phone the row still slides, with no bar |
| [the-found-list-is-a-table](#the-found-list-is-a-table) | one request a row, two lines a cell — the reference with its status under it, product, owner, what was found where, who reported it, what it posts, Setujui and Tolak; the note and the posting lines are its **Rincian**, a click on the row; a phone reads each as a block |

## the-found-list-follows-the-screen-rules

> Owner, in chat (2026-11-10): *"inisiasi found"*.

```
before                                                     now
Stok Ditemukan                                             Stok Ditemukan
Menunggu │ Disetujui │ Ditolak │ Semua                     Menunggu │ Disetujui │ Ditolak │ Semua
⟳ (a spinner)                                              ▭▭▭ (a skeleton, the list's shape)
┌───────────────────────────────────────────────┐          ┌──────────────────────────────────────────────────────┐
│ Beras Pandan Wangi 5kg          #301 [Menunggu]│          │ [img] Beras Pandan Wangi 5kg          #301 [Menunggu] │
│ SKU-BERAS-5K · Toko Melati                     │          │       SKU-BERAS-5K ⧉                                   │
│ 4 unit di B-02-1                               │          │ [TM] Toko Melati                                      │
│ …                                              │          │ 4 unit di B-02-1                                      │
│ #7 · kehilangan #91 tanggal 27 Sep 2026        │          │ #7 · kehilangan #91 tanggal 27 Sep   ← a row lights up │
└───────────────────────────────────────────────┘          └──────────────────────────────────────────────────────┘
```

| rule | applied |
| --- | --- |
| [motion-is-small-quick-and-shared](context_decision.md#motion-is-small-quick-and-shared) | the page rises in; a first load is `ListSkeleton` — it was a spinner |
| the product | `ProductListItem` — its picture, the name and code the REPORT carries (what was found), the code copying on a click as on the batch screens ([sku-is-copyable](batches_decision.md#sku-is-copyable)). The picture is the catalogue's, read for the page's products in one `ProductByIds`; a product it cannot name keeps the placeholder. It was the name over *code · team* in plain text |
| [a-team-of-a-known-type-shows-no-badge](context_decision.md#a-team-of-a-known-type-shows-no-badge) | whose goods — always a selling team — is `TeamItem size="xs"`, the small avatar and the name, on its own line under the product. It was the name after the code, in one line |
| [a-table-row-lights-up](context_decision.md#a-table-row-lights-up) | a posting line lights up under the pointer, every cell — `bg.muted`, as every table; it was the row in `bg.subtle` |
| [a-table-date-is-short-and-every-time-is-wib](context_decision.md#a-table-date-is-short-and-every-time-is-wib) | the loss a claim line answers is dated `27 Sep` — the year only when it is not this year; it was the full date |
| [nothing-runs-past-a-phones-edge](context_decision.md#nothing-runs-past-a-phones-edge) · [every-page-has-a-mobile-story](context_decision.md#every-page-has-a-mobile-story) | the Mobile story says so; a phone reads each posting line as a block, as it did |
| already kept | the status tabs in the URL (the contract's only filter, so no filter strip), `RefreshOverlay`, `EmptyHint` per tab, `GrowingPager`, icons on Setujui / Tolak / Tarik, the reject reason's example and its 500 count |
| pinned by | FoundStock `Default` (the picture, the copyable code, *Toko Melati* with no *Selling*) · `Mobile` (no overflow) · e2e `found_requests.spec.ts` |

What it replaces: the spinner, the product and its owner as two lines of plain text, the row hover in `bg.subtle`, and the
full date on a claim line.

## the-found-tab-row-never-scrolls

> Owner, in chat (2026-11-10): *"tabnya ada scroll"* — *"hilangkan"*.

```
before                                            now
Menunggu │ Disetujui │ Ditolak │ Semua  ▐▲        Menunggu │ Disetujui │ Ditolak │ Semua
━━━━━━━━                           ▐▼             ━━━━━━━━
```

| | |
| --- | --- |
| why it scrolled | the row had `overflowX="auto"` alone — CSS turns the other axis to `auto` too, and the selected tab's underline sits 1px below the row, so a vertical scrollbar was drawn beside four tabs that fit |
| now | `flexWrap="nowrap" overflowX="auto" overflowY="hidden"` — the restock lists', the order lists' and the product page's tab rows — and `scrollbarWidth: none`, so a phone too narrow for the four slides them with no bar drawn ([nothing-runs-past-a-phones-edge](context_decision.md#nothing-runs-past-a-phones-edge) still holds) |
| ⚠ the same bug | four other tab rows carry `overflowX="auto"` alone — the warehouse's and the seller's transfer lists, the stock counts, a count's page. Not touched: not asked |
| pinned by | FoundStock `Default` (the row's `overflowY` is hidden; nothing past its width) |

What it replaces: the tab row's `overflowX="auto"` alone.

## the-found-list-is-a-table

> Owner, in chat (2026-11-10): *"desainnya kok gemuk begini, adalah alasannya?"* — there was one, that the approver sees
> what approving posts, but nothing decided it had to be open on every card — then, asked whether the list carries it
> all (it does), *"listnya buat seperti yang lain, atau tabel saja"*.

```
No.         Produk                       Pemilik           Ditemukan  Dilaporkan      Nilai               Aksi
#301        [img] Beras Pandan 5kg       [TM] Toko Melati  4 unit     Budi Santoso    Klaim Rp 189.000    [✓ Setujui] [✕ Tolak]
[Menunggu]        SKU-BERAS-5K ⧉                           B-02-1     11 Nov 09:25    Baru Rp 65.000
#303        [□] Gula Pasir 1kg           [TK] Toko Kenanga 2 unit     Dewi Lestari    Baru Rp 26.000      [✓ Setujui] [✕ Tolak]
[Menunggu]        SKU-GULA-1K ⧉                            A-01-2     10 Nov 11:25                        Opname #15 sedang menghitung…
                                   ↓ a click on the row
┌ Rincian Temuan #301 [Menunggu] ──────────────────────────────────────────────┐
│ the product, whose · 4 unit di B-02-1 · Dilaporkan oleh … · "the note"       │
│ Jika disetujui        Diklaim kembali Rp 189.000 · Stok baru Rp 65.000       │
│ Diposting │ Batch │ Unit │ Harga │ Jumlah   (a block each on a phone)         │
│                                                          [✕ Tolak] [✓ Setujui]│
└──────────────────────────────────────────────────────────────────────────────┘
```

| | |
| --- | --- |
| why | each request was a card that opened ALL of it — about twelve lines, the posting table always shown. The rule behind that table ([an-adjust-found-waits-for-the-owner-or-admin](../../business/inventory/opname_decision.md)) asks that the approver CAN see what posts, not that every card shows it; and the confirm already names the money |
| a row | **No.** — `#301`, its status under it, so the badges line up ([one-context-per-column-and-never-three-lines](context_decision.md#one-context-per-column-and-never-three-lines)) · **Produk** — `ProductListItem` · **Pemilik** — `TeamItem xs` · **Ditemukan** — the units, the rack under them · **Dilaporkan** — who, when under it · **Diputuskan** (every tab but Menunggu) — who, when; a count's close is a link to the count · **Nilai** — claimed back and new stock, or a rejection's reason · **Aksi** — Setujui, Tolak (Tarik on one's own) and, under them, why Setujui is off |
| the Rincian | a click on the row ([a-breakdown-opens-from-rincian](context_decision.md#a-breakdown-opens-from-rincian): a dialog on a desktop, a sheet from the bottom on a phone) — the reporter's note, the decided line, what it posts line by line, a count's close, why Setujui is off; Setujui and Tolak at its foot, which shut it and ask to confirm. It reads the request off the current page, so a decision shows at once and one that left the tab shuts it. **No second read**: the list carries every request whole |
| a click | on a button, the code to copy or the count's link reaches no row |
| a phone | a block per request ([a-phone-reads-each-line-as-a-block](context_decision.md#a-phone-reads-each-line-as-a-block)) — the reference and status, the product, whose · units · rack, who reported it, what it posts, the buttons — lighting up, since it opens the Rincian |
| a monitor | no Aksi column, no buttons in the Rincian — the Rincian only reads, so it stays ([monitoring-keeps-what-only-reads](context_decision.md#monitoring-keeps-what-only-reads)) |
| the parts | `pages/found-requests/components/` — `FoundRequestTable`, `FoundRequestDetail`, `FoundRequestStatusBadge`, `found.ts` (status and post colours, *withdrawn*, the block and decided words); `FoundRequestCard` is gone |
| pinned by | FoundStock `Default` (a row under 110px, the note not on it, no Diputuskan while waiting), `Mobile` (blocks, the sheet's lines as blocks), `Rincian` (note, lines, Setujui from its foot), `TheHistory` (Diputuskan, a count's link, the Rincian of each) and the rest · e2e `found_requests.spec.ts` |

What it replaces: one card per request with every part of it open — the
[the-found-list-follows-the-screen-rules](#the-found-list-follows-the-screen-rules) card.
