# Acceptance — inventory / opname

A **Stock Opname** checks the shelves against the system: the warehouse owner or admin starts a count over all racks, one
team, one product or one rack; the rows it takes are locked — goods do not move on them — until the count is finalized
or cancelled. One count runs per warehouse at a time. Business: [opname.md](../../business/inventory/opname.md) ·
[decisions](../../business/inventory/opname_decision.md) · rules: [guide.md](../guide.md)

## create

The owner or admin plans a count; its rows are taken from what the system records and locked.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="6" valign="top">1</td><td rowspan="6" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to check the shelves against the system<br>(plan: all racks · 3 racks, 1 of them empty · 1 product at 0 in system on its rack)</td><td rowspan="6" valign="top">create opname</td><td>count started, status active</td><td>⬜ untested</td></tr>
<tr><td>every rack listed, the empty one too</td><td>⬜ untested</td></tr>
<tr><td>a row per product on each rack, those at 0 in system included</td><td>⬜ untested</td></tr>
<tr><td>staff see its racks to count</td><td>⬜ untested</td></tr>
<tr><td>a product on a counted rack cannot be ordered, the refusal names the count</td><td>⬜ untested</td></tr>
<tr><td>nothing else can be done to it there: no transfer, move, sample, adjustment, put-away, found report or cancel</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">2</td><td rowspan="2" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to check the shelves against the system<br>(plan: one team · selling team Melati · another team's product on the same rack)</td><td rowspan="2" valign="top">create opname</td><td>only team Melati's products in the rows</td><td>⬜ untested</td></tr>
<tr><td>the other team's product not locked</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to check the shelves against the system<br>(plan: one product · on 2 racks)</td><td rowspan="1" valign="top">create opname</td><td>both racks listed with the product</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to check the shelves against the system<br>(plan: one rack · rack A holds product X · X also on rack B)</td><td rowspan="1" valign="top">create opname</td><td>X counted on rack B too</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to check the shelves against the system<br>(plan: one rack · the rack is empty)</td><td rowspan="1" valign="top">create opname</td><td>cannot start, nothing to count</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to check the shelves against the system<br>(an earlier count in this warehouse not yet finalized or cancelled)</td><td rowspan="1" valign="top">create opname</td><td>cannot start, names the earlier count</td><td>⬜ untested</td></tr>
</table>
