# Settlement Analytical Reports Design.
we serve analitical report of settlements.

## What rpc that Settlement Service Must be Exposed.
### Rpc for Manage Streaming Report.
1. `AnalyticReplayCompute`, When error happen and root need to recompute.
3. `AnalyticMaintenanceRun`, run data maintenance. its used in [maintain table](#idempotency-layer)

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
2. update `day` row and return the id.
    ```sql
    update shop_settlement_daily_reports d
    set 
        d.fund += @fund_change,
        d.close_balance = (
            d.fund +
            d.initial_total +
            d.initial_total_cancel +
            d.other +
            d.fund +
            d.external_ads_fee +
            d.affiliate_fee +
            d.marketplace_adjustment +
            
            @fund_change
        ),
        d.last_updated = now()


    where 
        d.day = @day
        and d.shop_id = @shop_id
        and d.team_id = @team_id
    ```
3. when in step 2 returning row is 0, its mean there is no row `day` exists, so we create it.
    ```sql
    with prev as (
        select d.close_balance
        from shop_settlement_daily_reports d
        where
            d.shop_id = @shop_id
            and d.team_id = @team_id
        order by d.day desc
        limit 1
    )
    insert into shop_settlement_daily_reports (day, shop_id, team_id, fund, open_balance, close_balance)
    values (
        @day, 
        @shop_id, 
        @team_id, 
        @fund,
        coalesce(prev.close_balance, 0),
        coalesce(prev.close_balance, 0) + @fund
    )

    RETURNING id;
    ```
4. for consistency if event late.
    ```sql
    update shop_settlement_daily_reports d
    set 
        d.close_balance = (
            d.fund +
            d.initial_total +
            d.initial_total_cancel +
            d.other +
            d.fund +
            d.external_ads_fee +
            d.affiliate_fee +
            d.marketplace_adjustment +
            @fund_change
        ),

        d.open_balance = (
            d.fund +
            d.initial_total +
            d.initial_total_cancel +
            d.other +
            d.fund +
            d.external_ads_fee +
            d.affiliate_fee +
            d.marketplace_adjustment +
            @fund_change
        ),
        d.last_updated = now()


    where 
        d.day > @day
        and d.shop_id = @shop_id
        and d.team_id = @team_id

    ```
5. For other type like `initial_total`, `initial_total_cancel` and other is same. And for `user_settlement_daily_reports` is same too.


## Smallest Grain Reports.
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

    field that tracked:
    - `initial_total`
    - `initial_total_cancel`
    - `other`
    - `fund`
    - `external_ads_fee`
    - `affiliate_fee`
    - `marketplace_adjustment`
    - `open_balance`
    - `close_balance`

1. `user_settlement_daily_reports`
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

    field that tracked:
    - `initial_total`
    - `initial_total_cancel`
    - `other`
    - `fund`
    - `external_ads_fee`
    - `affiliate_fee`
    - `marketplace_adjustment`
    - `open_balance`
    - `close_balance`

## How we do `AnalyticReplayCompute`.
Payload:
- `start_date`, date with GMT+7

Flow:
1. define `start



## [defer development] Shape of Reports.

1. Timeframe Shape.

    its have mode:
    - daily
    - monthly
    - yearly

    its have filter:
    - daterange filter
    - team filter
    - shop filter
    - customer service filter

2. Group by Team Shape.

    its have filter:
    - daterange filter

3. Group by Shop Shape.

    its have filter:
    - daterange filter

4. Group by User Shape.

    its have filter:
    - daterange filter


