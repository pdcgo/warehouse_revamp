# State — `packages/receipt_readers`

Written for the next agent. Sources:
[technical/packages/receipt_readers/context.md](../../technical/packages/receipt_readers/context.md) (owner),
its [clarify](../../technical/packages/receipt_readers/context_clarify.md) and
[decisions](../../technical/packages/receipt_readers/context_decision.md).

## What exists

| | |
| --- | --- |
| [receipt.go](../../../backend/packages/san_receipt_readers/receipt.go) | ✅ the owner's CURRENT contract: `ReceiptData{Receipt, OrderID, Phone, CustomerName, Address}`, `Extract(io.Reader)`, `type CourierType` (declared, returned by nothing; courier constants unexported) |
| [lines.go](../../../backend/packages/san_receipt_readers/lines.go) | ✅ glyphs → rows of positioned words (`row.words`, `row.glyphs`, `row.sized`, `row.leftOf`); a word break is a space glyph or a gap over 0.2 em; text under 1 pt (rotated) dropped; a glyph drawn again within 0.1 em of itself (fake bold) dropped |
| [widths.go](../../../backend/packages/san_receipt_readers/widths.go) | ✅ Type0 glyph widths from the font's `W` array, which the library ignores, and stacked runs re-placed; keyed by the name WITHOUT the subset tag, subsets of one typeface merged |
| [content.go](../../../backend/packages/san_receipt_readers/content.go) | ✅ the text interpreter: the library's `Content()` rules copied, plus `Do` followed into Form XObjects (bounded: depth 8, 256 form drawings per page). `pageTexts` replaces `page.Content().Text`; identical on every earlier sample. `eachResources` walks forms for fonts and images |
| [images.go](../../../backend/packages/san_receipt_readers/images.go) | ✅ logo fingerprints over pixels **and** alpha mask, each decode guarded; `courierLogos`, the one table of known logos |
| [recipient.go](../../../backend/packages/san_receipt_readers/recipient.go) | ✅ the recipient per template: Shopee (two columns, cut at two x), TikTok J&T Cargo, TikTok J&T (old). Masked values → `""`. KiriminAja's is in kiriminaja.go |
| [jnt.go](../../../backend/packages/san_receipt_readers/jnt.go) · [jnt_cargo.go](../../../backend/packages/san_receipt_readers/jnt_cargo.go) · [tiktok.go](../../../backend/packages/san_receipt_readers/tiktok.go) | ✅ TikTok layouts: J&T Express (`www.jet.co.id`), J&T Cargo (`TT Order ID` + 12 digits alone + its logo) |
| [tiktok_instant.go](../../../backend/packages/san_receipt_readers/tiktok_instant.go) | ✅ TikTok Shop instant / same-day: `Nomor Order:` + 18 digits, the six-character pickup code under `Kode Pengambilan` is `Receipt` (carried over from the-pickup-code-is-the-receipt, unconfirmed for TikTok), recipient from caption rows (name in full, phone masked) |
| [tiktok_anteraja.go](../../../backend/packages/san_receipt_readers/tiktok_anteraja.go) | ✅ TikTok / Tokopedia AnterAja: `Order ID：` (the TikTok order-id rule now allows no `TT`) + `TSA-` and eleven digits alone |
| [spx.go](../../../backend/packages/san_receipt_readers/spx.go) · [sicepat.go](../../../backend/packages/san_receipt_readers/sicepat.go) · [shopee_instant.go](../../../backend/packages/san_receipt_readers/shopee_instant.go) · [shopee.go](../../../backend/packages/san_receipt_readers/shopee.go) | ✅ Shopee layouts: SPX STD/ECO (`SPXID` printed most often), SiCepat HALU/REG/BEST (12 digits; `HALU` header or one of five SiCepat logos; the `Resi:` box when printed once), instant/same-day (one of four known headers: `INSTANT / SAMEDAY`, `Same-day`, `SAMEDAY`, `Instant`; no tracking number printed, so `Receipt` is the pickup code) |
| [kiriminaja.go](../../../backend/packages/san_receipt_readers/kiriminaja.go) | ✅ KiriminAja (an aggregator), any courier it books: the tracking number is the code under the `AWB` caption, the recipient the column left of `Dari`, phone included. `OrderID` `""` (Q11) |
| [lazada.go](../../../backend/packages/san_receipt_readers/lazada.go) | ✅ Lazada: `Diserahkan ke` + `Diantar oleh` + a tracking number alone on its line, four capitals-dash-ten digits (`LXAD-…`, `JNAP-…`) or J&T's shape (`JZ…`). `Receipt` is the tracking number, `OrderID` the only 16-digit line, the order number (a-lazada-receipt-is-its-tracking-number). Recipient is the RIGHT column; the address ends at a gap. No phone |
| [jnt_picture.go](../../../backend/packages/san_receipt_readers/jnt_picture.go) · [barcodes.go](../../../backend/packages/san_receipt_readers/barcodes.go) | ✅ a J&T label printed as ONE PICTURE (no text): a page with no text gets every image (≤ 16, each ≤ 4 Mpx, each guarded on its own) decoded for a QR code and a Code 128 (`gozxing`); a J&T-shaped code that they agree on is `Receipt`. Everything else `""` (Q13). Pages with text are never scanned. ⚠ A JPEG (`DCTDecode`) is found in the file's own bytes by its declared `Length` and its header's size, because the library has no JPEG filter and no raw-stream access |
| [spx_picture.go](../../../backend/packages/san_receipt_readers/spx_picture.go) | ✅ a Shopee SPX label printed as PICTURES (Microsoft Print To PDF: words as outlines, one JPEG per graphic): `Receipt` is the agreed `SPXID…` code, `OrderID` the agreed code of a Shopee order number's shape (read only beside SPX: a SiCepat number has that shape too). The recipient `""` |
| [shopee_cm.go](../../../backend/packages/san_receipt_readers/shopee_cm.go) | ✅ Shopee, a `CM` + 11-digit number (probably JNE; the label names no courier): most printed, or its `Resi:` box, by the exact shape |
| [shopee_anteraja.go](../../../backend/packages/san_receipt_readers/shopee_anteraja.go) | ✅ Shopee, AnterAja: fourteen digits by exact shape. `readShopeeTracking` (shopee.go) is the shared most-printed-or-`Resi:`-box rule for SiCepat, CM and AnterAja |
| [shopee_jtr.go](../../../backend/packages/san_receipt_readers/shopee_jtr.go) | ✅ Shopee, JNE Trucking (`JTR`): `JT` and eleven digits by exact shape. ⚠ `JT…` is JNE's here, not J&T's |
| [shopee_idexpress.go](../../../backend/packages/san_receipt_readers/shopee_idexpress.go) | ✅ Shopee, ID Express: `ID`, one capital and thirteen digits (`IDS…`; KiriminAja's is `IDE…`), most printed or its `Resi:` box |
| [shopee_pos.go](../../../backend/packages/san_receipt_readers/shopee_pos.go) | ✅ Shopee, Pos Indonesia: `SHPE` and eighteen capitals and digits |
| [shopee_barcode.go](../../../backend/packages/san_receipt_readers/shopee_barcode.go) | ✅ the LAST layout: a Shopee label no courier layout reads, from its `Resi:` box when a barcode on the page decodes to exactly the same value (decided, Q7). `pageView.barcodes()` decodes lazily, so labels other layouts read never pay for it. Run alone, it reads all 18 Shopee samples with a Resi box the same as the courier layouts |
| [shopee_jnt_cargo.go](../../../backend/packages/san_receipt_readers/shopee_jnt_cargo.go) | ✅ Shopee, J&T Cargo (`CARGO`): twelve digits (SiCepat's shape) gated by J&T Cargo's logo |
| tests | ✅ 90 on SYNTHETIC PDFs (`pdfwriter_test.go` makes Helvetica and Type0 fonts, subset fonts, images with alpha masks, Form XObjects; the picture tests draw QR codes and Code 128s with gozxing's writers, stored raw or as JPEG), plus `TestSamples` |
| [samples_test.go](../../../backend/packages/san_receipt_readers/samples_test.go) | ✅ walks `examples/receipt_file_samples/` (or `$RECEIPT_SAMPLES`), logs all five fields, fails only when `Extract` errors. All 38 labels read, each with a receipt; the 3 files that are not labels (`notReceipts`, one spam file attached to three orders) must stay refused as `ErrNotShippingLabel` |
| owner's `tools/receipt_iterate/` | theirs, **"ai should not touch this"**. It runs `Extract` over live orders' receipt files and saves the first one that fails into `examples/receipt_file_samples/`. Forty of the forty-one files arrived that way. It now also compares `Receipt` with the order's and saves the file on a mismatch, and files an `ErrNotShippingLabel` into `pdc_samples/`. ⚠ **Uncommitted**, and after the move it still imports the OLD path (`…/backend/pkgs/san_receipt_readers`), so it doesn't compile until the owner changes that one line to `github.com/pdcgo/san_receipt_readers`. With that line overlaid (`go build -overlay`), the root builds |
| home | ⚠ **a git submodule**: the public repo `github.com/pdcgo/san_receipt_readers`, checked out at `backend/packages/san_receipt_readers`, its **own Go module** (`go.mod`, `go.sum`, a `*.pdf` `.gitignore`). The root `go.mod` requires it and `replace`s it with that folder. Root `go test ./...` never enters it: run `go test ./...` **inside** it (CI does, in its own step). A change is a commit there, pushed, then a commit here moving the pointer ([the-reader-is-a-submodule-with-its-own-module](../../technical/packages/receipt_readers/context_decision.md#the-reader-is-a-submodule-with-its-own-module)) |
| dependency | `github.com/ledongthuc/pdf v0.0.0-20260907135840-6c8c28e0e8a0`, pure Go, BSD; `github.com/makiuchi-d/gozxing v0.1.1`, pure Go, MIT, for the barcodes (adds `golang.org/x/xerrors`). Direct in the submodule's `go.mod`, indirect in the root's |

**Not built:** any caller. No RPC, no frontend wiring. The order form still runs its stand-in
`scanReceipt` ([checks.ts:182](../../../frontend/src/features/orders/form/checks.ts#L182)). The caller is
`ReceiptCheck` in `shipment_service` ([receipt-check-is-shipments](../../business/shipment/context_decision.md#receipt-check-is-shipments),
which answered Q3). Its shape is decided too (2026-10-05): the file's bytes in, `Extract`'s `ReceiptData` out, signed-in
callers only ([receipt-check-takes-the-file-bytes](../../business/shipment/context_decision.md#receipt-check-takes-the-file-bytes) ·
[receipt-check-returns-what-the-library-reads](../../business/shipment/context_decision.md#receipt-check-returns-what-the-library-reads) ·
[receipt-check-needs-a-login](../../business/shipment/context_decision.md#receipt-check-needs-a-login)). Q2 moved there and is answered.

## What was decided

[a-logo-still-names-the-courier](../../technical/packages/receipt_readers/context_decision.md#a-logo-still-names-the-courier) ·
[courier-is-not-read](../../technical/packages/receipt_readers/context_decision.md#courier-is-not-read) ·
[the-reader-reads-the-recipient](../../technical/packages/receipt_readers/context_decision.md#the-reader-reads-the-recipient) ·
[the-pickup-code-is-the-receipt](../../technical/packages/receipt_readers/context_decision.md#the-pickup-code-is-the-receipt): your data answered Q6, an instant order stores its `Kode Pengambilan` as the receipt ·
[a-file-that-is-not-a-courier-label-is-refused](../../technical/packages/receipt_readers/context_decision.md#a-file-that-is-not-a-courier-label-is-refused):
the owner called a Canva-made label spam; it is refused, and the layout that read it was removed. ·
[a-non-label-gets-its-own-error](../../technical/packages/receipt_readers/context_decision.md#a-non-label-gets-its-own-error) ·
[unreadable-and-not-a-label-are-two-errors](../../technical/packages/receipt_readers/context_decision.md#unreadable-and-not-a-label-are-two-errors):
**two exported errors that never overlap**, `ErrUnreadable` (could not read the file) and `ErrNotShippingLabel` (read it,
no image and no layout: spam). The other errors stay unexported (critique 4). ·
[a-picture-with-no-code-is-not-a-label](../../technical/packages/receipt_readers/context_decision.md#a-picture-with-no-code-is-not-a-label):
no text and no readable barcode or QR (a screenshot of a document) is a non-label too. ·
[a-note-with-no-tracking-number-is-not-a-label](../../technical/packages/receipt_readers/context_decision.md#a-note-with-no-tracking-number-is-not-a-label):
no barcode and no word shaped like a tracking number (a note over a background picture) is a non-label too; all three
rules live in `not_a_label.go`. ·
[a-lazada-receipt-is-its-tracking-number](../../technical/packages/receipt_readers/context_decision.md#a-lazada-receipt-is-its-tracking-number):
a Lazada label's `Receipt` is the courier's tracking number and its `OrderID` the 16-digit order number (an earlier
decision the other way round was withdrawn). ·
[a-shopee-resi-is-confirmed-by-its-barcode](../../technical/packages/receipt_readers/context_decision.md#a-shopee-resi-is-confirmed-by-its-barcode):
a Shopee label no courier layout knows is read from its Resi box when its barcode agrees (Q7 answered). `TestNotShippingLabels` walks the
owner's `pdc_samples/` folder: every file there must be `ErrNotShippingLabel`.
[the-reader-is-a-submodule-with-its-own-module](../../technical/packages/receipt_readers/context_decision.md#the-reader-is-a-submodule-with-its-own-module):
the owner's §General, its own public repo and module at `backend/packages/` (Q18). ·
The first two decisions (three-fields-only, the-reader-finds-the-courier) are **superseded**.

## Built as a default, NOT decided

| behaviour | built as | clarify |
| --- | --- | --- |
| `OrderID` name | kept as written; `OrderRefID` recommended | critique 2 |
| the other errors (unknown layout, more than one label) | unexported: "an error that is neither `ErrUnreadable` nor `ErrNotShippingLabel`" | critique 4 |
| a bulk print | error, never page 1 | critique 5 |
| an unprinted or masked field | `""`, no error | critique 6, Q9 |
| input size | capped at 2 MB | critique 7 |
| a library panic | recovered into `ErrUnreadable`, proven by a mutation check | critique 8 |
| the address | printed lines joined by a space; wrapped words stay split | Q10 |
| a KiriminAja label's `OrderID` | `""`; its `OID-…` is KiriminAja's booking number | Q11 |
| a label printed as a picture | `Receipt` from its barcodes only | Q13 |
| a Shopee SPX label printed as pictures | `Receipt` **and** `OrderID` from its barcodes, the recipient `""` | Q13 |
| a Shopee reservation label's `OrderID` | the `No.Reservasi:` number, read whole from the `Pesan:` line | Q14 |

## What the samples proved

- ⚠ **Microsoft Print To PDF draws every word as outlines** (no fonts, so no text) and stores each graphic as its own
  JPEG (`shopee_std_01.pdf`). The barcodes were smaller than the logo, so scanning the largest image found nothing.
- ⚠ **Only KiriminAja prints the recipient's phone.** Shopee prints only the sender's, and TikTok masks it. `Phone`
  is filled on one label in thirty-eight (Q8): KiriminAja.
- ⚠ **A Shopee label's two columns are cut at two x.** The `Pengirim:` caption sits left of the sender's text,
  and the recipient's address runs past it. Cutting at the caption lost `/ RW` and `dusun` on real labels.
  The address is cut at the sender's phone, and `TestShopeeRecipientIsTheLeftColumn` reproduces the loss.
- **Other text overlays the address in other sizes**: the `COD` watermark (`JAWCA TIMUROD`) and a hidden
  element (`1S0uk0am2aJju`). `row.sized` rebuilds a row from one size.
- **An address box wraps inside words, with no trailing space to tell it from a wrap between words.**
  Joined by a space: `Gro gol Sel` stays split rather than anything being glued.
- ⚠ **The library reads no widths from Type0 fonts**, so kerning split words (`INST ANT`): a silent id
  truncation. `widths.go` fixes it.
- ⚠ **A logo is not a reliable courier name.** The same logo comes in several sizes, and the J&T Cargo logo's
  shape is entirely in its alpha mask. Logos only gate layouts now.
- ⚠ **The library panics** on malformed operators and on image filters it can't decode. The recovers in
  `Extract` and `fingerprint` are required.
- ⚠ **Bold can be drawn twice**, 0.034 em apart (KiriminAja): every bold letter came out doubled. A glyph drawn
  again within 0.1 em of itself is dropped; `TestLinesReadARunDrawnTwiceOnce` pins it and a real double letter.
- ⚠ **The library never reads inside a Form XObject.** The Lazada label is one, and read as an empty page.
  `content.go` follows forms; `TestPageTextsMatchesTheLibraryWithoutForms` pins that nothing else changed.
- ⚠ **Subset fonts' widths were never found** (`AAAEKH+ArialMT` vs the glyph's `ArialMT`). Fixed, and subsets of
  one typeface merged: KiriminAja draws from two, and taking the first alone merged two words.
- **The library can't decode some images** (a Flate predictor): `fingerprint` recovers and skips them, so no logo
  is read on the Lazada label.
- ⚠ **A PDF can be a picture of a label, with no text at all** (`jnt_eco_01.pdf`, rewrapped by `pdfcpu`). Its QR code
  and Code 128 carry the tracking number, nothing else is machine-readable. A JPEG picture would still fail (the
  library has no JPEG filter).
- A second real J&T prefix, `JX`, joins `JY`: the form's `JP`-only rule is wrong twice over (the contradiction).
- **A Shopee label's barcode confirms its `No. Resi:` box** (`shopee_reguler_01.pdf`): both decode to the same number.
  That makes a lenient Shopee reader safe (Q7's third option): read the box only when the barcode agrees.
- **A long recipient name can run into the `Pengirim:` caption with no gap** (`shopee_jtr_01.pdf`): the part of that
  word before the caption ends the name (`fused` in `readShopeeRecipient`).
- ⚠ **An address tag (`HOME`) can share the address's size**, indented into its box (`shopee_eco_01.pdf`): it was read
  as the whole address. A tag-only row is skipped before the address starts (`addressTags` in recipient.go).
- `shopee_spx_01.pdf` reads cleanly (one number, printed eight times); if it was saved for a mismatch, the stored
  receipt differs from the label.
- **Three Shopee labels in a row** (Reguler, ECO, NEXT DAY) printed their number once, in the `Resi:` box, and each
  needed a round under strict; the barcode agreed with the box every time (Q7's third option).
- **A Shopee label can be for a RESERVATION** (`shopee_spx_02.pdf`): `No.Reservasi:` instead of `No. Pesanan:`, an SPX hub
  as the recipient. `isShopeeLabel` accepts both captions.
- ⚠ **An address block now also ends at a line set further down than its own spacing** (`maxSpacingGrowth`): the
  reservation label's region box sits at the margin in the address's size. Synthetic fixtures must space address lines
  evenly, as real labels do; one that didn't was corrected.
- **Logo sizes keep arriving**: J&T Cargo at 683×157 and 680×156 (`tiktok_tokped_jnt_01.pdf`). TikTok draws its barcodes as
  shapes, not images, so the barcode check of Q7 can't replace this gate. The first **two-page** label: page 2 is the
  product list continued, matches no layout, and is not a second label.
- **Spam is cheap to recognise without a model** (Q16): every real label carries an image and a tracking number or
  barcode, and the two Canva files carry neither. There is no pure-Go PDF renderer, so image recognition would need cgo.
- ⚠ **A Shopee order number can be cut short with an ellipsis** (`shopee_cargo_01.pdf`): the stump passed the old
  rule and would have been returned with no error. A value ending in `…` is refused; `readShopeeWholeNumber` takes the
  whole one from the `Pesan:` line when it starts with the stump (shared with the reservation number).
- ⚠ **Five labels read cleanly yet were saved by the tool for a receipt mismatch** (`shopee_spx_01`, `shopee_std_02`,
  `shopee_halu_02`, `shopee_instant_01`, `lazada_lex_02`): one value, printed many times. The stored receipts differ;
  Q17 asks for the owner's `source` values. `shopee_instant_01` tests the pickup-code decision.
- ⚠ **Never copy a sample's values into code, tests or docs.** Real names, a street address, phones, tracking
  numbers and order ids had leaked into fixtures, comments and the clarify; all were replaced with invented ones of
  the same shape on 2026-10-02, before anything was committed. The samples folder is still not gitignored (Q5).
- `jnttest.pdf` is almost certainly a **TikTok** label: the same generator as the TikTok J&T Cargo one (Q1).

## Next

Answers to the clarify's Q1, Q4, Q5, Q8–Q11, Q13, Q14 and Q17 (Q3, Q6, Q7, Q12, Q15 and Q16 are answered, Q2 moved to shipment Q4 and answered there; Q17 the stored receipts of five clean reads; the newest: Q12 Lazada's uncaptioned order id, Q13 OCR for picture labels, Q14 a reservation's number), and
[shipment Q1](../../business/shipment/context_clarify.md#question). The owner keeps iterating live receipts,
and each failure arrives as a new sample.
