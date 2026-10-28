# supplier_service — RPC flows

The suppliers a selling team buys stock from, and the online stores each one sells through
([context_decision.md](../../business/supplier/context_decision.md)). Moved out of
[inventory_service](../inventory_service/rpc.md) by
[the-supplier-gets-its-own-service](../../business/supplier/context_decision.md#the-supplier-gets-its-own-service).

| service | RPC | what it is |
| --- | --- | --- |
| `SupplierService` | `SupplierCreate` | a supplier in the scoped team — **refused unless it is a SELLING team** (asks team_service) |
| | `SupplierUpdate` · `SupplierDelete` | the owning team's own; delete is **soft** |
| | `SupplierList` | `OWN` (My Supplier) or `EVERY_TEAM` (Discover Supplier), searched, filtered by store type and by the team that keeps it (`owner_team_id`, 0 = any), paged · the `CHANNELS` slice brings each supplier's stores |
| | `SupplierDetail` | **any** team's live supplier |
| | `SupplierByIds` | ids a caller holds — any team's, **deleted ones included, marked** |
| `SupplierChannelService` | `SupplierChannelList` | any team's live supplier's live stores, searched, filtered by type, paged |
| | `SupplierChannelCreate` · `Update` · `Delete` | the owning team's own; delete is **soft** |
| | `SupplierChannelByIds` | stores by id — any team's, **deleted ones included, marked**; what a restock line shows beside its supplier |
| `SupplierAnalyticService` | `MetricSearch` · `MetricData` | `metrics/suppliers`, the analytic pattern ([rpc_provide.md](../../business/analytic/rpc_provide.md)) — rank a page of suppliers, products or periods by one field, then fill those keys; grouped by SUMMARY, the headline |
| `SupplierAnalyticMaintenanceService` | `AnalyticReplayCompute` · `AnalyticMaintenanceRun` | Root and the Administrator — rebuild the figures from a day; prune the dedup table |
| *(webhook)* | `/event/supplier-fold/push` | the fold — *Restock Accepted* into `supplier_product_daily_reports` |

**Reads cross teams, writes do not**
([another-team-sees-everything-of-a-supplier](../../business/supplier/context_decision.md#another-team-sees-everything-of-a-supplier)) —
`team_id` is always the caller's scope, so a write puts `team_id = ?` in its `WHERE` and a read does not.
**Delete is soft** on both tables
([a-deleted-supplier-is-kept-for-its-figures](../../business/supplier/context_decision.md#a-deleted-supplier-is-kept-for-its-figures),
[a-store-delete-is-soft-too](../../business/supplier/context_decision.md#a-store-delete-is-soft-too)).

## SupplierCreate — asks team_service first

Only a selling team keeps suppliers
([only-a-selling-team-has-suppliers](../../business/supplier/context_decision.md#only-a-selling-team-has-suppliers)).
The request policy keeps a warehouse's own people out, but Root and the Administrator bypass the scope — so the
handler asks.

```mermaid
sequenceDiagram
  participant C as caller
  participant S as supplier_service
  participant T as team_service
  participant DB as suppliers
  C->>S: SupplierCreate — team_id, name, contact, address, description
  S->>T: TeamByIds — the team, under the caller's token
  alt the team is not a selling team, or unknown
    S-->>C: FailedPrecondition — nothing written
  else team_service unreachable
    S-->>C: Internal — nothing written, never read as selling
  else a selling team
    S->>DB: INSERT
    S-->>C: the supplier
  end
```

`supplier_deps.go` in the composition root answers the question; with nothing wired, every create is refused.

## SupplierChannelCreate — a store never lands on a deleted supplier

```mermaid
sequenceDiagram
  participant C as owning team
  participant S as supplier_service
  participant DB as suppliers, supplier_channels
  C->>S: SupplierChannelCreate — supplier_id, channel_type, name, uri, description
  S->>DB: BEGIN, SELECT the team's live supplier FOR SHARE
  alt another team's, deleted, or unknown
    S-->>C: NotFound
  else
    S->>DB: INSERT the store, COMMIT
    S-->>C: the store
  end
  Note over DB: a SupplierDelete racing it waits on the FOR SHARE lock, or lands first and the create is NotFound
```

## Who asks the supplier

```mermaid
sequenceDiagram
  participant INV as inventory_service — RestockRequestCreate or Update
  participant S as supplier_service
  INV->>S: SupplierByIds — each line's supplier_id, under the caller's token
  S-->>INV: the supplier, deleted marked — or absent
  INV->>S: SupplierChannelByIds — the stores the lines name, in one call
  S-->>INV: each store with its supplier, deleted marked — or absent
  Note over INV: both asked BEFORE the restock is locked. A store names its supplier and belongs to it, and a newly named store or supplier is live — else NotFound or InvalidArgument, nothing written
```

Each restock LINE's `supplier_id` and `supplier_channel_id` (inventory's `00024`; the restock-level column is gone) are
opaque ids into this service — any selling team's live supplier and store are accepted
([a-team-restocks-from-another-teams-supplier](../../business/supplier/context_decision.md#a-team-restocks-from-another-teams-supplier)).
The frontend's restock and batch screens read a supplier's name with `SupplierByIds` and a store's with
`SupplierChannelByIds` too, so a deleted supplier or store still names a past delivery, with its deleted badge
([a-deleted-supplier-still-shows-with-a-badge](../../business/inventory/restock_decision.md#a-deleted-supplier-still-shows-with-a-badge)).

## The move — not an RPC

`san supplier move` copies inventory_service's legacy rows in, ids kept
([existing-suppliers-move-with-their-ids](../../business/supplier/context_decision.md#existing-suppliers-move-with-their-ids)).
See [san.md](../../tools/san.md#supplier-move).

## The figures — a fold of Restock Accepted

A supplier's six figures are folded from the restock's accept, the way settlement's reports are folded from its ledger
([the-report-is-processed-like-settlement](../../business/supplier/context_decision.md#the-report-is-processed-like-settlement),
[the-figures-screens-are-accepted](../../business/supplier/context_decision.md#the-figures-screens-are-accepted)).
inventory_service publishes after the accept commits ([its doc](../inventory_service/rpc.md)); this service's webhook
folds.

```mermaid
sequenceDiagram
  participant INV as inventory_service — RestockRequestAccept
  participant PS as Pub/Sub — restock-accepted
  participant W as supplier_service webhook
  participant DB as supplier_service tables
  INV->>PS: RestockAccepted — after the accept commits, event_id restock-accepted N
  PS->>W: push to /event/supplier-fold/push
  Note over W,DB: ONE transaction — a failure rolls it all back and answers 500, so Pub/Sub retries
  W->>DB: process_event_lock FOR SHARE — held by a replay? then 500
  W->>DB: INSERT supplier_event_logs by event id — a duplicate stops here with 200
  loop each line that counted units
    W->>DB: upsert the day row — day, supplier, product, team — adding the six figures
  end
  W->>DB: lower figures_live_since to this accept, if earlier
  W-->>PS: 200
```

| | |
| --- | --- |
| the supplier | the RESTOCK's — every line counts for it until lines name a store ([the-supplier-comes-from-the-restock-until-lines-name-a-store](../../business/supplier/context_decision.md#the-supplier-comes-from-the-restock-until-lines-name-a-store)). A restock with none folds nothing and is acked |
| a figure's value | units × the line's total ÷ ordered — never a rounded unit price, so a line adds back to what it cost |
| the day | the event's `accepted_on`, the accept's Jakarta day — read, never re-derived |
| ⚠ lag | a figure lags the accept by the broker's delivery. In dev and e2e the subscriptions are PULL and nothing pulls, so the live fold does not run there unless `pubsub ensure` is given a `--push-base-url` — the backfill and the tests call the fold directly |

## The reads

ONE metric, `metrics/suppliers` — `SupplierMetric`, the six figures and the broken rate — read through the analytic
pattern every service's figures share ([rpc_provide.md](../../business/analytic/rpc_provide.md),
[the-pattern-replaces-the-shipped-analytics](../../business/analytic/rpc_provide_decision.md#the-pattern-replaces-the-shipped-analytics));
it replaced `AnalyticTimeSearch`, `AnalyticProductSearch`, `AnalyticGroupSearch` and `AnalyticGroupMetric` on
2026-10-27. Every read is `listQuery` on the screen and reads the folded table only. **Every selling team reads every
team's figures** ([every-selling-team-sees-every-teams-figures](../../business/supplier/context_decision.md#every-selling-team-sees-every-teams-figures)) —
a `TeamFilter` narrows to one restocking team
([the-team-filter-picks-any-selling-team](../../business/supplier/context_decision.md#the-team-filter-picks-any-selling-team)).

```mermaid
sequenceDiagram
  participant UI as Supplier Report
  participant S as supplier_service
  participant N as supplier and team names
  par the page and the headline
    UI->>S: MetricSearch — SUPPLIER, window, team, sort restock_valuation or broken_rate, offset and limit
    S-->>UI: the ranked supplier ids, has_next
  and
    UI->>S: MetricData — SUMMARY, the same filters, no keys
    S-->>UI: the headline, every supplier together
  end
  UI->>S: MetricData — SUPPLIER, the same filters, those ids
  UI->>N: SupplierByIds — names, a deleted supplier marked — and TeamByIds
  Note over UI: by broken rate, a supplier under the proto's rank_min_sample of 50 units follows, in key order, its rate muted
```

| read | groups | queries | note |
| --- | --- | --- | --- |
| `MetricSearch` | SUPPLIER, PRODUCT, DAILY … YEARLY — never SUMMARY | 1 — the scope grouped by the key, ordered, `limit + 1` | the sort is one `can_sort` field by its proto name; the key DESC breaks a tie; by `broken_rate`, units ≥ 50 ranked first ([rate-ranking-needs-50-units](../../business/supplier/context_decision.md#rate-ranking-needs-50-units)); no total, only `has_next` |
| `MetricData` | the same, and SUMMARY | 1 | every asked key comes back, zero when quiet; a period keyed by its first day — a Monday, the 1st, 1 January; SUMMARY takes no keys |

| filter | narrows | screen |
| --- | --- | --- |
| `DateRangeFilter` — required | the accept's Jakarta day, both ends inclusive, as literals in SQL (`window()`) | both |
| `TeamFilter` | whose restocks are counted | both |
| `SupplierFilter` | one supplier | the Statistics tab |

The Statistics tab lists its periods itself — a time group needs no search — so a quiet period is a row too, and
reads `MetricData` by DAILY / MONTHLY / YEARLY for the page's periods. Performance:
[MetricSearch.md](../../../audits/services/supplier_service/performances/MetricSearch.md),
[MetricData.md](../../../audits/services/supplier_service/performances/MetricData.md).

## AnalyticReplayCompute — never into the backfilled past

Settlement's replay, with one more refusal: figures folded by the backfill were never on the broker, so a replay must
start AFTER the live fold's first day.

```mermaid
flowchart TD
  R["AnalyticReplayCompute — start_date"] --> W{"inside the subscription's retention?"}
  W -->|"no"| X1["FailedPrecondition"]
  W -->|"yes"| L{"after the day of figures_live_since?"}
  L -->|"no, or no live fold yet"| X2["FailedPrecondition — the backfilled past cannot be redelivered"]
  L -->|"yes"| K{"process_event_lock — compare-and-set false to true"}
  K -->|"held"| X3["FailedPrecondition"]
  K -->|"taken"| D["delete figure rows and dedup rows from the day — one transaction"]
  D --> S["seek the supplier-fold subscription to that Jakarta midnight"]
  S --> U["release the lock — started, never done"]
```

`AnalyticMaintenanceRun` prunes `supplier_event_logs` received more than 45 days ago — longer than the broker's 31-day
retention, so a redeliverable message always finds its claim. It takes no lock.

## The backfill — not an RPC

`san supplier backfill-figures` folds the restocks accepted before the event existed, once
([past-accepts-are-backfilled-once](../../business/supplier/context_decision.md#past-accepts-are-backfilled-once)).
See [san.md](../../tools/san.md#supplier-backfill-figures).
