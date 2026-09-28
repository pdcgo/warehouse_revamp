# Development state — settlement / settlement_importer

**Pass:** business analysis — **clarify re-examined** (2026-09-28) after the owner made both imports
server streams, drew a `## Flow`, decided who an imported row names and named the Excel Reader as its
reader; first pass 2026-09-26. Waiting on the owner — nothing of the service is
built. Source: [settlement_importer.md](../../business/settlement/settlement_importer.md) (owner: three RPCs
and a flow) · questions: [settlement_importer_clarify.md](../../business/settlement/settlement_importer_clarify.md)
· decided: [settlement_importer_decision.md](../../business/settlement/settlement_importer_decision.md).

## What is decided

| | |
| --- | --- |
| [the-import-is-one-streamed-call](../../business/settlement/settlement_importer_decision.md#the-import-is-one-streamed-call) | one server stream per file: the file rides IN the request, is stored in `document_service` first, then extracted and posted record by record — `message` + `step` + `count` on the stream. No queue. Overtook the first clarify's async recommendation |
| [the-file-is-named-by-its-content-hash](../../business/settlement/settlement_importer_decision.md#the-file-is-named-by-its-content-hash) | the stored statement's filename is the sha256 of its bytes plus `.xlsx`, computed by the importer — the request carries no `filename`. sha256 (not md5) is my proposal, flagged as such |
| [an-imported-row-names-its-orders-creator-else-the-uploader](../../business/settlement/settlement_importer_decision.md#an-imported-row-names-its-orders-creator-else-the-uploader) | a row whose ref finds an order names that order's creator — as `actor_id`, and so in the per-user report; any other row names the uploader. Answered analytic Q7 — my user 0 declined. ⛔ Not buildable on today's contract — [importer Q10](../../business/settlement/settlement_importer_clarify.md#question) |
| [a-tiktok-row-finds-its-order-by-related-order-id](../../business/settlement/settlement_importer_decision.md#a-tiktok-row-finds-its-order-by-related-order-id) | a TikTok row is looked up by `Related order ID`, every row — equal to the row's own id on all 2,710 sampled `Order` rows, the adjusted order on 8 of 23 adjustments, empty (the shop) on 15 |
| [the-excel-reader-reads-every-statement](../../business/settlement/settlement_importer_decision.md#the-excel-reader-reads-every-statement) | every statement is read by `san_excel_readers`; the skip list, the ref lookup, the key prefix and whole rupiah stay the importer's policy |

## What exists underneath it

| | |
| --- | --- |
| readers | ✅ [backend/pkgs/san_excel_readers/](../../../backend/pkgs/san_excel_readers/) — Shopee + TikTok, `GenerateUniqueID`, `SettlementType()`. ⚠ its own state report ([excel_readers.md](../packages/excel_readers.md)) is stale on `SettlementType()` — both platforms are mapped now, owner decision by decision · ⚠ its TikTok item is ten TikTok columns — a deviation from the reader doc's struct (Shopee's six), not yet accepted ([reader #23](../../technical/packages/excel_readers/context_clarify.md#critique)) |
| the write | ✅ `SettlementPost` — one row per call, idempotent on a GLOBAL `unique_id`, `source_type = exporter`, 1.8 ms · ⚠ the actor is ALWAYS the caller's token — `actorFrom(ctx)` ([post_entry.go:39](../../../backend/services/settlement_service/settlement_v1/post_entry.go#L39)); no field names anyone else |
| file store | ✅ `document_service` — two-phase upload; it never touches bytes, so the importer is its CLIENT: `RequestUpload` → PUT → `ConfirmUpload`, under the uploader's forwarded token. No resource type for a statement yet |
| long-task shape | ✅ [guidelines/code-implementation-guideline.md](../../../guidelines/code-implementation-guideline.md) — `returns (stream …)`, `string message` required, slog bound to the stream |
| the access interceptor | ⛔ **refuses every streaming RPC** (`Unimplemented`, root included) — [interceptor.go:57](../../../backend/services/user_service/access_interceptors/interceptor.go#L57). No warehouse RPC has ever streamed; `san remote`'s `Exec` has its own interceptor |
| order lookup by platform ref | ⛔ none — `selling_service` has no RPC that takes a ref, and the ref's uniqueness is decided but not built. The column is `orders.order_external_ref_id` (selling `00012`): not unique, no index. It now names the row's person as well as its order |
| `backend/services/settlement_importer_service/` | ⛔ does not exist |

## What blocks the first line of code

| | |
| --- | --- |
| the job, post or hold a ref that finds no order, revert, the shop guard, the TikTok affiliate split, failed withdrawals, the same file twice | [importer Q1–Q6 · Q9](../../business/settlement/settlement_importer_clarify.md#question) |
| ⛔ how a server stream is authorized — until then both imports answer `Unimplemented` | [importer Q7](../../business/settlement/settlement_importer_clarify.md#question) · [Contradiction](../../business/settlement/settlement_importer_clarify.md#the-long-task-guideline-streams-and-the-interceptor-refuses-every-stream) |
| whether an import finishes after its watcher leaves | [importer Q8](../../business/settlement/settlement_importer_clarify.md#question) |
| ⛔ how a row comes to name the order's creator — `SettlementPost` takes its actor from the token | [importer Q10](../../business/settlement/settlement_importer_clarify.md#question) |
| ⛔ the TikTok key — the reader doc's struct is Shopee's, the built item is unaccepted, and a re-download in the 2026-09 layout is unmeasured. A key that moves after the first import posts every line twice | [critique 14](../../business/settlement/settlement_importer_clarify.md#critique) → [reader #23 and its questions](../../technical/packages/excel_readers/context_clarify.md#critique) |
| `withdrawal` in `Σ change` would make every shop's position read as ~every sale | [settlement Q1](../../business/settlement/context_clarify.md#question) |
| `SettlementPost` refuses all five types added on 2026-09-24 — proto enum, mapper, fold columns and the analytic doc still carry eight | [contradiction](../../business/settlement/context_clarify.md#the-type-list-grew-to-thirteen-and-the-contract-still-takes-eight) |

## Measured — over all 26 sample workbooks, so nobody re-measures

| | |
| --- | --- |
| largest file | Shopee 1,463 rows / 19 days · TikTok 830 + 41 withdrawals / 26 days |
| largest file, in bytes | **246 KB** (`tiktok/shipping_issurance.xlsx`); Shopee's largest is 89 KB. The file now rides in the request, and **nothing caps a request**: connect-go defaults to *any size* and the backend sets no `WithReadMaxBytes` |
| identical bytes | **0** of the 26 samples share a sha256. The re-saved pair (`awan_beban_return` / `_simple`) differs, and TikTok stamps its `modified` time into `docProps/core.xml` (Shopee's carries none) — so the hash catches the SAME download uploaded twice, never the same period downloaded twice |
| fractional amounts | 0, all IDR — `float64` → `int64` is lossless on every sample |
| withdrawals vs `fund` | −839,987,638 against +827,877,151 — **101%**. In 25 of 26 files |
| TikTok `Earnings` | equals every `Order details` row summed, in 10 of 14 files |
| TikTok `GMV Pay Deduction` | equals the `GMV Payment for TikTok Ads` rows **to the rupiah** in all 3 files that carry it — which explains 3 of the 4 files where `Earnings` does not match. The 4th, `cannot_open.xlsx` (the 2026-09 layout), is off by its one `Other adjustment` |
| unmapped TikTok types | 5 of 14 files carry one |
| TikTok affiliate commission | a column inside `Total settlement amount` — −2,440,317 against +116,445,834 of `fund` in `shipping_issurance.xlsx` |

## Traps for the pass that builds it

- ⚠ **A re-import cannot correct anything.** A repeat key returns the STORED row (`created: false`); a key on
  another account is `errUniqueIDTaken`. Changing a mapping after the first import changes nothing in the ledger.
- ⚠ **The reader returns `ErrNoSettlementTypeMapping` for rows that must be SKIPPED** (`Earnings`,
  `GMV Pay Deduction`) exactly as for a type never seen. The skip list belongs in the importer.
- ⚠ **A revert counter must be per LINE, never per file** — overlapping downloads share lines.
- ⚠ **Look a TikTok row up by `Related order ID` — decided, on every row.** `Order/adjustment ID` is the order's
  only on an `Order` row; on an adjustment it is the adjustment's own id. Look THAT up and every adjustment finds
  nothing: it names the uploader and lands on the shop, for good.
- ⚠ **A server stream's scope cannot ride in `ctx` the way a unary call's does** — the interceptor calls
  `next` before `Receive` has decoded the request. Verified in connect-go v1.19.0 (`NewServerStreamHandler`
  receives INSIDE the wrapped function). The handler reads `team_id` off its own request.
- ⚠ **Naming a file by its hash dedupes NOTHING by itself** — `document_service` keys each object by a fresh
  uuid plus the name's extension ([tokens.go:83](../../../backend/services/document_service/document_v1/tokens.go#L83)),
  and `documents.filename` is not unique. Dedupe is the importer's lookup before upload (Q9). Keep `.xlsx` on
  the name, or the object is stored without an extension.
- ⚠ **buf `STANDARD` wants a distinct response message per RPC** — `TiktokSettlementImportResponse` and
  `ShopeeSettlementImportResponse`, both carrying the same file row.
- ⚠ **Widen the fold with `SettlementPost`, never after.** The fold refuses a type it has no column for, and
  nothing checks the report against the log ([the-reconcile-check-is-not-built](../../business/settlement/context_decision.md#the-reconcile-check-is-not-built))
  — a type accepted first is a row missing from the report, silently.
- ⚠ **The owner's `tools/report_withdrawal/` is theirs** — read it for the corpus size, never edit it.
