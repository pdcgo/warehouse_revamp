# Stock Context.


## Stock loss.
1. Selling Team bears the loss at receiving.
2. When Stocks already in Warehouse, and loss/opname happen, its shortfall a warehouse liability.

## How Warehouse Team Member Accept Stock / Return That Arrived
```mermaid
flowchart TD

s["Start"]
recv("Receiving Restock/Return")
check{"Check on System"}
e["End"]

s-->recv
recv-->check

check-->|found|accept("Accept Restock")
check-->|not found|report["Report Manually (Outside System)"]
accept-->fee{"Have Additional Fee"}
    fee-->|no|calcp("Calculate Unit Price")
        calcp-->checkqty{"Is Any Lost"}
    fee-->|yes|feeinp("Input Fee")
        feeinp-->calcp

checkqty-->|no|checkbroken{"Is Any Broken"}
checkqty-->|yes|lost("Input Losts")


checkbroken-->|yes|broken("Input Broken")

checkbroken-->|no|calc("Calculate valid Qty")

lost-->calc
broken-->calc
calc-->place("Set Placements")

place-->e
report-->e


```
