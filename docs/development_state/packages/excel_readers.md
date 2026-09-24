# State — `packages/excel_readers`

Written for the next agent. Sources:
[technical/packages/excel_readers/context.md](../../technical/packages/excel_readers/context.md) (owner),
its [clarify](../../technical/packages/excel_readers/context_clarify.md) and
[decisions](../../technical/packages/excel_readers/context_decision.md).

## What exists

| | |
| --- | --- |
| [backend/pkgs/san_excel_readers/shopee.go](../../../backend/pkgs/san_excel_readers/shopee.go) | ✅ built — `NewShopeeSettlementDocument(io.Reader)`, `GetShopUsername`, `GetPeriod`, `GetItems`, `ShopeeSettlementItem.GenerateUniqueID` |
| [backend/pkgs/san_excel_readers/shopee_test.go](../../../backend/pkgs/san_excel_readers/shopee_test.go) | ✅ 7 tests, green over all 12 sample workbooks |
| [backend/pkgs/san_excel_readers/tiktok.go](../../../backend/pkgs/san_excel_readers/tiktok.go) | ✅ built — `NewTiktokSettlementDocument`, `GetItems`, `GetWithdrawals`, `GetDetails`, `GetDriftingColumns`, `GetPeriod`/`GetTimezone`/`GetCurrency` |
| [backend/pkgs/san_excel_readers/tiktok_test.go](../../../backend/pkgs/san_excel_readers/tiktok_test.go) | ✅ 9 tests, green over all 13 sample workbooks |
| [backend/pkgs/san_excel_readers/settlement_type.go](../../../backend/pkgs/san_excel_readers/settlement_type.go) | ⚠ type only — the enum has no values yet |
| dependency | `github.com/xuri/excelize/v2 v2.11.0`, added to the root `go.mod` |

`go build ./... && go vet ./... && go test ./...` is green from the repo root.

## What was decided (and must not be re-litigated)

Three, all in [context_decision.md](../../technical/packages/excel_readers/context_decision.md):
[hash-the-whole-struct](../../technical/packages/excel_readers/context_decision.md#hash-the-whole-struct),
[jakarta-is-the-clock](../../technical/packages/excel_readers/context_decision.md#jakarta-is-the-clock),
[dash-is-not-a-reference](../../technical/packages/excel_readers/context_decision.md#dash-is-not-a-reference).

⚠ **The one that constrains everything downstream:** `GenerateUniqueID` hashes
`json.Marshal(ShopeeSettlementItem)`, so the item is **capped at its six fields forever**. Adding a
seventh silently invalidates every `unique_id` ever stored. `TestShopeeUniqueIDEncodingIsPinned`
turns that into a loud test failure. Anything diagnostic goes on the **document**, which is not
hashed.

⚠ **Money is `float64`, not `int64`** — [rupiah-is-floating-point](../../business/order/context_decision.md#rupiah-is-floating-point),
decided system-wide in the *order* tree. I re-derived `int64` here from first principles and was
wrong; it is recorded as a Contradiction in the clarify. A doc in `technical/` has nothing local to
check against, so expect this to recur.

## What the samples proved, that reading the spec would not have

All 25 workbooks were parsed cell by cell. The five findings that shaped the code:

1. **TikTok's column set is not fixed** — 61 / 63 / 64 columns across 13 files. `Flat fee` and
   `Sales fee` *disappear*; `GMV Max ad fee` appears. A fixed-struct TikTok reader is broken on
   arrival — it must map by header text.
2. **The same report re-saved changes its storage type** — text `"8400769.00"` becomes numeric
   `-18923082`. Parsing to a number is what keeps the key stable; hashing the raw cell text scores
   **0/141** on the re-save test.
3. **`Jenis Transaksi` is a category, not a sign.** A failed withdrawal is *two* rows — the original
   marked `Gagal`, the reversal a day later marked `Transaksi Selesai`, both `Transaksi Keluar`,
   opposite signs, **both in the `Saldo Akhir` chain**. Skipping `Gagal` inflates the wallet.
4. **The summary block is wrong when a withdrawal fails** — `Total Saldo Keluar` is out by exactly
   twice the withdrawal in both wdgagal files. Never validate a parse against it.
5. **One wallet's statement is split across downloads.** `shopee_malaysia_base.xlsx` has one break in
   `Saldo Akhir`; the missing row is in `shopee_malaysia.xlsx`. A file is a slice, not a statement.

## What is NOT built, and why

- **`SettlementType()`** — the method exists on the TikTok item and always returns
  `ErrNoSettlementTypeMapping`. `context.md` has a mapping table for Shopee and none for TikTok, and
  the enum it maps onto is an empty heading in `settlement/context.md`. Guessing that
  `Platform reimbursement` is a `marketplace_adjustment` is a business decision, so it was left.
- **`GetGaps`, `GetClaimedSummary`, `GetComputedSummary`, `GetRecoveredOrderRefs`** — proposed in the
  clarify, never decided, so not written (HARD RULE 8).
- **Platform detection (`Detect`/`Open`)** — proposed, not decided. `NewShopeeSettlementDocument`
  does reject a TikTok workbook with `ErrNotShopeeReport`, which is tested.

## ⚠ The fixtures are not committed

`examples/settlement_samples/` is **untracked and not gitignored**, and the workbooks carry real
seller usernames, order IDs and daily revenue — into a **public** repo. It was left out of the commit
deliberately, pending the owner's call to scrub or ignore (critique #10 in the clarify).

**Consequence:** the tests **skip** without it, the same way `san_testdb` skips with no database. They
pass locally where the samples exist and skip in CI until that is settled — so a green CI is not
evidence this package works.

## ⚠ The TikTok item deviates from the owner's contract

`### Tiktok Contract` in `context.md` describes a struct with **Shopee's** column names —
`Tanggal Transaksi`, `No. Pesanan`, `Jumlah`, `Saldo Akhir`. None exists in a TikTok workbook, and
TikTok has **no running balance on any sheet**, so it cannot be read as written. The owner was told
this, said build it anyway, and what was built is the nearest implementable thing:

**The rule that fixed the field set** — under
[hash-the-whole-struct](../../technical/packages/excel_readers/context_decision.md#hash-the-whole-struct)
the item *is* its own key, so only columns that are **identical across two exports of the same order**
may be on it. That was measured, not assumed: 43 orders appear in more than one sample export, 77
pairs compared, and exactly **one** column ever differs — `Shopping center items`, whose SKU list comes
back reordered. It is excluded, along with the 7 drifting fee columns.

Everything unstable is reachable through `GetDetails()` (every column, by header text, keyed by unique
id), which is not hashed. `GetWithdrawals()` is also an addition — the owner's doc does not mention the
third sheet, but `Order details` is what an order was *worth* while `Withdrawal records` is where money
*moves*, so a settlement reader without it cannot see withdrawals at all.

**This is a proposal in code and is the owner's to reject** — it is recorded as #23/#24 and
*What I built for TikTok* in
[context_clarify.md](../../technical/packages/excel_readers/context_clarify.md).
