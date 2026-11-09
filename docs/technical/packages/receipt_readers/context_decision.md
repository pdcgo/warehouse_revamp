# Decisions — `receipt_readers/context.md`

What the owner decided about [context.md](./context.md), recorded before it is acted on. Append-only.
The open set is [context_clarify.md](./context_clarify.md).

| | |
| --- | --- |
| ~~[three-fields-only](#three-fields-only)~~ | ⛔ superseded by [the-reader-reads-the-recipient](#the-reader-reads-the-recipient) and [courier-is-not-read](#courier-is-not-read) |
| ~~[the-reader-finds-the-courier](#the-reader-finds-the-courier)~~ | ⛔ superseded by [courier-is-not-read](#courier-is-not-read). What stands: the caller hands over a file and nothing else |
| [a-logo-still-names-the-courier](#a-logo-still-names-the-courier) | Logos stay as courier evidence. The owner declined dropping them |
| [courier-is-not-read](#courier-is-not-read) | `Courier` is gone from `ReceiptData`: too hard to extract |
| [the-reader-reads-the-recipient](#the-reader-reads-the-recipient) | `ReceiptData` adds the recipient: `Phone`, `CustomerName`, `Address` |
| [the-pickup-code-is-the-receipt](#the-pickup-code-is-the-receipt) | An instant / same-day Shopee label's `Receipt` is its pickup code (`Kode Pengambilan`) |
| [a-file-that-is-not-a-courier-label-is-refused](#a-file-that-is-not-a-courier-label-is-refused) | A label the seller made (no courier, no tracking number) is refused, its recipient not read |
| [a-non-label-gets-its-own-error](#a-non-label-gets-its-own-error) | `ErrNotShippingLabel`: a file that is not a shipping label is told apart from a label not yet learned |
| [unreadable-and-not-a-label-are-two-errors](#unreadable-and-not-a-label-are-two-errors) | `ErrUnreadable` (could not read the file) and `ErrNotShippingLabel` (read it, and it is spam) never overlap |
| [a-picture-with-no-code-is-not-a-label](#a-picture-with-no-code-is-not-a-label) | A page with no text and no readable barcode or QR (a screenshot) is `ErrNotShippingLabel` too |
| [a-note-with-no-tracking-number-is-not-a-label](#a-note-with-no-tracking-number-is-not-a-label) | No barcode and no word shaped like a tracking number is `ErrNotShippingLabel` too |
| ~~[a-lazada-receipt-is-its-order-number](#a-lazada-receipt-is-its-order-number)~~ | ⛔ superseded by [a-lazada-receipt-is-its-tracking-number](#a-lazada-receipt-is-its-tracking-number): the owner withdrew the value it rested on |
| [a-shopee-resi-is-confirmed-by-its-barcode](#a-shopee-resi-is-confirmed-by-its-barcode) | A Shopee label no courier layout knows is read from its Resi box when a barcode says the same |
| [a-lazada-receipt-is-its-tracking-number](#a-lazada-receipt-is-its-tracking-number) | A Lazada label's `Receipt` is the courier's tracking number, its `OrderID` the 16-digit order number |
| [the-reader-is-a-submodule-with-its-own-module](#the-reader-is-a-submodule-with-its-own-module) | The package is the public repo `pdcgo/san_receipt_readers`, a submodule at `backend/packages/`, with its own `go.mod`. 🔄 *Folder moved to `backend/pkgs/` by [the-reader-lives-in-backend-pkgs](#the-reader-lives-in-backend-pkgs)* |
| [the-label-samples-may-be-committed](#the-label-samples-may-be-committed) | The label PDFs in `examples/receipt_file_samples/` are not sensitive: they stay committed, the repo stays public |
| [a-receipt-mismatch-is-only-a-warning](#a-receipt-mismatch-is-only-a-warning) | a label that disagrees with the typed resi only warns at submit; the five mismatched samples are not investigated, for now |
| [jnttest-is-a-tiktok-jnt-express-label](#jnttest-is-a-tiktok-jnt-express-label) | `jnttest.pdf` is a TikTok J&T Express label — same generator and fonts as a TikTok label, a TikTok order id |
| [a-kiriminaja-label-leaves-the-order-id-empty](#a-kiriminaja-label-leaves-the-order-id-empty) | a KiriminAja label fills no order id — its `OID-…` is the aggregator's, never the marketplace's |
| [the-phone-is-the-recipients-never-the-senders](#the-phone-is-the-recipients-never-the-senders) | `Phone` is the recipient's, filled only when printed in full — never the sender's |
| [a-masked-value-comes-back-empty](#a-masked-value-comes-back-empty) | a name or phone printed with `*` comes back `""`, never as `a**i` |
| [the-address-is-one-string-joined-by-spaces](#the-address-is-one-string-joined-by-spaces) | `Address` is one string, the box's lines joined by a space; the region boxes wait for the order form |
| [a-picture-label-is-read-from-its-barcodes-only](#a-picture-label-is-read-from-its-barcodes-only) | a label printed as a picture gives its tracking number, and its order id when a barcode carries it — no OCR |
| [a-reservation-number-is-read-as-the-order-id](#a-reservation-number-is-read-as-the-order-id) | a Shopee reservation label's `No.Reservasi:` number is its `OrderID`, whatever the label is for — the reader reads, the caller decides |
| [a-label-is-read-from-a-pdf-only](#a-label-is-read-from-a-pdf-only) | a label is read only from a PDF — a photo is never sent to the reader |
| [the-reader-lives-in-backend-pkgs](#the-reader-lives-in-backend-pkgs) | the submodule's folder moves to `backend/pkgs/san_receipt_readers` — still its own repo and its own module |

---

## three-fields-only

> Owner (2026-10-02), in §Contracts: `ReceiptData { Courier CourierType, Receipt string, OrderID string }`.

**The verdict.** Three fields, the ones the order form fills and checks. The label prints more, and none of
it is read: the order has no column for it, and the buyer's details on it are masked anyway.

```mermaid
flowchart LR
  L["a J and T label, measured on jnttest.pdf"] --> K["READ: courier, tracking number, marketplace order id"]
  L --> N["NOT READ: service, COD, weight, ship date, sender, recipient, address, sort code, items"]
```

| field | what it is | where it lands |
| --- | --- | --- |
| `Courier` | which courier's label | `shipment_channel_id`, looked up by code |
| `Receipt` | the tracking number | `orders.receipt` |
| `OrderID` | the marketplace's order number | `orders.order_external_ref_id` |

⚠ The field NAME `OrderID` is still open: [critique 2](./context_clarify.md#critique) recommends `OrderRefID`.

---

## the-reader-finds-the-courier

> Owner (2026-10-02), in §Contracts: `func Extract(data io.Reader) (ReceiptData, error)`, with no courier
> argument.

**The verdict.** The caller doesn't say which courier the label is from. `Extract` recognises the layout and
reports the courier back, so a caller can ask about a file without knowing anything about it first.

```mermaid
flowchart LR
  F["the uploaded file"] --> E["Extract"]
  E --> M{"which layout's marker is on it?"}
  M -->|"exactly one"| R["ReceiptData with Courier set"]
  M -->|"none"| U["unknown layout, an empty scan"]
```

How a layout is recognised (one marker per layout, e.g. `www.jet.co.id`), and what "none" returns, is
proposed in [the clarify](./context_clarify.md#proposed-design) and is not decided yet.

---

## a-logo-still-names-the-courier

> Owner (2026-10-02), asked *"can we ignore logo?"* and then, to my recommendation to drop logos and read
> labels from unknown couriers with an empty courier: **"no"**.

**The verdict.** Logos stay. A known logo (`courierLogos`, matched byte for byte on pixels **and** alpha
mask) still confirms a courier where the label's text names none, and each new logo size is added when its
sample arrives. Read narrowly: the owner declined the bundle, so whether a label from an unknown courier
fails or is read without one stays open ([Q8](./context_clarify.md#question)).

```mermaid
flowchart LR
  T{"does the text name the courier?"} -->|"yes, SPXID or www.jet.co.id"| C["courier from text"]
  T -->|"no"| L{"a known logo?"}
  L -->|"yes"| C2["the layout matches"]
  L -->|"no"| U["unknown layout, Q8 still open"]
```

---

## courier-is-not-read

> Owner (2026-10-02), editing §Contracts: *"to hard to extract courier type"*. `Courier` was removed from
> `ReceiptData`. `type CourierType string` stays declared.

**The verdict.** `Extract` no longer reports a courier. It reverses
[the-reader-finds-the-courier](#the-reader-finds-the-courier) and drops one field of
[three-fields-only](#three-fields-only). The evidence agreed: of nine samples, five name their courier only in
a logo, and the same logo came in several sizes.

| | before | after |
| --- | --- | --- |
| `ReceiptData.Courier` | `jnt`, `spx`, `sicepat`, `grabexpress`, `jntcargo` | gone |
| logos | named the courier | only decide whether a layout **matches** (SiCepat REG, J&T Cargo) |
| Q7 *is HALU SiCepat?* | open | moot: the answer is never returned |

```mermaid
flowchart LR
  P["a label"] --> M{"which layout?"}
  M -->|"text, number shape, a known logo"| R["Receipt, OrderID, recipient"]
  M -.->|"no longer"| X["Courier"]
```

---

## the-reader-reads-the-recipient

> Owner (2026-10-02), editing §Contracts: `ReceiptData` gains `Phone`, `CustomerName`, `Address`.

**The verdict.** The reader also returns who the parcel goes to. Measured on all nine samples:

| field | Shopee (7) | TikTok (2) | built rule |
| --- | --- | --- | --- |
| `CustomerName` | in full, after `Penerima:` | masked: `a**i`, `S** W**O` | a masked value comes back `""` |
| `Phone` | ⛔ not printed: the only phone is the **sender's** | masked: `(+62)81*******00` | `""` on every sample |
| `Address` | in full, left column | in full | printed lines joined by a space |

How it's read is in the [clarify](./context_clarify.md#what-the-recipient-block-is), along with what's still
open about it.

---

## the-pickup-code-is-the-receipt

> Owner (2026-10-02), reporting `shopee_grab_express_02.pdf`, gave its order's stored receipt: a four-character
> code that is that label's `Kode Pengambilan`. Live orders store the pickup code as the order's receipt.
> This answers what was Q6, from the data.

**The verdict.** A Shopee instant / same-day label prints no tracking number, so its `Receipt` is the rider's
**pickup code**, printed beside the order number. That replaces the built `""` (Q6 option a), and was none of
the three options offered: the order number again (b) or a later fetch from Shopee (c).

```mermaid
flowchart LR
  L["Shopee instant or same-day label"] --> N["No. Pesanan: the order number"]
  L --> K["Kode Pengambilan: four capitals and digits"]
  N --> O["OrderID"]
  K --> R["Receipt"]
  L -.->|"prints none"| T["a tracking number"]
```

| | spec |
| --- | --- |
| applies to | the instant / same-day layout (`INSTANT / SAMEDAY`, `Same-day`): SPX and GrabExpress so far |
| reads | `Kode Pengambilan:` then exactly **four** `[0-9A-Z]`, ending at a non-alphanumeric or the line end |
| fused to the next word, another length, or two different codes | `""`: no guess |
| the order form | no SPX or GrabExpress format rule exists, so a four-character receipt raises no warning, and it never equals the order number, so `refs-distinct` holds |

---

## a-file-that-is-not-a-courier-label-is-refused

> Owner (2026-10-05), on `pdc_sample_01.pdf`: *"its not real receipt, like spam receipt"*. This answers what was
> Q15.

**The verdict.** A file is a receipt only when it matches a courier's layout. An address label the seller
designed (in Canva: captions and values, with no courier, no tracking number, no order id and no image) is
**refused** with an error, and its recipient is not read. The seller-made layout built the round before is
removed.

```mermaid
flowchart LR
  F["an uploaded file"] --> M{"matches a courier's layout?"}
  M -->|"yes"| R["ReceiptData"]
  M -->|"no, even if it prints a recipient"| E["an error: refused"]
```

| | spec |
| --- | --- |
| a file matching no courier layout | `errUnknownLayout`, nothing read |
| the samples that prove it | `pdc_sample_01.pdf` and `pdc_sample_02.pdf`, listed in `TestSamples`' `notReceipts`: they must stay refused |
| still open | telling spam apart from a courier label we don't know yet, and whether image recognition helps: Q16 in the clarify |

---

## a-non-label-gets-its-own-error

> Owner (2026-10-05): *"can we have custom error for not shipping label ?"*, after asking whether tiny image
> recognition could spot the spam. This answers what was Q16.

**The verdict.** A file that is not a shipping label gets its own error, **`ErrNotShippingLabel`**, apart from
a courier label the package hasn't learned yet. It is recognised by a measured rule, not by image recognition:
every real label carries an image (a logo, a barcode or a QR), and the spam carries none.

```mermaid
flowchart LR
  F["a file no layout matches"] --> Q{"an image on any page?"}
  Q -->|"no"| S["ErrNotShippingLabel: skip it"]
  Q -->|"yes"| U["the unknown-layout error: a label to learn, save it as a sample"]
```

| | spec |
| --- | --- |
| the error | `ErrNotShippingLabel`, exported: the one error a caller can name today (the rest wait on critique 4) |
| when | no layout matched on any page, **and** no page has an image (its forms included, decodable or not) |
| compatibility | it also matches the unknown-layout error, so code that checks for that still treats it as refused |
| a caller | `errors.Is(err, san_receipt_readers.ErrNotShippingLabel)` to skip it |
| not built | image recognition: no pure-Go PDF renderer (it needs MuPDF or PDFium through cgo), a model and labelled data, and it would not catch a copied real label any better |
| known limit | a real label with no image at all would be called a non-label. None of the 23 real samples is one |
| tests | `TestAFileWithNoImageIsNotAShippingLabel`, `TestAnUnknownFileWithAnImageMayBeALabel`, and `TestSamples`' `notReceipts` |

---

## unreadable-and-not-a-label-are-two-errors

> Owner (2026-10-05): *"separate it with error cannot read with can read it but it pdc_sample"*.

**The verdict.** Two exported errors, and a file is never both. **`ErrUnreadable`**: the file could not be read
at all. **`ErrNotShippingLabel`**: it was read, and it is not a courier's label (the `pdc_sample` spam).

```mermaid
flowchart LR
  F["an uploaded file"] --> R{"could it be read?"}
  R -->|"no: not a PDF, over 2 MB, broken"| U["ErrUnreadable"]
  R -->|"yes"| M{"a known layout?"}
  M -->|"yes"| D["ReceiptData"]
  M -->|"no, and no image"| S["ErrNotShippingLabel"]
  M -->|"no, with an image"| K["the unknown-layout error: a label to learn"]
```

| `ErrUnreadable` covers | how |
| --- | --- |
| not a PDF (no `%PDF-` in the first 1024 bytes) | `errNotPDF` wraps it |
| over 2 MB | `errTooLarge` wraps it |
| a PDF the library can't parse, or a panic inside it | wrapped with the library's message |
| the caller's reader failing | wrapped with the reader's error |

The unknown-layout and more-than-one-label errors stay unexported: a caller tells them apart as "an error that
is neither of the two". `TestUnreadableAndNotAShippingLabelAreTwoErrors` checks that no case lands in both.

---

## a-picture-with-no-code-is-not-a-label

> Owner (2026-10-05): *"sample fail on 03.pdf"*, after filing three files in a new `pdc_samples/` folder as
> non-labels. Two of them (`01.pdf`, `03.pdf`, one file) are a **screenshot of a document**, a manual order's note
> saved through iLovePDF. It has an image, so the first rule
> ([a-non-label-gets-its-own-error](#a-non-label-gets-its-own-error)) let it through as an unknown label.

**The verdict.** `ErrNotShippingLabel` also covers a file that has **no text at all** and **no barcode or QR**
readable from its images. A label printed as a picture always carries one (both picture samples do), and a
screenshot of a document carries none.

```mermaid
flowchart LR
  F["a file no layout matches"] --> I{"any image?"}
  I -->|"no"| N["ErrNotShippingLabel"]
  I -->|"yes"| T{"any text?"}
  T -->|"yes"| U["the unknown-layout error: a label to learn"]
  T -->|"no"| C{"a barcode or QR read from it?"}
  C -->|"no: a screenshot"| N
  C -->|"yes"| U
```

| | spec |
| --- | --- |
| not a shipping label | no layout matched, and either no image on any page, or no text on any page and no code read from any image |
| still an unknown label | text with images (a courier template not learned yet), or a picture whose barcode or QR reads but matches no layout |
| ⚠ known limit | a real label printed as a picture whose barcode **can't** be decoded (blurred, an image format the reader can't open) is now skipped as a non-label instead of saved as a sample. Neither picture sample is one |
| tests | `TestAPictureWithNoCodeIsNotAShippingLabel`, `TestAPictureWhoseCodeIsNotATrackingNumberIsUnknown`, and `TestNotShippingLabels`, which requires every file in `pdc_samples/` to be refused as `ErrNotShippingLabel` and never as `ErrUnreadable` |

---

## a-lazada-receipt-is-its-order-number

> Owner (2026-10-05): *"lazada_lex_05.pdf receipt should be …"*, followed by the label's 16-digit order
> number, not its `LXAD-…` tracking number. It also explains `lazada_lex_02.pdf`'s mismatch (Q17).

**The verdict.** For Lazada, the receipt an order stores is Lazada's **order number**: the sixteen digits printed
alone under the second barcode (and captioned `Nomor Order :` on a two-page label). The courier's tracking number
(`LXAD-…`, `JNAP-…`, `JZ…`) is still read, but only to recognise the layout.

```mermaid
flowchart LR
  L["a Lazada label"] --> T["the courier's tracking number, LXAD- or JNAP- or JZ"]
  L --> N["the 16-digit order number"]
  T -->|"recognises the layout only"| M["the lazada layout matches"]
  N --> R["Receipt"]
  M --> R
```

| | spec |
| --- | --- |
| `Receipt` | the only 16-digit line on the label; two different ones read as nothing |
| `OrderID` | `""` for now: the same value in both fields would trip the order form's check that the receipt and the reference differ. What Lazada orders store as their reference is Q12 |
| match | unchanged: the Lazada header, and a tracking number alone on its line |

---

## a-shopee-resi-is-confirmed-by-its-barcode

> Owner (2026-10-05), answering Q7 (*"how should the reader handle a Shopee label from a known template that fails
> only on a new logo size or number shape?"*): **barcode-confirmed**.

**The verdict.** A Shopee label that no courier layout reads is read from its `No. Resi:` box, **when a barcode on the
same page decodes to exactly that value**. If the box and the barcodes disagree, or no barcode can be read, the label
stays unknown, as before. The courier layouts stay, and are tried first; the barcode is decoded only when none of
them matched.

```mermaid
flowchart LR
  S["a Shopee label"] --> L{"a courier layout reads it?"}
  L -->|"yes"| R["ReceiptData, no barcode decoded"]
  L -->|"no"| B["the Resi box value"]
  B --> C{"a barcode on the page says the same?"}
  C -->|"yes"| R2["ReceiptData, Receipt from the box"]
  C -->|"no, or none readable"| U["unknown, as before"]
```

| | spec |
| --- | --- |
| layout | `shopeeBarcodeLayout` (`shopee_barcode.go`), the LAST in the list, on Shopee labels only |
| the box | `Resi:` then eight or more capitals and digits, with a digit in it; its shape is not trusted, the barcode is |
| the barcode | any QR or Code 128 decoded from the page's images (`pageCodes`), decoded only when this layout runs |
| safe against | a box that cut its number short (`spx_03`'s wraps: it disagrees with its barcode, and is not read this way) |
| measured | run alone on every Shopee sample with a Resi box, it returns the **same receipt and order id** as the courier layouts on all eighteen, including the eleven that each needed a round |
| not covered | instant / same-day labels (no Resi box: they print a pickup code), labels printed as pictures, TikTok and Lazada (TikTok draws its barcodes as shapes) |

---

## a-lazada-receipt-is-its-tracking-number

> Owner (2026-10-05): *"im misslead before"*, giving `lazada_lex_06.pdf`'s receipt as its J&T tracking number
> (`JZ…`), not its order number. This reverses
> [a-lazada-receipt-is-its-order-number](#a-lazada-receipt-is-its-order-number), and answers what was Q12.

**The verdict.** A Lazada label's `Receipt` is the **courier's tracking number**, alone on its line in its courier's
shape (`LXAD-…`, `JNAP-…`, `JZ…`). Its `OrderID` is the **16-digit order number**, alone on its line with no caption
on page 1, and captioned `Nomor Order :` on a two-page label's page 2, which confirms what it is.

```mermaid
flowchart LR
  L["a Lazada label"] --> T["the courier's tracking number"]
  L --> N["the 16-digit order number"]
  T --> R["Receipt"]
  N --> O["OrderID"]
```

| | spec |
| --- | --- |
| `Receipt` | the only line in a Lazada courier's shape (`readLEXTracking`) |
| `OrderID` | the only 16-digit line (`readLazadaOrderID`) |
| what changed back | the reversed decision had put the order number in `Receipt` and left `OrderID` empty |
| still open | `lazada_lex_02.pdf`'s stored receipt differs from its tracking number again: Q17 |

---

## a-note-with-no-tracking-number-is-not-a-label

> Owner (2026-10-05): *"fails on pdc sample 04.pdf"*, a file filed in `pdc_samples/`, the folder of non-labels: a
> cross-team order note designed in Canva over a full-page background picture. It has text and an image, so neither
> earlier rule caught it.

**The verdict.** A file that no layout reads is also `ErrNotShippingLabel` when it has **no barcode or QR** and **no
word shaped like a tracking number**. Every real label prints its tracking number or encodes it; the note does
neither.

```mermaid
flowchart LR
  F["a file no layout reads"] --> I{"any image?"}
  I -->|"no"| N["ErrNotShippingLabel"]
  I -->|"yes"| C{"a barcode or QR read?"}
  C -->|"yes"| U["unknown: a label to learn"]
  C -->|"no"| S{"a word shaped like a tracking number?"}
  S -->|"no"| N
  S -->|"yes"| U
```

| | spec |
| --- | --- |
| a tracking-shaped word | capitals, digits and dashes, 10 to 30 long, with 10+ digits, or 6+ digits and a letter (`hasTrackingShape`) |
| not one | a date (`02102026`, `2026-09-28`), a sort code (`TTE-TTE024A-TA`) |
| errs toward "unknown" | a phone number written with dashes counts as shaped, so such a file is kept as a sample, never dropped |
| measured | every one of the 38 real labels has a shaped word or a readable code; the Canva address labels are caught by the no-image rule first |
| cost | a text page's barcodes are decoded only on the way to this error, never for a label a layout reads |
| tests | `TestANoteWithNoTrackingNumberIsNotAShippingLabel`, `TestATrackingShapeIsLongAndMostlyDigits`, `TestNotShippingLabels` |

---

## the-reader-is-a-submodule-with-its-own-module

> Owner (2026-10-05), [§General](./context.md): *"its have submodule repo `https://github.com/pdcgo/san_receipt_readers`
> live in `backend/packages/san_receipt_readers`"*. Then, on clarify Q18's recommendations: *"allow move push and
> commit all"*.

**The verdict.** The package is its own public repo, checked out here as a git submodule, and its own Go module.
This repo builds against the checkout, never a published tag.

```mermaid
flowchart LR
  W["warehouse_revamp go.mod"] -->|"require, replace with the local folder"| S["backend/packages/san_receipt_readers, own go.mod"]
  S -->|"git submodule"| G["github.com/pdcgo/san_receipt_readers, public"]
  T["tools/receipt_iterate"] -->|"imports github.com/pdcgo/san_receipt_readers"| S
  X["examples/receipt_file_samples"] -.->|"read by the tests, never pushed"| S
```

| | spec |
| --- | --- |
| module | `github.com/pdcgo/san_receipt_readers`, its own `go.mod` and `go.sum` |
| folder | `backend/packages/`, meaning "another repo, checked out here", beside `backend/pkgs/` (this repo's own packages). 🔄 *Moved 2026-11-03 by [the-reader-lives-in-backend-pkgs](#the-reader-lives-in-backend-pkgs): the folder is `backend/pkgs/san_receipt_readers`* |
| wiring | the root `go.mod` requires it and `replace`s it with `./backend/packages/san_receipt_readers`, so an edit there is seen here at once. 🔄 *Now `./backend/pkgs/san_receipt_readers`* |
| CI | both checkouts take `submodules: true` (every `go` command reads the replaced folder's `go.mod`), and a step runs `go vet` and `go test` inside each `backend/packages/*`, which the root's `./...` never enters. 🔄 *Now inside every path `.gitmodules` lists* |
| privacy | `*.pdf` is gitignored in the submodule. The real samples stay untracked in this repo's `examples/` ([Q5](./context_clarify.md#question)), and the tests build their labels in code. 🔄 *Reversed 2026-10-19 by [the-label-samples-may-be-committed](#the-label-samples-may-be-committed): the samples are committed here, and the diagram's "never pushed" is stale* |
| docs | stay here, in `docs/technical/packages/receipt_readers/`. The submodule's README links to them by URL |
| a change | is two commits: one in the submodule (pushed to its repo), then one here moving the submodule pointer |

---

## the-label-samples-may-be-committed

> Owner, in chat (2026-10-19): *"pdf example its not sensitive, its okay"* — to [Q5](./context_clarify.md#question),
> *sample privacy*, after the rollup's #1 found 47 label PDFs committed in `34849174` (2026-10-05) and pushed to `dev`,
> `backup/inventory`, `thoni` and `hfrada` of this public repo. **Against my recommendation** (make the repo private,
> untrack and gitignore the folder).

**The verdict.** The label samples in `examples/receipt_file_samples/` are not sensitive. They stay committed, the repo
stays public, and history is not rewritten. Nothing ignores the folder, so a label `tools/receipt_iterate` downloads
there may be committed too.

```mermaid
flowchart LR
  B["the receipt bucket"] -->|"tools/receipt_iterate"| X["examples/receipt_file_samples - 47 PDFs, committed"]
  X -->|"read by TestSamples"| S["san_receipt_readers"]
  X -->|"pushed"| G["pdcgo/warehouse_revamp - stays public"]
```

**The spec.**

| | |
| --- | --- |
| the samples | stay committed, on every branch as they are |
| the repo | stays public |
| history | not rewritten, nothing force-pushed |
| `.gitignore` | no entry for the folder |
| the submodule | unchanged: `*.pdf` stays gitignored in `pdcgo/san_receipt_readers`, whose own history holds no PDF |
| reverses | the privacy row of [the-reader-is-a-submodule-with-its-own-module](#the-reader-is-a-submodule-with-its-own-module), *"the real samples stay untracked"* |
| stale, outside this repo's docs | the submodule's README, line 25, still says the folder is untracked |

## a-receipt-mismatch-is-only-a-warning

> Owner, in chat (2026-10-31): *"what warning ?"*, *"the warning is just warn its different ?"*, then *"for now just warn
> thats different thats it"* — to [Q17](./context_clarify.md#question), *five labels read cleanly, yet don't match what
> their orders store: what do the orders store?*

**The verdict.** For now a mismatch between the label and the typed resi is **only a warning**, and nothing more is done
about it. The five mismatched samples are not investigated; the reader is not changed for them.

```
CS attaches the label → the reader fills an EMPTY Resi box, never a typed one
CS submits, the typed resi differs →
  "Nomor resi tidak cocok dengan file resi, yang tertulis SPXID0123456."
  → CS fixes the box, or places the order anyway
```

| | |
| --- | --- |
| the warning | at submit, on the order form ([checks.ts](../../../../frontend/src/features/orders/form/checks.ts) `checkScanMatches`) — for the resi, the order id, or both |
| overrule | yes — *place anyway*; the server never verifies a label ([receipt-check-returns-what-the-library-reads](../../../business/shipment/context_decision.md#receipt-check-returns-what-the-library-reads)) |
| the five samples | not investigated — `shopee_instant_01`, `shopee_halu_02`, `shopee_spx_01`, `shopee_std_02`, `lazada_lex_02` |
| [the-pickup-code-is-the-receipt](#the-pickup-code-is-the-receipt) | stands — `shopee_instant_01` is not taken as evidence against it |
| when it comes back | a wrong resi on a real order, traced to the reader |
| ✅ built | nothing to build — this is what runs |

## jnttest-is-a-tiktok-jnt-express-label

> Owner, in chat (2026-11-02): *"i follow your recomendation"* — to [Q1](./context_clarify.md#question), *which app
> produced `jnttest.pdf`?* As recommended.

**The verdict.** `jnttest.pdf` is a **TikTok** label carried by **J&T Express**. It shares its generator
(`wkhtmltopdf` + `pdfcpu`) and its fonts with a known TikTok / Tokopedia label, and its order id is a TikTok one.

| | |
| --- | --- |
| how it is read | unchanged — already under the TikTok layouts (`jnt.go`) |
| what changes | its name only: it is filed as *TikTok, J&T Express* |
| ✅ built | nothing to build |

## a-kiriminaja-label-leaves-the-order-id-empty

> Owner, in chat (2026-11-02): *"i follow your recomendation"* — to [Q11](./context_clarify.md#question), *a KiriminAja
> label: is its booking number the order id?* As recommended, and as built.

**The verdict.** A KiriminAja label fills **no** order id. The only id it prints is KiriminAja's own booking number
(`OID-…`, under *No. Trx KiriminAja*) — an aggregator's number, not the marketplace's. The order id box stays empty and
the person types the marketplace's reference, so the settlement import, which matches orders by that reference, still
finds the order.

```
a KiriminAja label:   No. Trx KiriminAja: OID-20251104-8812   ← the aggregator's
the order id box:     (empty — CS types the marketplace's order id)
```

| | |
| --- | --- |
| `OrderID` | `""` |
| `Receipt` | the tracking number of the courier KiriminAja booked, as read today |
| ✅ built | nothing changes — this is what the reader does |

## the-phone-is-the-recipients-never-the-senders

> Owner, in chat (2026-11-02): *"i follow your recomendation"* — to [Q8](./context_clarify.md#question), *`Phone`: only one label prints the recipient's — whose phone is it?* As
> recommended, and as built, with Q8 and Q10 in one answer.

**The verdict.** `Phone` is the **recipient's** phone, filled only when the label prints it in full. It is **never** the
sender's: a Shopee label prints only the seller's own number, under `Pengirim:`, and reading that would fill the
seller's number in as the customer's. So the field is filled on one label in thirty-seven today, and that is accepted.

```mermaid
flowchart LR
  S["Shopee - the SENDER's phone only"] --> E["Phone is empty"]
  T["TikTok - the recipient's, masked"] --> E
  K["KiriminAja - the recipient's, in full"] --> F["Phone is filled"]
```

| | |
| --- | --- |
| `Phone` | the recipient's, as printed, when printed in full · `""` otherwise |
| the sender's phone | never read, on any label |
| ✅ built | nothing changes — this is what the reader does |

## a-masked-value-comes-back-empty

> Owner, in chat (2026-11-02): *"i follow your recomendation"* — to [Q9](./context_clarify.md#question), *a masked value: empty, or as printed?* As
> recommended, and as built, with Q8 and Q10 in one answer.

**The verdict.** A recipient's name or phone that the label prints **masked** — any `*` in it — comes back **`""`**.
TikTok's courier labels print the name as `a**i` and the phone as `(+62)81*******00`; an empty box is better than a
customer card that says `a**i`.

```
printed:    a**i            (+62)81*******00
returned:   ""              ""
TikTok's instant label:  the name in full → returned · the phone still masked → ""
```

| | |
| --- | --- |
| `CustomerName`, `Phone` | `""` when the printed value carries a `*`; as printed otherwise |
| the masked form | not returned — nothing can be done with it |
| ✅ built | nothing changes |

## the-address-is-one-string-joined-by-spaces

> Owner, in chat (2026-11-02): *"i follow your recomendation"* — to [Q10](./context_clarify.md#question), *the address: one string, wrapped words split?* As
> recommended, and as built, with Q8 and Q10 in one answer.

**The verdict.** `Address` is **one string**: the address box's lines joined by a space. The box wraps inside words, and
on these PDFs a wrap inside a word can't be told from one between words, so a split word stays split (`Gro gol Sel`)
and two words are never glued together (`KALIMANTANBARAT`). A Shopee label's **region boxes**
(`KOTA JAKARTA BARAT | KEMBANGAN`) are not returned yet: they get their own fields when the order form wants the
address structured. That is a contract change, made then.

```
the box:     Jl. Panjang No. 5, Kedoya, Gro
             gol Sel, Kebon Jeruk
returned:    Jl. Panjang No. 5, Kedoya, Gro gol Sel, Kebon Jeruk
```

| | |
| --- | --- |
| `Address` | the box's lines, joined by one space; the address tag above it (`HOME`, `RUMAH`) left out, as today |
| the region boxes | not read — a field of their own when the order form reads them |
| ✅ built | nothing changes |

## a-picture-label-is-read-from-its-barcodes-only

> Owner, in chat (2026-11-02): *"i follow your recomendation"* — to [Q13](./context_clarify.md#question), *a label printed
> as a picture: the receipt from its barcode, or OCR for the rest too?* As recommended, and as built.

**The verdict.** A label PDF with no text — only an image of the label (`jnt_eco_01.pdf`, `shopee_std_01.pdf`) — is
read from its **barcodes and QR codes only**. They give the tracking number and, when a barcode carries it, the order
id. The name, phone and address are pixels and come back `""`. **No OCR**: it would need a native library in every
server or a paid cloud service that sends the buyer's address outside the system, and no screen reads a label's
recipient yet ([the-phone-is-the-recipients-never-the-senders](#the-phone-is-the-recipients-never-the-senders)).

```mermaid
flowchart LR
  P["a page with no text"] --> B["decode every image's QR and Code 128"]
  B -->|"a J and T or SPX number, every copy agreeing"| R["Receipt"]
  B -->|"a Shopee order number beside it"| O["OrderID"]
  B -->|"nothing of that shape"| U["unknown layout"]
```

| | |
| --- | --- |
| `Receipt` | from the barcodes, every copy agreeing |
| `OrderID` | from a barcode when one carries it (SPX, `shopee_std_01.pdf`), else `""` |
| `CustomerName`, `Phone`, `Address` | `""` |
| the library | `gozxing` (pure Go, MIT) — about 3 ms a label |
| revisit OCR | only if picture labels turn out common — the upload tool saves every label it cannot read, so the samples will show it |
| ✅ built | nothing changes — `jnt_picture.go`, `spx_picture.go`, `shopee_barcode.go` |

## a-reservation-number-is-read-as-the-order-id

> Owner, in chat (2026-11-02): *"i follow your recomendation"* — to [Q14](./context_clarify.md#question), *a Shopee
> reservation label: is the reservation number the order id?* The recommendation was to keep the reader as built
> **either way**, whatever the label turns out to be for. As recommended, and as built.

**The verdict.** A Shopee label that prints `No.Reservasi:` where an order label prints `No. Pesanan:`
(`shopee_spx_02.pdf`, addressed to an SPX hub) gives its **reservation number as the `OrderID`**. It is Shopee's own
number for the parcel, captioned where the order number would be. The reader only reads the label; whether the parcel
is a buyer's order is the caller's to decide.

```
No.Reservasi: 260101ABCDEFGHIJK      ← the box wraps it
Pesan: (260101ABCDEFGHIJKLM)         ← printed whole → OrderID, when the box's part is how it starts
Penerima: … RDC - Pengiriman Kilat   ← the hub → CustomerName, as printed
```

| | |
| --- | --- |
| `OrderID` | the 19-character reservation number |
| `CustomerName` | the hub's name, as printed — the hub is the recipient |
| the order form | never warns on its shape ([the-form-does-not-check-number-formats](../../frontend/order_create_decision.md#the-form-does-not-check-number-formats)); it only stops offering Shopee as the marketplace, its hint knowing 12–14 characters |
| not answered | what a reservation label is FOR — a buyer's order routed through the hub, or stock sent into Shopee's own warehouse. Nothing here depends on it. If it is stock, how that stock leaves our warehouse is an inventory question, opened when such a parcel is handled |
| ✅ built | nothing changes — `shopee.go`'s `shopeeReservation` |

## a-label-is-read-from-a-pdf-only

> Owner, in chat (2026-11-02): *"i follow your recomendation"* — confirming the overtaken list, which named [Q4](./context_clarify.md#question), *do sellers
> upload photos of labels?*

**The verdict.** A label is read only from a **PDF**. A photo would need OCR, which is a different package at a
different cost, and a PDF holding a picture is still read from its barcodes
([a-picture-label-is-read-from-its-barcodes-only](#a-picture-label-is-read-from-its-barcodes-only)). It is what is
built, and what was accepted with the receipt check
([the-receipt-check-prototype-is-accepted](../../../business/shipment/context_decision.md#the-receipt-check-prototype-is-accepted)).

```
a PDF label                → read
a JPEG, a phone photo      → not sent to the reader — the person types the numbers
```

| | |
| --- | --- |
| the upload | still accepts both ([document.proto:34](../../../../proto/warehouse/document/v1/document.proto#L34)) — only the READ is PDF-only |
| ✅ built | the order form sends only `application/pdf` to `ReceiptCheck` |

---

## the-reader-lives-in-backend-pkgs

> Owner, in chat (2026-11-03): *"can you move it to pkgs"* — then, of the options put to them: *"Only move the folder:
> still a submodule with its own module, at backend/pkgs/san_receipt_readers"*, and *"Keep the GitHub repo"*.

**The verdict.** Only the FOLDER moves: `backend/packages/san_receipt_readers` → `backend/pkgs/san_receipt_readers`.
Everything else in [the-reader-is-a-submodule-with-its-own-module](#the-reader-is-a-submodule-with-its-own-module)
stands — the public repo `pdcgo/san_receipt_readers`, a git submodule, its own Go module, built through a `replace`,
a change being two commits. The module path does not change, so no import does (`shipment_v1`, `tools/receipt_iterate`).

```mermaid
flowchart LR
  W["warehouse_revamp go.mod"] -->|"replace with ./backend/pkgs/san_receipt_readers"| S["backend/pkgs/san_receipt_readers, own go.mod"]
  S -->|"git submodule, path moved"| G["github.com/pdcgo/san_receipt_readers, unchanged"]
  P["backend/pkgs, this repo's packages"] -.->|"now also holds"| S
```

| | |
| --- | --- |
| the move | `git mv` — `.gitmodules`' `path` follows; the submodule's NAME stays `backend/packages/san_receipt_readers` (a name is an id, not a folder). Pinned commit unchanged |
| `backend/pkgs/` | now mixes this repo's own packages with one nested module. ⚠ Root `go build / vet / test ./...` skips it, as before — test it from inside |
| CI | the submodule step loops over every `path` in `.gitmodules` instead of `backend/packages/*`, so the next move needs no CI edit |
| also updated | root `go.mod` `replace`, `.gcloudignore`, CLAUDE.md's command table, receipt.proto's comment (and its generated `receipt_pb.ts`), the state and clarify docs' links |
| owner's spec | [context.md](./context.md) §General now says `backend/pkgs/san_receipt_readers` — edited by the agent with the owner's permission, given for that session only (2026-11-03) |
| ⚠ left to the owner | the submodule's own README line 21 (a commit in the other repo) |
| ✅ built | 2026-11-03 |
