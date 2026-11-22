# shipment_service — complex RPC flows

The channel catalogue's RPCs are single-table CRUD and need no entry — except for what the courier's TRACKING LINK
asks of a write and of the screens that read it (below). `ReceiptCheck` does: it touches no table, but its request
passes three gates before the handler runs, and every answer about the file comes back as a RESULT.

## ReceiptCheck — read an uploaded shipping label

Called by the order form the moment a label PDF is picked, BESIDE its upload to document_service
([receipt-check-takes-the-file-bytes](../../business/shipment/context_decision.md#receipt-check-takes-the-file-bytes)) —
never on the stored document, and never by another service.

```mermaid
sequenceDiagram
    participant UI as Order form
    participant T as Connect transport
    participant V as validator
    participant A as access interceptor
    participant H as ReceiptCheck
    participant R as san_receipt_readers
    UI->>UI: checkLabel(file) — a PDF only, over 2 MB answered unreadable here and never sent
    UI->>T: ReceiptCheck(file_content), JSON, the bytes as base64
    alt body over 3 MB
        T-->>UI: ResourceExhausted — refused before it is read
    end
    T->>V: the request
    alt file over 2 MB, or empty
        V-->>UI: InvalidArgument
    end
    V->>A: the request
    alt no token, or an invalid one, or a suspended account
        A-->>UI: Unauthenticated, or PermissionDenied
    end
    A->>H: any signed-in user, no team scope
    alt two checks already running
        H-->>UI: ResourceExhausted at once, never queued — the form treats it as no check
    end
    H->>R: Extract(the bytes), holding one of the two slots
    R-->>H: ReceiptData, or an error — the slot is given back here, not when the caller leaves
    H->>H: the error as a result — ErrUnreadable, ErrNotShippingLabel, anything else is an unknown label
    H->>H: log the result, the size and the time — never a field, never the bytes
    H-->>UI: result + receipt, order_ref_id, customer_name, phone, address — all "" unless READ
    UI->>UI: READ fills only the EMPTY boxes, a mismatch warns at Create, three results show a notice
```

| result | when | the fields | the order form |
| --- | --- | --- | --- |
| `READ` | `Extract` returned no error | its `ReceiptData`, field for field (`OrderID` → `order_ref_id`) | fills the empty boxes, warns on a mismatch at Create |
| `UNKNOWN_LABEL` | any error but the two exported ones | all `""` | nothing |
| `MULTIPLE_LABELS` | ⚠ never, yet — see below | all `""` | "this file holds several labels" |
| `NOT_SHIPPING_LABEL` | `ErrNotShippingLabel` | all `""` | "this is not a shipping label" |
| `UNREADABLE` | `ErrUnreadable` | all `""` | "this file can't be opened" |

**Why these choices:**

- **A result, not an error** ([a-label-outcome-is-a-result-not-an-error](../../business/shipment/context_decision.md#a-label-outcome-is-a-result-not-an-error)).
  A label the reader has not learned yet is normal. The handler's one error of its own is about the server, never the
  file — two checks already running (below). Every other Connect error the caller can see comes from the transport, the
  validator or the access interceptor.
- **Two at once, and no queue** ([an-attached-file-is-up-to-15-mb-and-two-checks-run-at-once](../../business/shipment/context_decision.md#an-attached-file-is-up-to-15-mb-and-two-checks-run-at-once)).
  A buffered channel of 2 on the `Service`, taken without waiting: a third call is `ResourceExhausted` before `Extract`
  sees a byte. The form's `checkLabel` answers any failed call `null` — no notice, no toast — so the person types the
  numbers, as for a label the check cannot read. The slot is given back when `Extract` returns (deferred, so a panic
  cannot keep it); `Extract` takes no context, so a cancelled request keeps its slot until the reader finishes. ⚠ Per
  process: each API instance has its own two. The body is already decoded when the handler runs, so the limit bounds the
  reader's CPU, not the 3 MB read.
- **It reads, it never verifies** ([receipt-check-returns-what-the-library-reads](../../business/shipment/context_decision.md#receipt-check-returns-what-the-library-reads)).
  No match verdict is returned, so nothing can refuse an order on it.
- **Any signed-in user, no scope** ([receipt-check-needs-a-login](../../business/shipment/context_decision.md#receipt-check-needs-a-login)).
  `allow_only_authenticated` on the request message, and no `use_scope` field: the check reads no team's data. The
  interceptor still resolves the caller once, so a suspended account is refused.
- **Two caps, in that order** ([receipt-check-caps-the-body-before-reading](../../business/shipment/context_decision.md#receipt-check-caps-the-body-before-reading)).
  `connect.WithReadMaxBytes(3 << 20)` on this handler only (`register.go`) stops an oversize body before it is buffered;
  `max_len` 2 MB on the field is the reader's own cap, and leaves room for 2 MB as base64 JSON.
- **The log carries the result only** ([receipt-check-logs-only-the-result](../../business/shipment/context_decision.md#receipt-check-logs-only-the-result)).
  `Extract`'s error is left out too: its text can carry the PDF library's message about the file.
- ⚠ **`MULTIPLE_LABELS` is unreachable today.** The reader refuses a bulk print but its error for it is unexported
  ([receipt_readers critique 4](../../technical/packages/receipt_readers/context_clarify.md#critique)), so a bulk print
  answers `UNKNOWN_LABEL`. Safe — nothing is filled either way — and the handler maps it the day the reader exports it.
- ⚠ **The cost grows with the square of the page count.** A real label reads in ~5 ms; the worst 2 MB file the
  contract admits takes over a minute of CPU. The owner declined a page cap: the two-at-once limit keeps that to two
  cores, and one call's worst case is unchanged —
  [audits/services/shipment_service/performances/ReceiptCheck.md](../../../audits/services/shipment_service/performances/ReceiptCheck.md).

Code: `backend/services/shipment_service/shipment_v1/receipt_check.go` (the slots: `receiptChecksAtOnce`,
`tryHoldCheck`, `readLabel`), `backend/services/shipment_service/register.go`,
`frontend/src/features/shipment/receiptCheck.ts`.

## ShipmentChannelCreate / ShipmentChannelUpdate — the tracking link

Root keeps one optional link per courier, `tracking_url`, the courier's own tracking page with `{resi}` where the
number goes ([an-orders-resi-links-to-the-couriers-tracking-page](../../business/shipment/context_decision.md#an-orders-resi-links-to-the-couriers-tracking-page),
[the-tracking-link-prototype-is-accepted](../../business/shipment/context_decision.md#the-tracking-link-prototype-is-accepted)). The write checks it before
anything else; the order screens read it from the courier catalogue they already hold.

```mermaid
sequenceDiagram
    participant UI as Channel Pengiriman form
    participant V as validator
    participant A as access interceptor
    participant H as Create or Update
    participant DB as shipment_channels
    UI->>UI: trackingLinkProblem(link) on leaving the field — Simpan off until fixed
    UI->>V: tracking_url, trimmed
    alt over 500 characters
        V-->>UI: InvalidArgument
    end
    V->>A: the request
    alt not root
        A-->>UI: Unauthenticated, or PermissionDenied
    end
    A->>H: root
    H->>H: checkTrackingURL — empty is fine, otherwise https, then holds the resi, then an address
    alt refused
        H-->>UI: InvalidArgument, the reason in its own words — nothing written
    end
    H->>DB: INSERT, or UPDATE name, desc, tracking_url and updated_at in one statement — empty clears it
    DB-->>H: the row, CHECK tracking_url shape as the last word
    H-->>UI: the channel with its tracking_url
```

| the link | answer |
| --- | --- |
| `""` | taken — the courier has no link; its orders' resi stays copy-only |
| not starting `https://` (any case) | `InvalidArgument` *the tracking link must start with https://* |
| no `{resi}` | `InvalidArgument` *the tracking link must hold {resi} where the resi goes* ([a-tracking-link-must-carry-the-resi](../../business/shipment/context_decision.md#a-tracking-link-must-carry-the-resi)) |
| a space, or no host | `InvalidArgument` *the tracking link is not a web address* |
| over 500 characters | `InvalidArgument` from the validator (`max_len`) |

**Why these choices:**

- **One rule, two places.** The form's `trackingLinkProblem` (`frontend/src/features/shipment/trackingLink.ts`) and the
  handler's `trackingURLProblem` refuse the same links in the same order, so the form's words are what the server would
  say; the server is the one that counts.
- **Update writes every editable field as sent** — name, desc and the link, like desc before it: an empty link clears
  it. The code is still never sent ([a-code-never-changes](../../business/shipment/context_decision.md#a-code-never-changes)).
- **Reads are unchanged in shape.** `ShipmentChannelList` and `ShipmentChannelByIds` return the column with the rest of
  the row, deleted channels included ([a-deleted-channel-still-resolves-by-id](../../business/shipment/context_decision.md#a-deleted-channel-still-resolves-by-id)),
  so an old order on a deleted courier still opens its link. One more text column on a catalogue of a dozen rows — no
  new query, no perf audit.
- **The screens ask nothing new per row.** The seller's order page, the warehouse's order page and the seller's list
  read the link from the session's courier catalogue (`features/shipping/catalogue.ts`, one `ShipmentChannelList` with
  deleted channels, shared by every courier badge) and fill every `{resi}` with the order's resi, URL-encoded
  (`trackingHref`).

Code: `backend/services/shipment_service/shipment_v1/tracking_url.go`, `shipment_channel_create.go`,
`shipment_channel_update.go`, migration `00003_add_shipment_channel_tracking_url.sql`;
`frontend/src/features/shipment/CourierTrackingLink.tsx`.
