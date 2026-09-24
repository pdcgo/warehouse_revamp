# `san_excel_readers`

Parses the settlement reports that marketplace platforms export as spreadsheets, so
`settlement_service` can import them.

- **Spec:** [docs/technical/packages/excel_readers/context.md](../../../docs/technical/packages/excel_readers/context.md) (owner-written)
- **Decisions:** [context_decision.md](../../../docs/technical/packages/excel_readers/context_decision.md)
- **Open questions / findings:** [context_clarify.md](../../../docs/technical/packages/excel_readers/context_clarify.md)
- **Runnable usage:** [example_test.go](example_test.go) — compiled by `go test`, so it cannot drift

```go
import "github.com/pdcgo/warehouse_revamp/backend/pkgs/san_excel_readers"
```

---

## The two platforms are different GRAINS

This is the thing to understand before using either reader. They are not two dialects of one
format.

| | Shopee | TikTok |
| --- | --- | --- |
| a row is | **one movement** on the seller wallet | **one settled order**, split across 61–76 columns, most of them fees |
| sheets | 1 — `Transaction Report` | 4 — orders, a totals tree, withdrawals, a glossary |
| where money moves | the same rows | a **separate sheet**, `Withdrawal records` |
| running balance | ✅ `Saldo Akhir`, and it chains | ⛔ none, anywhere in the file |
| timestamp | to the second | **date only** |
| shop identity | ✅ `Username (Penjual)` | ⛔ not in the file — the caller must know |
| timezone | not stated (assumed UTC+7) | ✅ stated on the `Reports` sheet |

So a TikTok "order settled for 111,598" and a TikTok "withdrawal of 4,316,267" are on different
sheets and mean different things. Reading only `GetItems()` leaves you blind to withdrawals.

---

## Shopee

```go
file, err := os.Open("transaction_report.xlsx")
...
doc, err := san_excel_readers.NewShopeeSettlementDocument(file)
if err != nil {
    return err // errors.Is(err, ErrNotShopeeReport) if it is not one
}

username, _ := doc.GetShopUsername()     // "Username (Penjual)"
from, to, _ := doc.GetPeriod()           // "Dari" / "Ke"
items, err := doc.GetItems()             // newest first, as the file lists them
```

```go
type ShopeeSettlementItem struct {
    At          time.Time            // "Tanggal Transaksi", read at UTC+7
    Type        ShopeeSettlementType // "Tipe Transaksi", verbatim
    Description string               // "Deskripsi"
    OrderRefID  string               // "No. Pesanan" — "" where the cell is "-"
    Amount      float64              // "Jumlah", signed
    LastBalance float64              // "Saldo Akhir"
}
```

## TikTok

```go
doc, err := san_excel_readers.NewTiktokSettlementDocument(file)

items, _       := doc.GetItems()           // "Order details" — what an order was WORTH
withdrawals, _ := doc.GetWithdrawals()     // "Withdrawal records" — where money MOVES
details, _     := doc.GetDetails()         // every column, by header text, keyed by unique id
drifting, _    := doc.GetDriftingColumns() // fee columns not every export carries

from, to, _ := doc.GetPeriod()
zone, _     := doc.GetTimezone() // "UTC+7" — the file says so
currency, _ := doc.GetCurrency() // "IDR"
```

The **fee breakdown is not on the item** — it is in `GetDetails()`, keyed by the row's unique id.
That is not an accident, see below.

---

## ⚠ The idempotency key is the whole struct

`GenerateUniqueID()` is `md5(json.Marshal(item))`
([hash-the-whole-struct](../../../docs/technical/packages/excel_readers/context_decision.md#hash-the-whole-struct)).
Store it as `settlement_logs.unique_id` and re-importing an overlapping export becomes a no-op.

Two consequences that will bite whoever touches this next:

**1. Adding a field to an item invalidates every key ever stored.** Not "might" — every one. The
next import then re-inserts your entire settlement history as new rows. `go test` fails loudly if
you do (`TestShopeeUniqueIDEncodingIsPinned`, `TestTiktokUniqueIDEncodingIsPinned`); that failure is
the feature. Anything diagnostic belongs on the **document**, which is not hashed.

**2. Only columns that are stable across exports may be on an item.** This was measured, not
assumed. Of the 43 orders that appear in more than one sample export (77 pairs), exactly one column
ever differs — `Shopping center items`, whose SKU list comes back **reordered**. It is excluded. So
are the 23 fee columns that come and go between the four layouts (61, 63, 64 and 76 columns).

```
stable across exports  ─→  on the item  ─→  hashed  ─→  IS the key
drifts between exports ─→  GetDetails() ─→  not hashed
```

---

## Things that look like bugs and are not

| | |
| --- | --- |
| **A fee column is missing** | TikTok has four layouts in 14 samples. `Flat fee` and `Sales fee` are in the narrow ones and **gone** from the two widest; `GMV Max ad fee` is the reverse. Use `GetDriftingColumns()` — absence is expected. |
| **A header is spelled differently** | The 2026-09 layout renamed columns without changing them — `Type` → `Transaction type` on both sheets, `Order Source` → `Order source`, `Time period:` → `Time period`. Every column an item is read from is matched under every spelling in `tiktokRenamed`, and one the reader cannot find **fails the read, naming it**, rather than reading `""` or `0` into the key. A new spelling is one line in that table. |
| **Row count ≪ sheet size** | TikTok pads its used range with blank rows — 176 of 219 in one sample. They are skipped. |
| **A `Gagal` row still has money** | A failed Shopee withdrawal is **two** rows: the original (marked `Gagal`) *and* a reversal a day later (marked `Transaksi Selesai`), both `Transaksi Keluar`, opposite signs. **Both are in the balance chain, so book both.** Skipping the `Gagal` one inflates the wallet by the withdrawal amount. |
| **`Jenis Transaksi` disagrees with the sign** | It is a *category*, not a direction. Take the sign from `Jumlah` alone. The reader does. |
| **The file's own summary does not add up** | Shopee's `Total Saldo Keluar` is out by exactly twice the withdrawal whenever one fails. Never validate a parse against it. |
| **The balance chain has a hole** | One wallet's statement is split across separate downloads — cross-border/FLEXI transactions come as their own file. A file is a slice, not a statement. |
| **An adjustment has no order** | Only a row typed `Order` carries an ORDER id. Every other type carries a 19-digit ADJUSTMENT id and attaches through `RelatedOrderRefID` — which is **empty on 15 of 23 sampled adjustments**, because the platform charged the *shop*. Keying on `OrderRefID` files them against orders that do not exist. |
| **The same order settles twice** | TikTok reverses: `+104444` on the 6th, `−131698` on the 8th, same id, both typed `Order`. Two real movements, two keys. |

## Classifying a row — `SettlementType()`

Maps a platform transaction type onto settlement_service's `settlement_type`.

| | |
| --- | --- |
| **Shopee** | ✅ all four measured types map — `fund`, `withdrawal`, `marketplace_adjustment`, `marketplace_program` |
| **TikTok** | ⚠ **table is incomplete** — six types map, and the lookup **folds case** because TikTok respells its own vocabulary. The rest still return `ErrNoSettlementTypeMapping` — see `tiktokSettlementTypes`. ⚠ The vocabulary is OPEN: one mapped type appears in no sample at all, so expect an unmapped type on real data and handle the error rather than panicking |

Two rules, the same on both sides:

**An unmapped type is an ERROR, never `other`.** `other` is a real settlement type, so returning it
for something unrecognised makes a new platform behaviour indistinguishable from a deliberate
classification — and it would import silently for months. The error surfaces it on the first file
that carries it.

**The sign is not part of the classification** — it rides on the amount. A Shopee withdrawal that
FAILED is refunded by a second `Penarikan Dana` row with a *positive* amount, and both are
`withdrawal`: the pair nets to zero because the changes do, not because the types differ. Same for
the 34 sampled `Penghasilan dari Pesanan` rows that are negative.

⚠ The table keys on the transaction-type COLUMN only, never on `Deskripsi`. One consequence:
a sampled AMS commission deduction is typed `Penyesuaian`, so it lands in `marketplace_adjustment`,
and **no Shopee row ever produces `external_ads_fee` or `affiliate_fee`**. See the clarify.

## Not implemented

The TikTok mapping table above is the one blocking gap. Also proposed but not decided, so not built: `Detect`/`Open` platform dispatch, `GetGaps` (balance
chain breaks), `GetClaimedSummary`/`GetComputedSummary`, and recovering the Shopee order ref that
hides in `Deskripsi`. See the clarify.

## Tests

```sh
go test ./backend/pkgs/san_excel_readers/
```

⚠ They run against the **real sample workbooks** in `examples/settlement_samples/`. Those carry real
seller usernames, order IDs and revenue, and this repository is public — whether they stay committed is
still open (critique #10 in the clarify). A sample missing from a checkout **skips** its test, the way
`san_testdb` skips with no database. `TestTiktokMissingColumnFailsInsteadOfReadingZero` builds its
workbooks in memory, so the TikTok header spellings are tested either way.
