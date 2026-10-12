# Settlement Analytical Reports Design.
we serve analitical report of settlements.

## What rpc that Settlement Service Must be Exposed.
### Rpc for Manage Streaming Report.
1. `AnalyticReplayCompute`, When error happen and root need to recompute.
2. `AnalyticMaintenanceRun`, run data maintenance. its used in [maintain table](#idempotency-layer)

### Webhook.
Webhook is used by `Messsage Broker` to trigger event. And further to calculate Analytical Reports.
1. webhook path is `/event/[sub_id]/push`

## How We Calculate the Analytical Reports.
1. General Flow Overview.
```mermaid
stateDiagram-v2
direction LR

state "Ledger Updated" as ledger_update
state "Event" as event
state "Message Broker" as msg
state "Service Webhook" as hook

[*]-->ledger_update
ledger_update-->event
event-->msg: dispatch
msg-->hook: http push
hook-->[*]

```
### Events.
Event contain:
1. changes of the ledger. its contain new row inserted at `settlement_logs` when change happen.
2. `shop_id`
3. `team_id`
4. `order_created_by_user_id`

## How We Compute inside Hooks.
### We Must Aware Of this
1. **event can be late**.

### Idempotency Layer.
Settlement service have table `settlement_event_logs`.

`settlement_event_logs` have field :
- `id` string, its primary key, its message id from message broker.
- `raw` bytes, content of event.
- `created_at` timestampz, timestamp when event received.

How we check idempotency event.
1. insert to `settlement_event_logs`. 
2. when it fails its mean event already processed.

Table `settlement_event_logs` can be very large. for maintain performance we delete row that have `created_at` older that 1 month.
Its called on `AnalyticMaintenanceRun`




### Flow
```mermaid
flowchart TD
s(("Start"))
e(("End"))

s-->triggered["Event send by triggered hook"]
triggered-->lock_check{"Check Lock on `process_event_lock`"}
lock_check-->|locked|locked_err[/"return 500 error with event process locked"/]
    locked_err-->e

lock_check-->|not locked|check_idempotency{"Check Idempotency"}

check_idempotency-->|duplicate|success[/"http 200 ok"/]
    
check_idempotency-->|not duplicate|compute["Compute The Event"]
compute-->success
success-->e

```

How we computed balance when event arrived. We use `fund` for example.
1. extract `created_at` from `settlement_logs`. convert to GMT+7 and get the date as `day`.

2. the day's own row — one atomic statement, no branch, no race

    ```sql
    INSERT INTO shop_settlement_daily_reports AS d
        (day, shop_id, team_id, fund, change, open_balance, close_balance, last_updated)
    VALUES (@day, @shop_id, @team_id, @change, @change,
            COALESCE((SELECT close_balance FROM shop_settlement_daily_reports
                    WHERE shop_id = @shop_id AND team_id = @team_id AND day < @day
                    ORDER BY day DESC LIMIT 1), 0),
            COALESCE((SELECT close_balance FROM shop_settlement_daily_reports
                    WHERE shop_id = @shop_id AND team_id = @team_id AND day < @day
                    ORDER BY day DESC LIMIT 1), 0) + @change,
            now())
    ON CONFLICT (day, shop_id, team_id) DO UPDATE
    SET fund          = d.fund          + @change,
        change        = d.change        + @change,
        close_balance = d.close_balance + @change,
        last_updated  = now();
    ```

3. every later day — a SHIFT, never a recomputation

    ```sql
    UPDATE shop_settlement_daily_reports
    SET open_balance  = open_balance  + @change,
        close_balance = close_balance + @change,
        last_updated  = now()
    WHERE shop_id = @shop_id AND team_id = @team_id AND day > @day;
    ```
4. update `shop_settlement_reports` with latest from daily reports.
5. For other type like `initial_total`, `initial_total_cancel` and other is same. And for `user_settlement_daily_reports` is same too.



## How `AnalyticReplayCompute` works.
```mermaid
flowchart TD
s(("Start"))
e(("End"))

s-->lock["lock `process_event_lock`"]

lock-->delete_rep["delete *_settlement_daily_reports row"]
delete_rep-->delete_idem["delete `settlement_event_logs` > date"]
delete_idem-->replay["replay event in message broker at date"]
replay-->unlock["unlock `process_event_lock`"]

unlock-->e
```


## Smallest Grain Reports.
### Daily Reports.
1. `shop_settlement_daily_reports`

    field must exists.
    - `id`, for primary key
    - `day`
    - `shop_id`
    - `team_id`
    - `last_updated`

    field that must indexed:
    - `day`
    - `shop_id`
    - `team_id`
    and its composite unique index.

    there is composite unique.
    - `day`
    - `shop_id`
    - `team_id`

    field that tracked read [this](#field-that-tracked)

2. `user_settlement_daily_reports`
    the user is **who created the order**
    
    field must exists.
    - `id`, for primary key
    - `day`
    - `user_id`
    - `team_id`
    - `last_updated`

    field that must indexed:
    - `day`
    - `user_id`
    - `team_id`
    and its composite unique index.

    there is composite unique.
    - `day`
    - `user_id`
    - `team_id`

    field that tracked read [this](#field-that-tracked)

### Field that tracked.
- `initial_total`
- `initial_total_cancel`
- `other`
- `fund`
- `external_ads_fee`
- `affiliate_fee`
- `marketplace_adjustment`
- `system_adjustment`, its used for repair report in our internal system.
- `open_balance`
- `close_balance`

### Balance State Reports.
1. `shop_settlement_reports`

    field must exists.
    - `id`, for primary key
    - `shop_id`
    - `team_id`
    - `last_updated`

    field that must indexed:
    - `shop_id`
    - `team_id`
    and its composite unique index.

    there is composite unique.
    - `shop_id`
    - `team_id`

    field that tracked:
    - `close_balance`

2. `user_settlement_reports`
    the user is **who created the order**
    
    field must exists.
    - `id`, for primary key
    - `user_id`
    - `team_id`
    - `last_updated`

    field that must indexed:
    - `user_id`
    - `team_id`
    and its composite unique index.

    there is composite unique.
    - `user_id`
    - `team_id`

    field that tracked:
    - `close_balance`






## How Rpc Api Deliver Analytical Data.
### How We Handle Timeframe Related Metric
1. `AnalyticTimeSearch`, This rpc for handle:
    - daily
    - monthly
    - yearly

    What requests shape:
    ```proto
    
    enum SortType {
        DESC
        ASC
    }

    enum TimeframeType {
        DAILY
        MONTHLY
        YEARLY
    }

    message DateRangeFilter {
        google.protobuf.Timestamp start_date
        google.protobuf.Timestamp end_date
    }

    message Pagination {
        int64 limit
        int64 offset

    }

    message Filter {
        DateRangeFilter date_range
        uint64          user_id
        uint64          shop_id
        uint64          team_id
    }

    message Request {
        SortType        sort_type
        TimeframeType   timeframe_type
        Filter          filter
        Pagination      pagination
    }

    message TimeframeMetric {
        google.protobuf.Timestamp At
        ... // all field in ### Field that tracked.
    }

    message Response {
        repeated TimeframeMetric datas
    }

    ```
    - `TimeframeMetric` contain [this](#field-that-tracked)




### How We Handle Grouped Metric.

We serve 3 grouped thing with contain [this field](#field-that-tracked):
1. Team Grouped
2. Shop Grouped
3. User Grouped


There is 2 rpc must exists.
1. `AnalyticGroupSearch`
2. `AnalyticGroupMetric`

How Frontend Get Grouped Data.
```mermaid
sequenceDiagram
participant fe as Frontend
box Rpc Api Backend
    participant search as AnalyticGroupSearch
    participant metric as AnalyticGroupMetric
end

fe->>+search: request, send filter, sorting & what grouped
search-->>-fe: return sorted grouped ids
fe->>+metric: send grouped ids
metric-->>-fe: return metric data of ids

```


## How Developer Repairing Analytical Report if error happen.
1. Why 30 days ?, because we use pubsub that limit event can replay is 30 days.
```mermaid
flowchart TD
s(("Start"))
e(("End"))

s-->err["Error Happen"]
err-->isout30{"is out of 30 days ?"}
isout30-->|yes|adj["Create System Adjustment with `system_adjustment`"]
    adj-->event["send to message broker"]
isout30-->|no|replay["run `AnalyticReplayCompute`"]

event-->e
replay-->e
```


