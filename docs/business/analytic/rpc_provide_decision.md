# Decisions — `analytic/rpc_provide.md`

What the owner decided about [rpc_provide.md](./rpc_provide.md), with the reasoning that produced it.
**Append-only** — a decision is added here before it is acted on, and it is never edited away.
The open set lives in [rpc_provide_clarify.md](./rpc_provide_clarify.md).

> ✏️ **Examples corrected (2026-10-26, owner-approved).** The early entries illustrated with *stock lost per shop*, which
> cannot exist — stock is lost in the warehouse, and a shop is a marketplace storefront. Their diagrams now use a
> **product** table (orders per product, stock lost per product — the shop filter is the one stock lost cannot use).
> No verdict changed. Quoted questions are left as they were asked.

---

## a-metric-rpc-is-guarded-like-every-rpc

> Owner, in chat (2026-10-26): *"role defined like other rpc in request payload"* — to
> [Q1](./rpc_provide_clarify.md#question), *"who may read a metric?"*. Against my recommendation (`roles` per metric
> in `MetricOption`, with one shared gate).

**The verdict.** `MetricSearch` and `MetricData` are guarded like every other RPC: a `request_policy` on the request
message and a top-level `team_id [use_scope]`. A metric carries **no roles of its own**. Whoever may call a service's
metric RPC may read every metric it serves, for the team they are scoped to.

```mermaid
flowchart LR
  c["caller - selling owner, team 5"] --> p["MetricDataRequest - request_policy"]
  p -->|"role allowed"| s["scope - team_id 5"]
  s --> m1["shop orders - team 5"]
  s --> m2["shop returns - team 5"]
  p -.->|"role not allowed"| x["denied - every metric of the RPC"]
```

**The spec.**

| | |
| --- | --- |
| who may call | the request message's `request_policy`, read by the access interceptor — one place for the whole ACL, as everywhere else |
| which team's numbers | the top-level `team_id`, `use_scope` — ROOT/ADMINISTRATOR in team 1 see every team's |
| `MetricOption` | `metric_id`, `supported_filters`, `required_filters` — **no** `roles` |
| why I give way | the scope already narrows every metric to the caller's own team, so the shared role list only matters for a metric that some roles **of the same team** must not see |
| still open | that one case — [a-metric-some-roles-must-not-see](./rpc_provide_clarify.md#a-metric-some-roles-must-not-see), [Q1](./rpc_provide_clarify.md#question) |

---

## every-member-reads-every-metric-of-their-team

> Owner, in chat (2026-10-26): *"for now, cs can view all metric inside that team joined. it for transparency"* — to
> [Q1](./rpc_provide_clarify.md#question), *"does a metric some roles of a team must not see get its own RPC pair?"*.
> Against my recommendation (its own pair, with a narrower policy).

**The verdict.** For now, every member of a team — the CS included — reads **every** metric of that team. There is no
metric hidden from one role inside a team, so no service needs a second metric RPC pair for it. The reason is
**transparency**: the people who run the shops see the same numbers as the people who own them.

```mermaid
flowchart LR
  o["owner - team 5"] --> r["MetricData - team 5"]
  cs["CS - team 5"] --> r
  r --> a["order count per shop"]
  r --> b["profit per shop"]
  x["CS - team 7"] -.->|"scope - not a member of team 5"| no["denied"]
```

**The spec.**

| | |
| --- | --- |
| inside a team | every role the RPC's `request_policy` allows reads every metric that RPC serves — no metric is narrower |
| across teams | unchanged — the `team_id` scope keeps a caller to the teams they joined ([a-metric-rpc-is-guarded-like-every-rpc](#a-metric-rpc-is-guarded-like-every-rpc)) |
| a service's metric RPCs | one `MetricSearch` / `MetricData` pair per service |
| *"for now"* | a metric that must be hidden from a role later gets its own pair with the narrower policy — an added RPC, no change to the others |

---

## a-new-metric-removes-the-filters-it-cannot-use

> Owner, in chat (2026-10-26): *"add stock lost, and remove shop filter"* — to [Q2](./rpc_provide_clarify.md#question),
> *"a metric that cannot honour a filter the person set: drop the filter, or keep it and show that column as `—`?"*.
> As drawn in [rpc_provide.md](./rpc_provide.md), against my recommendation (keep the filter, dash the column).

**The verdict.** The filter bar is the **intersection** of what every selected metric supports, as the doc draws it.
Adding a metric that cannot use a filter the person set **removes that filter**, and every column is reloaded without
it — so every number on screen always answers the same question.

```mermaid
flowchart LR
  a["orders per product - shop = Toko Melati"] -->|"add stock lost per product"| b["shop filter removed"]
  b --> c["orders per product - every shop"]
  b --> d["stock lost per product - stock has no shop"]
```

**The spec.**

| | |
| --- | --- |
| the filters shown | the intersection of every selected metric's `supported_filters` |
| a filter set and then unsupported | removed when the metric is added, and every column reloads |
| a required filter | the union of every selected metric's `required_filters` — the table does not load without them |
| the notice | proposed, not decided: a toast names the filter removed and the metric that removed it — *"Shop filter removed: stock lost cannot filter by shop"* |
| removing the metric again | does not bring the filter back — the person sets it again |

---

## the-pattern-replaces-the-shipped-analytics

> Owner, in chat (2026-10-26): *"yes, its more robust right ?"* — to [Q3](./rpc_provide_clarify.md#question), *"does
> this pattern replace the three shipped analytic contracts?"*. As recommended.

**The verdict.** `MetricSearch` / `MetricData` **replace** the analytic reads already shipped in settlement, supplier
and financial account. Supplier moves first, as the proof; the other two follow. A service never keeps both shapes —
its old reads are removed in the same change that moves its screen.

```mermaid
flowchart LR
  sup["supplier - 4 reads"] -->|"first, the proof"| p["MetricSearch + MetricData"]
  set["settlement - 3 reads"] -->|"then"| p
  fa["financial account - 3 reads"] -->|"then"| p
  m["ReplayCompute, MaintenanceRun"] -.->|"not reads - they stay"| k["unchanged"]
```

**The spec.**

| | |
| --- | --- |
| replaced | `AnalyticTimeSearch`, `AnalyticGroupSearch`, `AnalyticGroupMetric` in all three, and supplier's `AnalyticProductSearch` |
| kept | `AnalyticReplayCompute` and `AnalyticMaintenanceRun` — they repair the fold, they do not read it |
| the order | supplier → settlement → financial account |
| one shape per service | the old reads go in the same change that moves the screen — never two paths to one number |
| each report's own rules | carried over, never dropped in the move — see [a-rate-needs-a-minimum-sample](./rpc_provide_clarify.md#a-rate-needs-a-minimum-sample) |
| the guideline | [service-guideline.md](../../../guidelines/service-guideline.md) is the owner's: a pointer from it to this doc is theirs to add |

**Is it more robust?** As a system, yes: one provider, one rule for ties, totals, pages and missing keys, and a table
can mix services, which no shipped report can. It is weaker in **one** place unless guarded: a metric id or a sort
field is a string, so a typo fails at run time instead of at build. The guard is to never type one by hand — the
frontend reads both off the generated schema, and the server refuses an unknown one by reflection.

---

## the-fill-step-scopes-its-numbers-by-the-filters

> Owner (2026-10-26), in [rpc_provide.md](./rpc_provide.md) `### Service RPC Contracts.` — `MetricDataRequest` gained
> `repeated FilterItem filters` — and in chat, to *"does step 2 take the date range and product, only to scope the
> numbers?"*: *"yes"*. As recommended.

**The verdict.** The filters do two jobs. **Choosing the rows** is step 1's alone — `MetricData` never adds or drops a
key. **Scoping the numbers** is both steps' — `MetricData` takes the same filters `MetricSearch` used, and fills each
key under them.

```mermaid
flowchart LR
  f["filters - October, product 77"] --> s1["MetricSearch - choose and rank the rows"]
  f --> s2["MetricData - scope each number"]
  s1 -->|"keys - shop A, shop B"| s2
  s2 --> t["shop A 50, shop B 30 - still sorted"]
```

**The spec.**

| | |
| --- | --- |
| `MetricDataRequest.filters` | the **same** list `MetricSearch` was sent — the provider passes it on unchanged |
| a key in step 2 | answered whatever its numbers — never dropped, never added; a key with nothing gets an all-zero metric |
| why | without it, step 1 ranks by product 77 in October and step 2 fills every product, every month — the table reads unsorted |

---

## the-rows-are-the-keys-step-one-sends

> Owner, in chat (2026-10-26): *"depend that key list sended, is C included, its showed"* — to
> [Q4](./rpc_provide_clarify.md#question), *"when sorted by orders, is it OK that shop C — 0 orders, 3 lost — doesn't
> show?"*.

**The verdict.** A table's rows are **exactly** the keys `MetricSearch` returns. If the ranking service sends shop C,
C is shown; if it does not, C is not. No other service adds a row.

```mermaid
flowchart LR
  ord["MetricSearch - the ranking service"] -->|"keys it sends"| rows["the table's rows"]
  rows --> inv["every other service fills them"]
  c["shop C"] -.->|"shown only if the ranking service sends it"| rows
```

**The spec.**

| | |
| --- | --- |
| the rows | the keys step 1 returned, in its order — nothing else |
| a key with zero | the ranking service's choice: one that knows every shop of the team may send a shop with 0 orders, and it shows |
| a ratio across two services | cannot be sorted — it follows, since one service ranks and no single service holds both numbers (*sold ÷ in stock*) |
| a label on screen | proposed, not decided: *"rows: shops with orders"* when the ranking service sends only keys it has figures for |

---

## one-call-answers-every-asked-metric

> Owner (2026-10-26), in [rpc_provide.md](./rpc_provide.md) `### Service RPC Contracts.` — `MetricDataResponse` became
> `repeated MetricData metric_datas`, each a `oneof m`. Resolves the contradiction
> [one-metric-out-many-asked](./rpc_provide_clarify.md#one-metric-out-many-asked), as first recommended.

**The verdict.** One `MetricData` call answers **every** metric it was asked for: the response is a list, one item per
asked `metrics_ids` entry, and each item is a `oneof` holding that one metric's map.

```mermaid
flowchart LR
  rq["MetricData - shop orders, shop returns"] --> h["order service"]
  h --> i1["metric_datas 0 - shop_order_metric"]
  h --> i2["metric_datas 1 - shop_return_metric"]
```

**The spec.**

| | |
| --- | --- |
| `MetricDataResponse` | `repeated MetricData metric_datas` |
| `MetricData` | `oneof m { ShopOrderMetricMap shop_order_metric · … one case per metric the service owns }` |
| one item per asked metric | never fewer — a metric with nothing in the window is still an item, every key at zero |
| the provider | matches an item to its metric by the `oneof` case's message type and its `metric_id` option — never by position |

---

## a-week-is-monday-to-sunday-jakarta

> Owner, in chat (2026-10-26): *"ok"* — to [Q5](./rpc_provide_clarify.md#question), *"a week: Monday to Sunday,
> Jakarta?"*. As recommended.

**The verdict.** A weekly bucket is the **ISO week**: Monday 00:00 to Sunday 23:59, Jakarta time. Its key is the
Monday's date. A week that crosses a month end belongs to **no** month — so weekly figures are never summed into a
monthly one; a month is read from its own days.

```mermaid
flowchart LR
  d["Wed 1 Oct"] --> w["week of Mon 29 Sep - to Sun 5 Oct"]
  w --> s["3 days in September"]
  w --> o["4 days in October"]
  m["October total"] -.->|"read from October days, never from weeks"| o
```

**The spec.**

| | |
| --- | --- |
| a week | Monday to Sunday, Jakarta |
| its key | the Monday, `YYYY-MM-DD` — the bucket's first day, as daily, monthly and yearly already are |
| a week across two months | one bucket, whole — never split |
| a month's total | summed from its days, never from its weeks |
| a range starting mid-week | the first bucket is that week, holding only the days inside the range |

---

## a-metric-has-one-key

> Owner, in chat (2026-10-26): *"there is no metric keyed like that, for that case we have shop grouped metric that can
> filter by daterange and daily metric that can filter by date range and shop"* — to
> [Q6](./rpc_provide_clarify.md#question), *"one line per shop on a chart — shop × day in this pattern?"*. As
> recommended, and sharper: not *later*, but *never needed*.

**The verdict.** Every metric is keyed by **one** thing — a group id or a day. There is no shop × day metric. A chart
with one line per shop is two metrics the pattern already has: a **shop-grouped** metric ranks the shops over the date
range, and a **daily** metric filtered by date range **and one shop** draws each line.

```mermaid
sequenceDiagram
  participant met as Metric provider
  participant ord as Order Service
  met->>ord: MetricSearch - shop grouped, October, order_count desc, page of 3
  ord-->>met: shops A, B, C
  par one line per shop
    met->>ord: MetricData - daily, October, shop A
  and
    met->>ord: MetricData - daily, October, shop B
  and
    met->>ord: MetricData - daily, October, shop C
  end
  ord-->>met: one day series per shop - one line each
```

**The spec.**

| | |
| --- | --- |
| a metric's key | one — a group id (`IdList`) or a day (`DayList`), never both |
| a line per shop | a daily metric with `FILTER_TYPE_SHOP` set to that **one** shop — one call per line, in parallel |
| several shops in one shop filter | one line: their days summed — not a line each |
| which shops | the shop-grouped metric's `MetricSearch`, so the lines are the top shops of the same window |
| a cap on lines | proposed, not decided: 5 per chart, so a chart is never more than 6 calls |

---

## a-page-is-not-a-filter

> Owner (2026-10-26), in chat — *"for pagination, yes"* — and in [rpc_provide.md](./rpc_provide.md):
> `FILTER_TYPE_PAGINATION` removed from `FilterType`, and `PaginationFilter pagination` added to `MetricSearchResponse`.
> As recommended for the filter; where the page sits is still open
> ([the-page-is-on-the-response](./rpc_provide_clarify.md#the-page-is-on-the-response)).

**The verdict.** Paging is **not** a filter. A metric does not declare it, so adding a metric can never switch paging
off — every `MetricSearch` pages, always (HARD RULE 9).

```mermaid
flowchart LR
  f["FilterType - date, keyword, product, team, shop, supplier"] --> i["intersection - may drop any of them"]
  p["the page"] -->|"not in FilterType"| s["every MetricSearch - always paged"]
```

**The spec.**

| | |
| --- | --- |
| `FilterType` | no `FILTER_TYPE_PAGINATION` |
| a metric's `supported_filters` | never lists paging |
| `MetricSearch` | always pages — the intersection cannot remove it |
| `MetricData` | does not page — it fills the keys of one page, so it is capped at a page's size |

---

## compare-in-another-tab-for-now

> Owner, in chat (2026-10-26): *"defer A / B view. for now its simply user can open different tab for compex
> comparing"* — to [Q7](./rpc_provide_clarify.md#question), *"A / B compare: what may differ between A and B?"*.

**The verdict.** There is **no A / B view** for now. To compare, the person opens the report in a second browser tab
with other filters and reads the two side by side. The pattern needs nothing for it: each tab is an ordinary table.

```mermaid
flowchart LR
  t1["tab 1 - Toko Melati, October"] --> r1["MetricSearch + MetricData"]
  t2["tab 2 - Toko Melati, September"] --> r2["MetricSearch + MetricData"]
  r1 -.->|"the person reads both"| p["the comparison"]
  r2 -.-> p
```

**The spec.**

| | |
| --- | --- |
| an A / B view | ⏸ deferred — (a) any filters, (b) one filter split, (c) the period only stay unchosen |
| comparing today | a second tab, same report, other filters |
| what the pattern needs | nothing — no compare key, no second filter set in a request |
| the report's state | proposed, not decided: metrics, filters, sort and page live in the **URL**, so *open in new tab* starts from the same table and only the filter to compare needs changing |

---

## superseded-a-headline-is-its-own-summary-metric

> ⛔ **Superseded 2026-10-27** by [the-headline-is-the-metric-grouped-by-summary](#the-headline-is-the-metric-grouped-by-summary)
> — the headline is the same metric read with `GROUP_TYPE_SUMMARY`, not a metric of its own.

> Owner, in chat (2026-10-26): *"No, we have different metric, like OrderSummaryMetric that can filtering to"* — to the
> critique [no-headline](./rpc_provide_clarify.md#critique), *"a `total` case on the keys, so the fill step answers one
> row for the whole filter?"*. Against my recommendation.

**The verdict.** A report's headline is **its own metric** — `OrderSummaryMetric` — with filters like any other. It
has **no key**: it answers one row for everything the filters cover. The keys stay ids or days; there is no `total`
case.

```mermaid
flowchart LR
  f["filters - October, product 77"] --> s["OrderSummaryMetric - no key"]
  f --> g["ShopOrderMetric - keyed by shop"]
  s --> h["headline - orders 1.240, Rp 48 jt"]
  g --> t["table - page 1 of 7"]
```

**The spec.**

| | |
| --- | --- |
| a summary metric | a metric message with **no** `metric_key` field, its own `metric_id` (e.g. `metrics/orders/summary`) and its own `supported_filters` |
| how it is read | `MetricData` with the filters and **no keys** — the provider never calls `MetricSearch` for it |
| its answer | one message, not a map — `MetricData.m` holds `OrderSummaryMetric` itself |
| the shipped `total` fields | become summary metrics when each service moves ([the-pattern-replaces-the-shipped-analytics](#the-pattern-replaces-the-shipped-analytics)) |
| the headline and the table agree | proposed, not decided: a summary metric is summed from the **same** report table, under the same filters, as its grouped twin — so the headline is always the sum of every row, every page |

---

## a-day-is-a-jakarta-date-string

> Owner, in chat (2026-10-26): *"use `message DateRangeFilter { string start_date; string end_date }` like your
> recomendation"* — to the critique [a-day-not-a-timestamp](./rpc_provide_clarify.md#critique), after weighing
> `google.type.Date`. As recommended.

**The verdict.** A date range is two **Jakarta calendar days**, written `YYYY-MM-DD`, both inclusive. Never a
`Timestamp` — the report tables hold one row per Jakarta day, so a range that starts mid-day cannot be answered, and a
browser in another timezone would shift the day. A string, not `google.type.Date`, because a Time table's key is the
same day and a proto map cannot be keyed by a message: one shape for a day, everywhere.

```mermaid
flowchart LR
  f["DateRangeFilter - 2026-10-01 to 2026-10-31"] --> t["report table - one row per Jakarta day"]
  t --> k["a Time table's keys - 2026-10-01, 2026-10-02 ..."]
  k --> m["map of string to metric - the same shape"]
```

**The spec.**

```proto
message DateRangeFilter {
    string start_date = 1;   // "2026-10-01" — a Jakarta day, inclusive
    string end_date   = 2;   // "2026-10-31" — inclusive
}
```

| | |
| --- | --- |
| the format | `^[0-9]{4}-[0-9]{2}-[0-9]{2}$`, by protovalidate — as the shipped `AnalyticDateRange` |
| the timezone | always Jakarta — the string carries none, and the browser's is never applied |
| `end_date` before `start_date` | refused |
| a day key everywhere else | the same string — `DayList`, a Time map's key, a bucket's `at` |
| a week, a month, a year | keyed by its first day ([a-week-is-monday-to-sunday-jakarta](#a-week-is-monday-to-sunday-jakarta)) |

---

## superseded-one-metric-per-grain

> ⛔ **Superseded 2026-10-27** by [the-table-picks-one-group](#the-table-picks-one-group) — a grain is a `group_by`
> value, not its own metric. Kept as the record of what was decided before.

> Owner, in chat (2026-10-26): *"yes, i follow your recomendation, but later we also have
> metrics/orders/settlement/daily and other"* — to the critique [time-has-no-grain](./rpc_provide_clarify.md#critique),
> *"one metric per grain, or a `timeframe` field?"*. As recommended (revised from my first `timeframe` field).

**The verdict.** Daily, weekly, monthly and yearly are **four metrics**, each with its own `metric_id`, keyed by its
bucket's first day. No request carries a grain: picking *Weekly* on screen swaps the daily metric for the weekly one.
The four share one body message, so a measure is defined once. The same holds for every measure that follows —
`metrics/orders/settlement/daily` and the rest.

```mermaid
flowchart LR
  b["OrderCounts - order_count, order_total"] --> d["DailyOrderMetric - metrics/orders/daily"]
  b --> w["WeeklyOrderMetric - metrics/orders/weekly"]
  b --> m["MonthlyOrderMetric - metrics/orders/monthly"]
  b --> y["YearlyOrderMetric - metrics/orders/yearly"]
  p["person picks Weekly"] -.->|"provider swaps the metric"| w
```

**The spec.**

| | |
| --- | --- |
| a grain | its own metric message and `metric_id` — never a request field |
| the keys | the bucket's first day as `YYYY-MM-DD`: the day, the Monday, the 1st, 1 January ([a-week-is-monday-to-sunday-jakarta](#a-week-is-monday-to-sunday-jakarta)) |
| the body | one message per measure, shared by its four grains |
| a measure without a grain | is not offered at it — a metric that does not exist cannot be picked |
| more measures | follow the same shape: `metrics/orders/settlement/daily`, … |

---

## a-metric-id-is-a-name-not-a-route

> Owner, in chat (2026-10-26): *"ok"* — to the critique
> [a-metric-id-is-a-name-not-a-route](./rpc_provide_clarify.md#critique), *"the path is a name, the last segment is the
> key, an id is unique across every service?"*. As recommended.

**The verdict.** A `metric_id` is a **name** for people and the picker, never an address. Three rules:

```mermaid
flowchart LR
  id["metrics/orders/settlement/daily"] --> me["measure - orders/settlement"]
  id --> k["key - daily"]
  f["declared in settlement.proto"] --> s["owner - settlement service"]
  id -.->|"never read for the owner"| s
```

**The spec.**

| rule | |
| --- | --- |
| the path is a name, never a route | the provider finds a metric's service from the proto file that declares it — never from the path |
| the last segment is the key | `daily` · `weekly` · `monthly` · `yearly` · `summary` · a group (`shop`, `product`, …) — everything before it is the measure |
| the picker groups by measure | `orders/settlement` → daily · weekly · monthly · yearly · shop · summary |
| an id is unique across every service | checked at startup — two declarations of one id refuse to boot, as `ValidateDescriptors()` refuses a bad scope |
| the `metrics/` prefix | on every id, so an id is never mistaken for any other kind of string |

---

## a-sort-names-its-metric-and-field

> Owner (2026-10-26), in [rpc_provide.md](./rpc_provide.md) `## Proto Contracts.` — `MetricSort` became
> `{ metric_id, field, sort_type }`, and `SortOption.sort_key` became `field_sort_key`. To the contradiction
> [metric-key-means-three-things](./rpc_provide_clarify.md#metric-key-means-three-things). The sort as recommended;
> the sort key **kept**, against my *"the field's name is the key"*.

**The verdict.** A sort names **which metric** and **which field** — two metrics can both carry `order_count`, and the
sort must say whose. A sortable field declares its own `field_sort_key` in its option.

```mermaid
flowchart LR
  s["MetricSort - metrics/orders/shop, order_count, desc"] --> m["ShopOrderMetric"]
  m --> f["order_count - can_sort, field_sort_key order_count"]
  r["ShopReturnMetric - also has order_count"] -.->|"not this one - the metric_id says whose"| s
```

**The spec.**

| | |
| --- | --- |
| `MetricSort` | `string metric_id` · `string field` · `SortType sort_type` |
| `SortOption` | `bool can_sort` · `string field_sort_key` |
| what `MetricSort.field` carries | still open — [the-sort-field-has-two-names](./rpc_provide_clarify.md#the-sort-field-has-two-names) |

**Also in the same edit:** `DateRangeFilter` is now `string date_min` / `string date_max`. That is
[a-day-is-a-jakarta-date-string](#a-day-is-a-jakarta-date-string) under **your** field names — `date_min` / `date_max`
replace the `start_date` / `end_date` written there, and every rule of that entry holds for them.

---

## a-sort-field-is-its-proto-name

> Owner (2026-10-26), in chat — *"okey, i remove field_sort_key"* — and in [rpc_provide.md](./rpc_provide.md):
> `SortOption` is now `{ can_sort }` alone. To [the-sort-field-has-two-names](./rpc_provide_clarify.md#the-sort-field-has-two-names),
> after comparing the two. As recommended. Supersedes the `field_sort_key` row of
> [a-sort-names-its-metric-and-field](#a-sort-names-its-metric-and-field).

**The verdict.** A sortable field has **one** name — its proto name. `MetricSort.field` carries it (`"order_count"`),
and `SortOption` only says whether the field may be sorted. protoc already makes a field name unique within a message,
so nothing of ours has to.

```mermaid
flowchart LR
  f["order_count - can_sort true"] --> s["MetricSort.field - order_count"]
  s --> b["server - Fields().ByName, then can_sort"]
  g["frontend - ShopOrderMetricSchema.field.orderCount.name"] --> s
```

**The spec.**

| | |
| --- | --- |
| `SortOption` | `bool can_sort` — no key string |
| `MetricSort.field` | the field's proto name, snake_case: `"order_count"` |
| the server | `Fields().ByName(field)`; refused when the field is missing or not `can_sort` |
| the frontend | reads the name off the generated schema — never types it |
| renaming a sortable field | changes its sort key too — already a breaking change, since JSON clients read the same name |

---

## a-metric-page-has-no-total

> Owner, in chat (2026-10-26): *"returning total is expensive, so frontend just call next and next, and if data empty,
> its reach end of page. and its okay"* — to [the-page-is-on-the-response](./rpc_provide_clarify.md#the-page-is-on-the-response),
> *"the asked page on the request, `PageInfo` with the totals on the response?"*. Against my recommendation on the
> totals.

**The verdict.** `MetricSearch` returns **no total** — no page count, no item count. A total is a second aggregate over
the whole filter, run on every page turn. The screen asks for the next page until one comes back **empty**, and that is
the end. This is the pager the app already has: `GrowingPager` is *"a pager for lists that know only whether ANOTHER
page exists — no total"*.

```mermaid
sequenceDiagram
  participant ui as GrowingPager
  participant ord as MetricSearch
  ui->>ord: page 1
  ord-->>ui: 20 shops
  ui->>ord: page 2
  ord-->>ui: 20 shops
  ui->>ord: page 3
  ord-->>ui: none - the end
```

**The spec.**

| | |
| --- | --- |
| the request | carries the page asked for — `PaginationFilter { offset, limit }` on `MetricSearchRequest` |
| the response | the keys only — no total pages, no total items |
| the end | a page with no keys |
| the pager | `GrowingPager` ([every-list-pages-with-the-growing-pager](../../technical/frontend/context_decision.md#every-list-pages-with-the-growing-pager)) — never `Pagination`, which needs a total |
| ⚠ HARD RULE 9 | [CLAUDE.md](../../../CLAUDE.md) says a growing list *"returns a `warehouse.common.v1.PageInfo page_info`"*. A metric search does not — an exception, the owner's to write into the rule |
| the last full page | open — [the-last-page-is-an-empty-click](./rpc_provide_clarify.md#the-last-page-is-an-empty-click) |

---

## a-page-says-whether-another-follows

> Owner, in chat (2026-10-26): *"ok"* — to [the-last-page-is-an-empty-click](./rpc_provide_clarify.md#the-last-page-is-an-empty-click),
> *"a `bool has_next`, found by reading limit + 1 rows?"*. As recommended. Refines the end of
> [a-metric-page-has-no-total](#a-metric-page-has-no-total): the end is `has_next = false`, not an empty page.

**The verdict.** `MetricSearchResponse` carries `bool has_next`. The service reads **one row more** than the limit,
returns the limit, and `has_next` says whether the extra row existed. Still no total and no second query — and the
pager greys out **›** on the last real page instead of opening an empty one.

```mermaid
flowchart LR
  q["MetricSearch - limit 20"] --> r["the service reads 21"]
  r -->|"21 came back"| y["returns 20 - has_next true"]
  r -->|"20 or fewer"| n["returns them - has_next false"]
  n --> g["GrowingPager - the next arrow greys out"]
```

**The spec.**

| | |
| --- | --- |
| `MetricSearchResponse` | the keys · `bool has_next` |
| how it is found | `LIMIT limit + 1` on the same query — the extra row is never returned |
| the pager | `GrowingPager.hasNext` reads it directly |
| an empty page | only when the filter matches nothing at all — never as the end of a list |

---

## a-rate-ranks-only-above-its-minimum-sample

> Owner, in chat (2026-10-26): *"ok"* — to [a-rate-needs-a-minimum-sample](./rpc_provide_clarify.md#a-rate-needs-a-minimum-sample),
> *"declare a minimum on rate fields, named `rank_min_sample`?"*, after asking whether it is for performance (it is
> not — it is for the ranking to mean something). As recommended.

**The verdict.** A rate field declares the smallest sample it may be ranked on. Sorted by that rate, rows **at or
above** the minimum are ranked; rows below it **still show**, after the ranked ones, unranked. A rate from one unit is
luck, and a list that opens with it is not trusted.

```mermaid
flowchart LR
  s["sort - broken_rate desc - rank_min_sample 50"] --> r["ranked - Toko Y 40 of 800, 5%"]
  s --> u["then unranked - Toko X 1 of 1 - Toko Z 0 of 2"]
```

**The spec.**

```proto
message SortOption {
    bool  can_sort        = 1;
    int64 rank_min_sample = 2;   // a rate: rows with a smaller sample follow, unranked. 0 = no minimum
}

double broken_rate  [(metric_sort) = { can_sort: true, rank_min_sample: 50 }]
```

| | |
| --- | --- |
| what counts as the sample | the rate's own denominator — restocked units for a broken rate, orders for a cancel rate. The service knows it |
| a count or an amount | sets nothing — `0` is no minimum |
| rows below it | never dropped — they follow the ranked rows, in key order |
| the screen | reads the number off the descriptor — *"ranked among suppliers with ≥ 50 units"* — never a copy of its own |
| supplier's `rate_min_units` | becomes `rank_min_sample: 50` on `broken_rate` when supplier moves ([the-pattern-replaces-the-shipped-analytics](#the-pattern-replaces-the-shipped-analytics)) |
| performance | not its purpose — one more term in `ORDER BY` |

---

## the-key-breaks-every-tie

> Owner, in chat (2026-10-26): *"we default sort by desc"*, then — after *"why we add shop_id in order?"* was walked
> through — *"okey i accept it"*. To [ties-move-rows-between-pages](./rpc_provide_clarify.md#ties-move-rows-between-pages).
> As recommended, with the direction the owner's: DESC.

**The verdict.** Every `MetricSearch` ends its `ORDER BY` with the row's **key, descending**. Rows that tie on the
sorted value — common in a report: most shops cancel nothing in a week — then still have exactly one place, on every
query. Page 2 continues exactly where page 1 stopped, and a refetch of unchanged data puts every row back where it was.
A sort with no direction given is DESC.

```mermaid
flowchart LR
  t["A 5 - B 0 - C 0 - D 0 - E 0"] --> o["ORDER BY order_count DESC, shop_id DESC"]
  o --> l["always A, E, D, C, B"]
  l --> p1["page 1 - A, E"]
  l --> p2["page 2 - D, C"]
  l --> p3["page 3 - B"]
```

**The spec.**

| | |
| --- | --- |
| the tie-breaker | the metric's key — `shop_id`, `product_id`, the day — always last in `ORDER BY` |
| its direction | always DESC, whatever the person picked for the sort |
| `SORT_TYPE_UNSPECIFIED` | reads as DESC |
| who writes it | every `MetricSearch` — a rule of the pattern, never a per-metric choice |
| what it does not fix | a row whose number changes between two page loads can still cross the page boundary — the data moved, not the order |
| the cost | one more column in `ORDER BY`, on a key that is already indexed |

---

## the-headline-is-the-sum-of-its-rows

> Owner, in chat (2026-10-26): *"ok"* — to the proposed row of
> [a-headline-is-its-own-summary-metric](#superseded-a-headline-is-its-own-summary-metric), *"must the headline always equal the
> sum of the rows?"*. As recommended. That row is no longer *proposed*: it is this entry.

**The verdict.** A summary metric is summed from the **same report table**, under the **same filters**, as its grouped
twin. The headline is then always exactly the sum of every row on every page. Something a total needs that no row has —
an order with no shop — becomes **its own row**, so the sum still closes.

```mermaid
flowchart LR
  t["shop_order_daily_reports"] --> g["ShopOrderMetric - SUM, GROUP BY shop_id"]
  t --> s["OrderSummaryMetric - SUM, no GROUP BY"]
  g --> r["rows - 50 + 30 + ... = 1.240"]
  s --> h["headline - 1.240"]
  n["orders with no shop"] -->|"its own row - no shop"| g
```

**The spec.**

| | |
| --- | --- |
| a summary metric's source | the report table its grouped twin reads — never a second table, never the live source rows |
| its filters | the same `supported_filters`, applied the same way |
| what it may add | only what can be summed from those rows — an average or a rate is computed from the same sums |
| a fact with no group | a row of its own (`no shop`, `no supplier`), never only in the total |
| the check | the summary's sum and the grouped metric's sum over every key are equal — a unit test of every pair |

---

## the-report-lives-in-the-url

> Owner, in chat (2026-10-26): *"ok"* — to the proposed row of
> [compare-in-another-tab-for-now](#compare-in-another-tab-for-now), *"does the report keep its state in the URL?"*.
> As recommended. That row is no longer *proposed*: it is this entry.

**The verdict.** A report's state is its **URL**: the chosen metrics, the filters, the sort and the page. *Open in new
tab* then opens the same table, so comparing is changing one filter in the second tab. A refresh keeps the table, and a
link can be sent.

```mermaid
flowchart LR
  u["/reports/orders?m=...&date=2026-10-01..2026-10-31&shop=12&sort=...&page=2"] --> t1["tab 1 - October"]
  u -->|"open in new tab"| t2["tab 2 - the same table"]
  t2 -->|"change one filter"| t3["tab 2 - September"]
```

**The spec.**

| | |
| --- | --- |
| in the URL | the metric ids · every filter set · the sort (`metric_id`, field, direction) · the page |
| not in the URL | anything the access check decides — whoever opens a link sees only what their own role and team allow |
| a refresh | rebuilds the same table from the URL |
| a metric the URL names that no longer exists | dropped, and the filters it alone allowed go with it — as [a-new-metric-removes-the-filters-it-cannot-use](#a-new-metric-removes-the-filters-it-cannot-use) |
| a malformed value | ignored — the report opens without it, never an error page |
| the pager | `GrowingPager` opens at the URL's page, the trail starting there |

---

## a-removed-filter-is-announced

> Owner, in chat (2026-10-26): *"ok"* — to the proposed row of
> [a-new-metric-removes-the-filters-it-cannot-use](#a-new-metric-removes-the-filters-it-cannot-use), *"does the screen
> say when a metric removes a filter?"*. As recommended. That row is no longer *proposed*: it is this entry.

**The verdict.** When adding a metric removes a filter the person had **set**, an info toast says which filter and
why. A number that jumps on screen always comes with its reason.

```mermaid
flowchart LR
  a["Shop - Toko Melati - set"] -->|"add stock lost"| r["shop filter removed"]
  r --> t["toast - Shop filter removed - Stock lost cannot be filtered by shop"]
  n["no filter set"] -.->|"add stock lost"| q["nothing removed - no toast"]
```

**The spec.**

| | |
| --- | --- |
| when | a filter that had a value is removed because a metric was added |
| never | when nothing was removed — adding a metric is silent otherwise |
| the control | the app's `Toaster`, info tone, closes by itself |
| the copy | title *"Shop filter removed"* · description *"Stock lost cannot be filtered by shop."* — sentence case, as every toast |
| several at once | one toast naming every filter removed |
| undo | none — removing the metric does not restore the filter ([a-new-metric-removes-the-filters-it-cannot-use](#a-new-metric-removes-the-filters-it-cannot-use)) |

---

## one-sort-field-per-table

> Owner (2026-10-26), in [rpc_provide.md](./rpc_provide.md) `## Example Use Case In UI Why i Structured like above.`
> item 4: *"Its okay we only can sort one field (no multiple sort like Order Count + Profit)"*.

**The verdict.** A table is sorted by **one** field of **one** metric — `MetricSort` is a single message, never a list.
*Order Count, then Profit* is not offered. The key tie-breaker
([the-key-breaks-every-tie](#the-key-breaks-every-tie)) is not a second sort: the person never picks it and never sees it.

```mermaid
flowchart LR
  h["the person clicks Order Count"] --> s["MetricSort - metrics/orders/shop, order_count, desc"]
  s --> o["ORDER BY order_count DESC, shop_id DESC"]
  p["then clicks Profit"] -->|"replaces the sort"| s2["MetricSort - the settlement metric, profit, desc"]
```

**The spec.**

| | |
| --- | --- |
| `MetricSearchRequest.sort` | one `MetricSort` — not `repeated` |
| clicking a second column | replaces the sort, never adds to it |
| the service that ranks | the one owning the sorted field — Profit sorted means settlement ranks the shops ([the-rows-are-the-keys-step-one-sends](#the-rows-are-the-keys-step-one-sends)) |
| the tie-breaker | the key, always, unseen — not a sort the person chose |

---

## the-table-picks-one-group

> Owner (2026-10-27), in [rpc_provide.md](./rpc_provide.md) `## Proto Contracts.` — `enum GroupType` and
> `MetricOption.supported_group_by` — and in chat: *"i think it add supported_group_by is better"*; then *"yes
> greyed"* to [Q8](./rpc_provide_clarify.md#question), which asked it of a table grouped by Shop. Reverses my
> one-metric-per-grain.

**The verdict.** A metric is **one measure** — `OrderMetric`: count, total — and declares the groups it can be read
by. The **table** picks one group; every column is read by it, so every column shares the rows. *Daily*, *weekly*,
*shop*, *product* are all values of one `group_by`.

```mermaid
flowchart LR
  g["the table - Group by Shop"] --> o["metrics/orders - supported_group_by - shop, product, daily, weekly"]
  g --> s["metrics/settlement - supported_group_by - shop, daily"]
  o --> r["one row per shop"]
  s --> r
```

**The spec.**

| | |
| --- | --- |
| `GroupType` | `DAILY` · `WEEKLY` · `MONTHLY` · `YEARLY` · `PRODUCT` · `SHOP` · `SUPPLIER` — as the owner's doc |
| `MetricOption` | `supported_filters` · `required_filters` · `supported_group_by` · `metric_id` |
| the request | `GroupType group_by` on both `MetricSearchRequest` and `MetricDataRequest` — the service cannot rank or fill without it |
| a metric id | `metrics/orders` — the group is no longer in it. Supersedes the *last segment is the key* row of [a-metric-id-is-a-name-not-a-route](#a-metric-id-is-a-name-not-a-route); its other rules stand |
| one key per table | [a-metric-has-one-key](#a-metric-has-one-key) holds **per table**: one `group_by`, never shop × day |
| a grain | a `group_by` value — supersedes [superseded-one-metric-per-grain](#superseded-one-metric-per-grain). A week is still Monday–Sunday ([a-week-is-monday-to-sunday-jakarta](#a-week-is-monday-to-sunday-jakarta)) |
| the body's key | proposed, not decided: the body carries no key field (`metric_key` goes); two map wrappers per metric, by id and by day — [group-by-belongs-to-the-table](./rpc_provide_clarify.md#group-by-belongs-to-the-table) |

---

## a-metric-that-cannot-group-is-greyed

> Owner, in chat (2026-10-27): *"yes greyed"* — to [Q8](./rpc_provide_clarify.md#question), *"the table is grouped by
> Shop: is a metric that cannot group by shop hidden, greyed out with its reason, or offered and then the group
> changes?"*. As recommended.

**The verdict.** In the metric picker, a metric whose `supported_group_by` lacks the table's group is **shown,
greyed out, with the reason**. It cannot be picked. The group never changes because a column was added — the rows ARE
the group.

```mermaid
flowchart LR
  t["Group by Shop"] --> p["metric picker"]
  p --> o["Order - pickable"]
  p --> s["Settlement - pickable"]
  p --> i["Inventory - greyed - cannot be grouped by shop"]
  i -.->|"to reach it"| c["the person switches to Group by Product"]
```

**The spec.**

| | |
| --- | --- |
| shown | always — a greyed metric still tells the person it exists |
| the reason | *"Cannot be grouped by shop"* — the table's group, by name |
| picking it | impossible while the group is wrong |
| changing the group | removes the columns whose metric does not support the new group, announced like a removed filter ([a-removed-filter-is-announced](#a-removed-filter-is-announced)) — proposed, not decided |
| unlike a filter | a filter is removed to fit a new metric; a group never is |

---

## the-headline-is-the-metric-grouped-by-summary

> Owner (2026-10-27), in [rpc_provide.md](./rpc_provide.md) — `GROUP_TYPE_SUMMARY` added to `GroupType` — and in
> chat: *"i add GROUP_TYPE_SUMMARY check that"*. To [Q9](./rpc_provide_clarify.md#question), *"is the headline the same
> metric read with no group, instead of its own `OrderSummaryMetric`?"*. As recommended, under the owner's name
> `SUMMARY` for my `NONE`. Supersedes [superseded-a-headline-is-its-own-summary-metric](#superseded-a-headline-is-its-own-summary-metric).

**The verdict.** A headline is the **same metric** read with `group_by = GROUP_TYPE_SUMMARY`: one row for everything
the filters cover. There is no `OrderSummaryMetric`. One metric, one report table, one query shape — so
[the-headline-is-the-sum-of-its-rows](#the-headline-is-the-sum-of-its-rows) holds **by construction**.

```mermaid
flowchart LR
  m["metrics/orders"] -->|"group_by SHOP"| t["the table - Toko Maryam 12, Toko Baru Segu 10 ..."]
  m -->|"group_by SUMMARY"| h["the headline - Orders 1.240"]
  t -.->|"same metric, same table - always equal"| h
```

**The spec.**

| | |
| --- | --- |
| `GroupType` | `SUMMARY` · `DAILY` · `WEEKLY` · `MONTHLY` · `YEARLY` · `PRODUCT` · `SHOP` · `SUPPLIER` |
| how it is read | `MetricData` with `group_by = SUMMARY`, the table's filters, **no keys** — never a `MetricSearch` |
| its answer | one body message, not a map |
| `GROUP_TYPE_UNSPECIFIED` | refused — a request that forgets the field gets an error, never a silent total |
| which metrics have a headline | those listing `SUMMARY` in `supported_group_by` — proposed, not decided: every metric lists it, since anything that can be grouped can be summed |
| the shipped `total` fields | become `group_by = SUMMARY` when each service moves ([the-pattern-replaces-the-shipped-analytics](#the-pattern-replaces-the-shipped-analytics)) |
| [the-headline-is-the-sum-of-its-rows](#the-headline-is-the-sum-of-its-rows) | still the rule; its *"a unit test of every pair"* now tests one metric read two ways |

---

## the-key-lives-in-the-map

> Owner, in chat (2026-10-27): *"yes"*, then *"yes"* to the confirmation — to the critique
> [group-by-belongs-to-the-table](./rpc_provide_clarify.md#critique), *"three typed cases per metric, or one
> string-keyed map?"*. As recommended: three typed cases.

**The verdict.** A metric's body carries **no key** — one `OrderMetric` is read by shop, by day or as a summary, so the
key cannot live inside it. The key lives in the **map** that holds the bodies. Each metric has three `oneof` cases in
`MetricData`: by id, by day, and the summary body. The `metric_key` field option is removed.

```mermaid
flowchart LR
  b["OrderMetric - order_count, order_total - no key"] --> i["OrderMetricByID - map uint64 to OrderMetric - SHOP, PRODUCT, SUPPLIER"]
  b --> d["OrderMetricByDay - map string to OrderMetric - DAILY to YEARLY"]
  b --> s["order_summary - one OrderMetric - SUMMARY"]
```

**The spec.**

```proto
message OrderMetric {                                   // the body — no key field
    int64  order_count = 1 [(metric_sort) = { can_sort: true }];
    double order_total = 2 [(metric_sort) = { can_sort: true }];
}
message OrderMetricByID  { map<uint64, OrderMetric> items = 1; }   // SHOP · PRODUCT · SUPPLIER
message OrderMetricByDay { map<string, OrderMetric> items = 1; }   // DAILY · WEEKLY · MONTHLY · YEARLY — "2026-10-01"

message MetricData {
    oneof m {
        OrderMetricByID  order_by_id   = 1;
        OrderMetricByDay order_by_day  = 2;
        OrderMetric      order_summary = 3;             // SUMMARY
        // … the same three for every metric the service owns
    }
}
```

| | |
| --- | --- |
| `metric_key` field option | removed — nothing left to mark |
| why two map wrappers | a proto `map` cannot sit directly in a `oneof` |
| why not one string-keyed map | ids would travel as text, and every reader would parse them back |
| a group's case | `SHOP` / `PRODUCT` / `SUPPLIER` → `_by_id`; `DAILY` … `YEARLY` → `_by_day`; `SUMMARY` → `_summary` |
| the keys sent | follow the same split — an id list or a day list, none for `SUMMARY` |

---

## the-group-enum-grows-with-the-reports

> Owner (2026-10-27), in [rpc_provide.md](./rpc_provide.md) — `GROUP_TYPE_TEAM` and `GROUP_TYPE_USER` added to
> `GroupType` — and in chat: *"check again in proto contract"*. To [Q10](./rpc_provide_clarify.md#question), *"does
> `GroupType` grow with the groups the reports need — `TEAM` and `USER` now, financial account's when it moves?"*. As
> recommended.

**The verdict.** `GroupType` is one shared enum that **grows** with the groups the reports need, like `FilterType`.
`TEAM` and `USER` join now — your `## General.` lists them, and settlement groups by both. Financial account's
`ACCOUNT`, `PROVIDER` and `CHANGE_TYPE` join the day it moves. Every group keys by a number, so `IDList` carries them
all — a change type by its enum value.

```mermaid
flowchart LR
  e["GroupType"] --> now["now - SUMMARY, DAILY ... YEARLY, PRODUCT, SHOP, SUPPLIER, TEAM, USER"]
  e -.->|"when financial account moves"| later["ACCOUNT, PROVIDER, CHANGE_TYPE"]
  now --> s["settlement can move - team, shop, user"]
```

**The spec.**

| | |
| --- | --- |
| `GroupType` now | `SUMMARY` · `DAILY` · `WEEKLY` · `MONTHLY` · `YEARLY` · `PRODUCT` · `SHOP` · `SUPPLIER` · `TEAM` · `USER` |
| a new group | added to `analytic_base` in the change that first needs it — never a service-local group enum |
| the key | a number in `IDList` for every non-time group — an id, or an enum value |
| `TEAM` across teams | only for a caller scoped to the **root** team; any other scope yields its own team alone — carried over from settlement's shipped rule |
| `USER` | the user the fact is booked to — each metric's doc says which user that is |

---

## every-metric-has-a-summary

> Owner, in chat (2026-10-27): *"okay, go ahead"* — to proposal **c** in [rpc_provide_clarify.md](./rpc_provide_clarify.md#question),
> *"every metric lists `SUMMARY`, checked at startup?"*. As recommended. The proposed row of
> [the-headline-is-the-metric-grouped-by-summary](#the-headline-is-the-metric-grouped-by-summary) is no longer
> *proposed*: it is this entry.

**The verdict.** Every metric lists `GROUP_TYPE_SUMMARY` in `supported_group_by`, so every table can show a headline.
The server **refuses to start** on a metric without it. A rate is never summed — its summary is computed from the same
sums its rows use.

```mermaid
flowchart LR
  m["a metric's supported_group_by"] --> c{"lists SUMMARY"}
  c -->|"yes"| ok["boots - every table has a headline"]
  c -->|"no"| no["refuses to start - names the metric"]
```

**The spec.**

| | |
| --- | --- |
| `supported_group_by` | always contains `GROUP_TYPE_SUMMARY` |
| the check | at startup, beside the `metric_id` uniqueness check ([a-metric-id-is-a-name-not-a-route](#a-metric-id-is-a-name-not-a-route)) |
| a count or an amount | its summary is the sum over every row the filters cover |
| a rate | computed from the summed parts — total broken ÷ total units — never the average of the rows' rates |

---

## screen-details-wait-for-the-screen

> Owner, in chat (2026-10-27): *"okay, go ahead"* — to *"defer a, b and d to the screen pass"*. As recommended.

**The verdict.** Three proposals are display behaviour, not contract, and are decided **with the screen in front of
the owner** — in Storybook, at the screen pass — not from text. ⏸ Deferred, not dropped: the screen pass builds a story
for each, so the choice is made by clicking, not imagining.

```mermaid
flowchart LR
  p["a, b, d - display only"] --> s["screen pass - Storybook"]
  s --> st["a story per case - with and without"]
  st --> d["the owner decides by clicking"]
```

**The spec.**

| | deferred | the stories the screen pass builds |
| --- | --- | --- |
| a | a line above the table — *"Rows: shops with orders"* — when the sort moves to another service's field | sorted by Order Count · sorted by Profit · sorted by Profit with the line |
| b | changing the group removes the columns that cannot follow, with a toast | Group by Shop with Inventory greyed · switch to Product |
| d | a chart with one line per shop is capped at 5 lines | the top shops' daily chart at 3, 5 and 10 lines |
| the contract | unchanged either way — nothing here touches the proto | |

---

## the-analytic-screen-is-accepted

> Owner, in chat (2026-10-27): *"Accept all as recommended"* — to *"accept (with a, b, d as recommended), or tell me
> what's wrong with the screen?"*. It is the lifecycle's design_accept
> ([design-accept-blocks](../../development_lifecycle_decision.md#design-accept-blocks)).

**The verdict.** The Storybook prototype is the design: `Pages/Analytic/Composer` as it stands on branch
`backup/inventory` on 2026-10-27, on the contract decided above. The three deferred screen details
([screen-details-wait-for-the-screen](#screen-details-wait-for-the-screen)) close with it, each as recommended:
[the-rows-line-says-what-the-rows-are](#the-rows-line-says-what-the-rows-are),
[a-group-change-drops-the-columns-that-cannot-follow](#a-group-change-drops-the-columns-that-cannot-follow),
[the-chart-waits-for-a-chart-component](#the-chart-waits-for-a-chart-component).

```mermaid
flowchart LR
  P["prototype - Pages/Analytic/Composer"] -->|"design_accept, 2026-10-27"| B["backend analysis"]
  B --> O["proto analytic_base/v1 and the startup checks"]
  O --> S["supplier first - then settlement, then financial account"]
  S --> R["route and menu entry - with the first real metric"]
```

**The spec.**

| | |
| --- | --- |
| accepted | `frontend/src/pages/analytic/`, `frontend/src/features/analytic/`, and the contract in this file |
| not accepted, still open | the category order in Add Metric — see [rpc_provide_clarify.md](./rpc_provide_clarify.md#question) |
| the pending marks | `figures`, `catalogue`, `pickers` — each is removed by the backend step that serves it for real |
| a contract change after this | a new pass through the screen, not a quiet edit |
| next | backend analysis, in the order of [the-pattern-replaces-the-shipped-analytics](#the-pattern-replaces-the-shipped-analytics) |

---

## the-rows-line-says-what-the-rows-are

> Owner, in chat (2026-10-27): *"Accept all as recommended"* — to deferred detail **a**. As recommended.

**The verdict.** Whenever a figure ranks the rows, a muted line above the table says what the rows are —
*"Rows: shops with orders in this period"*. Sorting by Profit hands the ranking to settlement, so a shop with orders and
no settlement leaves the table; without the line that reads as a shop lost.

```mermaid
flowchart LR
  s1["sort by Order Count"] --> l1["Rows: shops with orders in this period"]
  s2["sort by Profit"] --> l2["Rows: shops with settlement in this period"]
  s3["a time group sorted by period"] --> l3["no line - the rows are the days"]
```

**The spec.**

| | |
| --- | --- |
| shown | whenever the rows are ranked by a metric's field — the metric named is the one whose service ranks |
| not shown | the rows sorted by their key — a time group by its period, where the provider lists the days itself and no service ranks |
| built | `AnalyticPage` — the `rowsLine` prop is gone; story `SortedByProfit` pins both texts |

---

## a-group-change-drops-the-columns-that-cannot-follow

> Owner, in chat (2026-10-27): *"Accept all as recommended"* — to deferred detail **b**. As recommended.

**The verdict.** Changing the table's group removes every metric that cannot be grouped by the new one, and an info
toast names what went and why. The rows ARE the group, so the metrics give way, never the group — the same rule as a
filter an added metric cannot use ([a-new-metric-removes-the-filters-it-cannot-use](#a-new-metric-removes-the-filters-it-cannot-use),
[a-removed-filter-is-announced](#a-removed-filter-is-announced)).

```mermaid
flowchart LR
  g["group Product - Orders, Stock lost"] -->|"switch to Shop"| c{"each metric lists SHOP"}
  c -->|"Orders - yes"| k["kept"]
  c -->|"Stock lost - no"| d["removed"]
  d --> t["toast - Stock lost removed, cannot be grouped by shops"]
```

**The spec.**

| | |
| --- | --- |
| removed | every chosen metric whose `supported_group_by` lacks the new group |
| the sort | kept if its metric survives; otherwise it falls back to the group's default |
| the toast | `info`, the removed metrics named, the reason the new group |
| built | `AnalyticPage.setGroup`; stories `InventoryGreyedByShop`, `SwitchGroupToProduct` |

---

## the-chart-waits-for-a-chart-component

> Owner, in chat (2026-10-27): *"Accept all as recommended"* — to deferred detail **d**. As recommended.

**The verdict.** The screen is accepted **without** a chart. A chart is its own pass, and it starts with a chart
component in the design system (`components/`), which the app does not have. The 5-line cap is decided there, with the
chart on screen. Nothing in the contract changes either way.

```mermaid
flowchart LR
  a["screen accepted - no chart"] --> c["chart pass - a chart component in components/"]
  c --> st["stories at 3, 5 and 10 lines"]
  st --> cap["the owner decides the cap"]
```

**The spec.**

| | |
| --- | --- |
| now | no chart on `Pages/Analytic/Composer`; the table and the headline carry the report |
| the chart pass | a chart component with its story first, then the per-shop daily chart, then the cap |
| the contract | unchanged — a chart reads the same `MetricData` the table does |

---

## order-opens-the-metric-picker-for-now

> Owner, in chat (2026-10-27): *"for q 11 for now yes"* — to [Q11](./rpc_provide_clarify.md#question), *"keep Order
> first, or your doc's order?"*. As recommended, and marked *for now* by the owner.

**The verdict.** For now, Add Metric lists its categories *Order, Settlement, Inventory, Ads, Expense*, and opens on
**Order** — the figure every team reads daily. Your §How Metric Selected lists them *Expense* first; that list names
the categories, and the picker's order is this entry. *For now*: revisit when real metrics arrive and it is clear which
category people open most.

```mermaid
flowchart LR
  a["Add Metric"] --> o["opens on Order"]
  o --> l["Order · Settlement · Inventory · Ads · Expense"]
```

**The spec.**

| | |
| --- | --- |
| the order | `METRIC_CATEGORIES` in `frontend/src/features/analytic/catalogue.ts` — unchanged |
| opens on | the first category, Order |
| revisit | when real metrics are wired, by which category is opened most |

---

## a-filter-names-one-id-and-shares-its-types-number

> Owner, in chat (2026-10-27): *"Continue"* — to *"are you OK with the two filter details, and shall I go on to
> supplier?"*, after backend step 1 filled in what the doc left open. As recommended.

**The verdict.** Each filter carries **one** id, because the accepted screen narrows by one shop, one product, one
supplier. Each `FilterItem` case is numbered as its `FilterType`, so a filter maps to its type with no table.

```mermaid
flowchart LR
  t["FILTER_TYPE_SHOP = 5"] --- c["FilterItem.shop_filter = 5"]
  c --> s["ShopFilter - shop_id, one id"]
```

**The spec.**

| | |
| --- | --- |
| the filters | `DateRangeFilter{date_min, date_max}`, `KeywordFilter{keyword}`, `ProductFilter{product_id}`, `TeamFilter{team_id}`, `ShopFilter{shop_id}`, `SupplierFilter{supplier_id}` |
| the numbering | `FilterItem` case N is `FilterType` N — date range 1 … supplier 6; a new type takes the next number in both |
| limits | a page 1–200, a key list at most 200, a keyword 1–100 characters |
| multi-select later | a new `repeated` field beside the single id — the single id is never reused |
| where | [proto/warehouse/analytic_base/v1/analytic.proto](../../../proto/warehouse/analytic_base/v1/analytic.proto) |

---

## the-generic-keyword-is-removed

> Owner (2026-10-27), in [rpc_provide.md](./rpc_provide.md) — `FILTER_TYPE_KEYWORD` removed from `FilterType` — and in
> chat: *"i remove FILTER_TYPE_KEYWORD"*. To [what-a-keyword-matches](./rpc_provide_clarify.md#question), *"a keyword
> names its dimension (A), matches the rows (B), or no keyword (C)?"* — C, against my A.

**The verdict.** No filter type is a bare keyword. A filter means one thing in every column; a keyword meant whatever
each metric chose, so two columns of one row could be narrowed by different things behind one box.

```mermaid
flowchart LR
  k["FILTER_TYPE_KEYWORD"] -->|"removed"| f["FilterType - date range, product, team, shop, supplier"]
  f --> one["one filter, one meaning in every column"]
```

**The spec.**

| | |
| --- | --- |
| `FilterType` | `UNSPECIFIED` · `DATE_RANGE` · `PRODUCT` · `TEAM` · `SHOP` · `SUPPLIER` |
| the number 2 | reserved in `FilterType` and in `FilterItem`, so case N stays `FilterType` N ([a-filter-names-one-id-and-shares-its-types-number](#a-filter-names-one-id-and-shares-its-types-number)) |
| the code it removes | `KeywordFilter` in `analytic_base`; `FILTER_TYPE_KEYWORD` on `metrics/suppliers`, its keyword join and their tests |
| ⚠ still open | the Supplier Report's search is sent as that keyword — [the-supplier-search-loses-its-filter](./rpc_provide_clarify.md#the-supplier-search-loses-its-filter). The code waits for it |

---

## the-supplier-report-drops-its-search

> Owner, in chat (2026-10-28): *"b"* — to [the-supplier-search-loses-its-filter](./rpc_provide_clarify.md#question),
> *"keep the Supplier Report's search as `FILTER_TYPE_SUPPLIER_KEYWORD` (A), or let the search go (B)?"* — B, against
> my A.

**The verdict.** The Supplier Report has no search. It ranks every supplier in the window, narrowed only by whose
restocks; one supplier's figures are its Statistics tab, a click from its row. Supersedes
[the-supplier-report-searches-like-discover](../supplier/context_decision.md#superseded-the-supplier-report-searches-like-discover).

```mermaid
flowchart LR
  r["Supplier Report"] --> f["the window, whose restocks"]
  f --> k["the ranking and the headline - every supplier"]
  k -->|"a row"| s["that supplier's Statistics tab"]
```

**The spec.**

| | |
| --- | --- |
| `metrics/suppliers` filters | `DATE_RANGE` (required) · `TEAM` · `SUPPLIER` |
| the headline | every supplier in the window, or one team's restocks — no longer *"what the search found"* |
| a one-supplier picker | not added — a ranking narrowed to one supplier is one row, which the Statistics tab already shows. ⚠ My reading of B, not asked |
| removed | the search box and its two texts, the story `TheSearchNarrowsTheRankingAndTheHeadline`, the keyword join in `metric_shared.go` and its tests |
| kept | `SupplierList`'s `q` — Discover's search is its own request field, not this filter |

---

## the-filters-gain-warehouse-and-user

> Owner, in chat (2026-10-28): *"continue"* — to [the-tree-names-filters-the-enum-lacks](./rpc_provide_clarify.md#question), *"add
> `FILTER_TYPE_WAREHOUSE` (its own type, not `TEAM`) and `FILTER_TYPE_USER` — should I go with that?"*. Read as yes;
> as recommended.

**The verdict.** `FilterType` gains `WAREHOUSE` and `USER`, each one id. A warehouse is a team in this system, but a
warehouse fee has **both** a selling team and a warehouse, so `TEAM` cannot carry both.

```mermaid
flowchart LR
  fee["a warehouse fee"] --> t["TEAM - whose figures"]
  fee --> w["WAREHOUSE - the warehouse team it happened in"]
  fee --> u["USER - who it is booked to"]
```

**The spec.**

| | |
| --- | --- |
| `FilterType` | + `FILTER_TYPE_WAREHOUSE = 7` · `FILTER_TYPE_USER = 8` |
| `FilterItem` | `WarehouseFilter{warehouse_id}` = 7 · `UserFilter{user_id}` = 8 — one id each, the case number its type's ([a-filter-names-one-id-and-shares-its-types-number](#a-filter-names-one-id-and-shares-its-types-number)) |
| `TEAM` and `WAREHOUSE` | both team ids, two roles: `TEAM` stays whose figures they are, `WAREHOUSE` is the warehouse team the fact happened in. A metric with both roles lists both |
| `USER` | the user the fact is booked to — each metric's doc says which, as for `GROUP_TYPE_USER` ([the-group-enum-grows-with-the-reports](#the-group-enum-grows-with-the-reports)) |
| when | added to `analytic_base` with the first metric that lists one (Warehouse Fee or Order Created), not before, the same as a group |
| your doc | `FilterType` gains the two lines — yours to write |

---

## a-field-declares-its-stat-type

> Owner (2026-10-28), in [rpc_provide.md](./rpc_provide.md) — `enum FieldStatType` and a `field_stat_type` field option
> beside `metric_sort`.

**The verdict.** A metric's number field says what kind of number it is (a quantity, a currency amount or a ratio), on
the field itself, read by reflection like `metric_sort`.

```mermaid
flowchart LR
  f["a metric's number field"] --> q["QTY - order_count, transaction_count"]
  f --> c["CURRENCY - order_total, amount"]
  f --> r["RATIO - broken_rate"]
```

**The spec.**

```proto
enum FieldStatType {
  FIELD_STAT_TYPE_UNSPECIFIED = 0;
  FIELD_STAT_TYPE_RATIO = 1;
  FIELD_STAT_TYPE_QTY = 2;
  FIELD_STAT_TYPE_CURRENCY = 3;
}

extend google.protobuf.FieldOptions {
  SortOption    metric_sort     = 50003;
  FieldStatType field_stat_type = 50004;   // 50002 is role_base's use_scope
}
```

| | |
| --- | --- |
| replaces | the screen's own `kind: "count" \| "money"` in `features/analytic/catalogue.ts` — that copy goes when the provider reads the descriptor |
| open | whether every field must carry it, and what checks it — [a-stat-type-is-checked-at-startup](./rpc_provide_clarify.md#a-stat-type-is-checked-at-startup) |

---

## the-graph-draws-the-table

> Owner (2026-10-28), in [rpc_provide.md](./rpc_provide.md) §Analytic UI — *"graph is separate by `FieldStatType`"* — and
> in chat: *"for graph is line chart. x is the value metric, and y is grouped things. and same field type is one graph
> with column is the legend"*. To [what-the-graph-draws](./rpc_provide_clarify.md#question), *"does the graph draw the
> table (A), or is it composed on its own (B)?"*, that is A, as recommended. On which way it is drawn, *"A"*: the group
> along the bottom, against the literal reading of *"x is the value"*.

**The verdict.** The graph is the table drawn as **line charts**: the table's group along the bottom, the value up the
side, **one graph per `FieldStatType`** among the chosen fields, and each of the table's columns a line, named in the
legend. Two metrics' money fields share one graph, and that shared graph is where they get compared.

```mermaid
flowchart LR
  t["the table - group Daily - Orders and Settlement chosen"] --> f["its columns"]
  f -->|"CURRENCY"| c["graph - Order Total, Settlement Amount"]
  f -->|"QTY"| q["graph - Order Count"]
  f -->|"RATIO - none chosen"| n["no graph"]
  c --> l["a line per column - the days along the bottom, Rp up the side"]
```

**The spec.**

| | |
| --- | --- |
| the kind | a line chart, for every group. ⚠ Against my bars for a shop or product group (a line there joins shops with nothing between them, so its slope only shows the sort order). Raised twice, answered with *"line chart"* |
| along the bottom | the table's keys, in the table's order: the days of a time group, or the current page's rows for an id group |
| up the side | the value, formatted by the graph's `FieldStatType` (*Rp*, a count, a %) |
| a graph | one per `FieldStatType` among the chosen fields, so at most three, in column order |
| a line | one per column, named in the legend as the column is |
| the calls, the state | none of its own: it draws the `MetricData` the table already holds, from the same URL ([the-report-lives-in-the-url](#the-report-lives-in-the-url)). ⚠ My reading of A, not asked |
| `SUMMARY` | no graph, because the headline already shows it. ⚠ My reading of A, not asked |
| not this graph | one line per shop over the days ([a-metric-has-one-key](#a-metric-has-one-key)), a line per key rather than per column. It is a different chart |
| when | the chart pass ([the-chart-waits-for-a-chart-component](#the-chart-waits-for-a-chart-component)), which still starts with a chart component. The cap on lines per graph is decided there |
| depends on | every number field carrying its stat type, since a field without one has no graph to go into ([a-stat-type-is-checked-at-startup](./rpc_provide_clarify.md#a-stat-type-is-checked-at-startup)) |

---

## the-table-and-the-graph-are-tabs

> Owner, in chat (2026-10-28): *"make tab table and graph. so its not one view"*, on seeing the graph built above the
> table.

**The verdict.** The report shows **one view at a time**: a **Table** tab and a **Graph** tab under the headline. The
graph is still the table drawn ([the-graph-draws-the-table](#the-graph-draws-the-table)). It just has its own tab now
instead of sitting above the table.

```mermaid
flowchart LR
  h["the headline - every figure, group SUMMARY"] --> t{"the tab"}
  t -->|"Table - the default"| tb["the rows line, the table, the pager"]
  t -->|"Graph"| gr["the rows line, a graph per stat type, the pager"]
```

**The spec.**

| | |
| --- | --- |
| the tabs | **Table** · **Graph**, each with its icon, the chosen one in rose ([a-selected-tab-is-in-the-main-tone](../../technical/frontend/context_decision.md#a-selected-tab-is-in-the-main-tone)) |
| the default | Table. ⚠ My reading, not asked |
| in the URL | `v=graph`, so a link or a refresh opens the same view ([the-report-lives-in-the-url](#the-report-lives-in-the-url)); Table is the default and is left out. ⚠ My reading, not asked |
| above both | the group, the metrics, the filters and the headline: they define the report, whichever way it is drawn |
| on both | the rows line and the pager, because the graph draws the table's current page. ⚠ My reading, not asked |
| switching | keeps the page, the sort and the filters, and only changes how the rows are drawn |
| no rows | the same *nothing in this period* line on both tabs |

---

## the-team-group-covers-warehouses

> Owner, in chat (2026-10-28): *"no group team is enough"*, to
> [a-report-can-group-by-warehouse](./rpc_provide_clarify.md#question), *"should `GroupType` gain
> `GROUP_TYPE_WAREHOUSE = 11`?"*. Against my yes.

**The verdict.** `GroupType` gets no warehouse group. A warehouse is a team in this system, so a report that puts
warehouses side by side groups by `GROUP_TYPE_TEAM`.

```mermaid
flowchart LR
  q["a row per warehouse"] --> t["GROUP_TYPE_TEAM - a warehouse is a team"]
  t -.->|"not added"| w["GROUP_TYPE_WAREHOUSE"]
```

**The spec.**

| | |
| --- | --- |
| `GroupType` | unchanged: `TEAM` = 9 and `USER` = 10 are the last |
| comparing warehouses | group by `TEAM` |
| a fact with two teams | ⚠ My reading, not asked: a warehouse fee has a selling team and a warehouse team. The caller's scope already says whose figures they are, so `TEAM` groups by the other team, which for a seller is the warehouse. Each metric's doc says which team, as it already does for `USER` |
| the filter | unchanged: `FILTER_TYPE_WAREHOUSE` stays its own type ([the-filters-gain-warehouse-and-user](#the-filters-gain-warehouse-and-user)). The tension between the two is in the clarify's Contradiction section |
