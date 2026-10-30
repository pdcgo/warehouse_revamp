# Order Metric That Exists In Analytic.

## General.
1. Its use for metric that explain in [this](../analytic/rpc_provide.md)


## Metric That Must Exists.
1. Order Created

    group by :
    - team
    - shop
    - warehouse
    - user
    - daily
    - weekly
    - monthly
    - yearly

    fiter :
    - team
    - shop
    - warehouse
    - user
    - date range
    
    fields :
    - created_count
    - created_total
    - mp_total

2. Order Cancel

    group by :
    - team
    - shop
    - warehouse
    - user
    - daily
    - weekly
    - monthly
    - yearly

    fiter :
    - team
    - shop
    - warehouse
    - user
    - date range

    fields :
    - cancel_count
    - cancel_total
    - mp_total

3. Order Return Created

    group by :
    - team
    - shop
    - warehouse
    - user
    - daily
    - weekly
    - monthly
    - yearly

    fiter :
    - team
    - shop
    - warehouse
    - user
    - date range

    fields :
    - return_created_count
    - return_created_total
    - return_created_mp_total

4. Order Return Arrived

    group by :
    - team
    - shop
    - warehouse
    - user
    - daily
    - weekly
    - monthly
    - yearly

    fiter :
    - team
    - shop
    - warehouse
    - user
    - date range

    fields :
    - return_arrived_count
    - return_arrived_total
    - return_arrived_mp_total

5. Order Lost Created

    group by :
    - team
    - shop
    - warehouse
    - user
    - daily
    - weekly
    - monthly
    - yearly

    fiter :
    - team
    - shop
    - warehouse
    - user
    - date range

    fields :
    - lost_created_count
    - lost_created_total
    - lost_created_mp_total




