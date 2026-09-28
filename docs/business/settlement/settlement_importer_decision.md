# Decisions — `settlement_importer.md`

What the owner settled, recorded before it is acted on. **Append-only** — a decision that is later
reversed is renamed and its references grepped (RULE 12), never quietly edited away. The open set is
[settlement_importer_clarify.md](./settlement_importer_clarify.md).

| decision | what it decided |
| --- | --- |
| [the-import-is-one-streamed-call](#the-import-is-one-streamed-call) | one server-streaming call per file — the file goes IN the call, is stored, read and posted record by record while the stream reports progress. No queue |
| [the-file-is-named-by-its-content-hash](#the-file-is-named-by-its-content-hash) | the stored statement's filename is the hash of its bytes, computed by the importer — the person's own filename is not sent |

## the-import-is-one-streamed-call

> `settlement_importer.md` §Rpc That Must Have 1–2 and §Flow *(owner, 2026-09-28)* —
> *"`TiktokSettlementImport(response) return (stream response)`"*, and a flow that uploads to the document
> service, extracts, then loops *"Every Settlement Record"*: post, *"Send Message Log"*, *"send step and
> count record for frontend progress render"* — and *"close stream"*.

**The verdict.** An import is **one server-streaming call per file** — the long-task shape of
[the code guideline](../../../guidelines/code-implementation-guideline.md#implementation-for-long-running-task-rpc).
The file travels in the request. The importer stores it in `document_service` first, extracts the records,
and posts them one by one, streaming a log line and the progress after each. The stream closing is the
import finishing. It **overtakes** the clarify's recommendation to queue the file and return at once.

```mermaid
sequenceDiagram
    participant fe as Frontend
    participant import as Importer
    participant doc as Document Service
    participant settle as Settlement Service
    fe->>+import: the import call, carrying the file
    import->>doc: store it
    import-->>fe: message log
    import->>import: extract the records
    import-->>fe: count — how many records
    loop every record
        import->>settle: SettlementPost
        settle-->>import: created, or already there
        import-->>fe: message log, then step and count
    end
    import-->>-fe: close stream
```

### The spec

| | |
| --- | --- |
| shape | `rpc TiktokSettlementImport(…Request) returns (stream …Response)` — `ShopeeSettlementImport` the same |
| each response | `message`, the guideline's must-have — one slog line bound to the stream · plus `step` and `count`, so the screen draws progress without parsing a log |
| the file | in the request, not a `document_id`. The importer is therefore `document_service`'s client, through its shipped two-phase contract — `RequestUpload`, PUT, `ConfirmUpload` — under the uploader's own token |
| the order | **stored before it is read** — so a file the reader refuses is still kept, and that is exactly the file a developer needs: `cannot_open.xlsx` was one |
| per record | one `SettlementPost`. *Created* or *already there* is its idempotency on `unique_id`, already built |
| no queue | no worker, and no job table for a screen to poll |

### What it does NOT settle

- ⛔ **How a stream is authorized** — the access interceptor refuses every streaming RPC today:
  [importer Q7](./settlement_importer_clarify.md#question).
- **Whether the import finishes when nobody is watching** — [importer Q8](./settlement_importer_clarify.md#question).
- **A record that cannot post** — the flow draws two outcomes, the samples produce five:
  [critique 7](./settlement_importer_clarify.md#critique).

## the-file-is-named-by-its-content-hash

> Chat *(owner, 2026-09-28)* — *"make filename as content hash"*.

**The verdict.** The statement the importer stores in `document_service` is named by the **hash of its
bytes**, not by whatever the person's file happened to be called. The importer computes it over the bytes it
received; the client sends neither the name nor the hash.

```mermaid
flowchart LR
  B["the bytes, as received"] --> H["sha256 — 64 hex characters"]
  H --> N["the filename — the hash, plus .xlsx"]
  N --> R["RequestUpload"]
  H --> U["uploaded_files.content_sha256 — the same value"]
```

### The spec

| | |
| --- | --- |
| the name | the hash plus `.xlsx`. ⚠ **The extension stays**: `document_service` builds the storage key from the document's uuid and the filename's extension ([tokens.go:83](../../../backend/services/document_service/document_v1/tokens.go#L83)), so a bare hash would store the file with none |
| which hash | **sha256** — ⚠ *content hash* did not say which, so this part is my proposal. Not md5, the row keys' hash: once the hash is an identity ([importer Q9](./settlement_importer_clarify.md#question)), two different files must never share one, and sha256 costs the same. 64 characters, inside the 255 `RequestUpload` allows |
| computed by | the importer, over the bytes it received — never a value the client sends |
| the request | carries **no `filename`** — there is nothing left for it to say |
| the person's own name for the file | not kept. The list tells files apart by shop and date range, which the platform's generated names do not |

### What it does NOT settle

- **What the same bytes do a second time.** The name alone dedupes nothing: `document_service` keys every
  object by a fresh uuid and nothing is unique on `documents.filename`, so one file uploaded twice is two
  stored copies with one name — [importer Q9](./settlement_importer_clarify.md#question).
- ⚠ **The hash names BYTES, not a report.** Measured: 0 of the 26 samples share bytes, and the one re-saved
  pair — `awan_beban_return` and its `_simple` copy — hashes differently. A TikTok export also stamps its own
  `modified` time into the file, so re-downloading a period is new bytes too. What stops those from
  double-posting is the line keys, not the name.
