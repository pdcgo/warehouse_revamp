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
| a row is | **one movement** on the seller wallet | **one settled order**, split across 61–64 fee columns |
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
are the seven fee columns that come and go between the 61/63/64-column layouts.

```
stable across exports  ─→  on the item  ─→  hashed  ─→  IS the key
drifts between exports ─→  GetDetails() ─→  not hashed
```

---

## Things that look like bugs and are not

| | |
| --- | --- |
| **A fee column is missing** | TikTok has three layouts in 13 samples. `Flat fee` and `Sales fee` are in the narrow ones and **gone** from the widest; `GMV Max ad fee` is the reverse. Use `GetDriftingColumns()` — absence is expected. |
| **Row count ≪ sheet size** | TikTok pads its used range with blank rows — 176 of 219 in one sample. They are skipped. |
| **A `Gagal` row still has money** | A failed Shopee withdrawal is **two** rows: the original (marked `Gagal`) *and* a reversal a day later (marked `Transaksi Selesai`), both `Transaksi Keluar`, opposite signs. **Both are in the balance chain, so book both.** Skipping the `Gagal` one inflates the wallet by the withdrawal amount. |
| **`Jenis Transaksi` disagrees with the sign** | It is a *category*, not a direction. Take the sign from `Jumlah` alone. The reader does. |
| **The file's own summary does not add up** | Shopee's `Total Saldo Keluar` is out by exactly twice the withdrawal whenever one fails. Never validate a parse against it. |
| **The balance chain has a hole** | One wallet's statement is split across separate downloads — cross-border/FLEXI transactions come as their own file. A file is a slice, not a statement. |
| **The same order settles twice** | TikTok reverses: `+104444` on the 6th, `−131698` on the 8th, same id, both typed `Order`. Two real movements, two keys. |

## Not implemented

`SettlementType()` exists on the TikTok item and **always returns `ErrNoSettlementTypeMapping`**.
`context.md` carries a mapping table for Shopee only, and the enum it maps onto is an empty heading
in `settlement/context.md`. Classifying `Platform reimbursement` is a business decision, not a
parsing one, so it was left rather than invented.

Also proposed but not decided, so not built: `Detect`/`Open` platform dispatch, `GetGaps` (balance
chain breaks), `GetClaimedSummary`/`GetComputedSummary`, and recovering the Shopee order ref that
hides in `Deskripsi`. See the clarify.

## Tests

```sh
go test ./backend/pkgs/san_excel_readers/
```

⚠ They run against the **real sample workbooks** in `examples/settlement_samples/`, which are **not
committed** — they carry real seller usernames and revenue, and this repository is public. Without
them the tests **skip**, the way `san_testdb` skips with no database. A green CI is therefore not
yet evidence this package works.
