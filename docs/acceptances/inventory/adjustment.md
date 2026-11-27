# Acceptance — inventory / adjustment

**Adjust Stock** corrects one product's stock outside a stock opname, from the warehouse's product page or a batch's
page, by the warehouse owner or admin only. A **recount** sets one rack to the counted figure; **damaged** and **lost**
take units out of a named batch. A shortfall, a damaged and a lost unit are the warehouse's loss: it owes the selling
team for them. A found is not posted here — it is sent for approval ([opname's found](opname.md#found)). Business:
[adjustment_decision.md](../../business/inventory/adjustment_decision.md) ·
[opname decisions](../../business/inventory/opname_decision.md#an-adjustment-writes-the-same-problem-row) · rules:
[guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">1</td><td rowspan="2" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to correct the stock on a rack<br>(rack A · product X 5 in system · counted 5)</td><td rowspan="2" valign="top">adjust recount</td><td>no stock or debt changes</td><td>⬜ untested</td></tr>
<tr><td>last stock-take of product X shows today</td><td>⬜ untested</td></tr>
<tr><td rowspan="5" valign="top">2</td><td rowspan="5" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to correct the stock on a rack<br>(rack A · product X 5 in system · counted 3)</td><td rowspan="5" valign="top">adjust recount</td><td>ready stock of product X on rack A decreases by 2</td><td>⬜ untested</td></tr>
<tr><td>taken from product X's oldest batches first</td><td>⬜ untested</td></tr>
<tr><td>the warehouse owes the selling team for the 2 units</td><td>⬜ untested</td></tr>
<tr><td>stock loss on the warehouse's daily statement</td><td>⬜ untested</td></tr>
<tr><td>recorded in lost stock analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">3</td><td rowspan="3" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to correct the stock on a rack<br>(rack A · product X 5 in system · counted 7)</td><td rowspan="3" valign="top">adjust recount</td><td>ready stock of product X on rack A increases by 2</td><td>⬜ untested</td></tr>
<tr><td>a new batch at product X's newest price here</td><td>⬜ untested</td></tr>
<tr><td>no debt between the warehouse and the selling team changes</td><td>⬜ untested</td></tr>
<tr><td rowspan="5" valign="top">4</td><td rowspan="5" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to correct the stock on a rack<br>(rack A · product X batch #12 · 1 damaged · note)</td><td rowspan="5" valign="top">adjust damaged</td><td>ready stock of product X decreases by 1, from batch #12</td><td>⬜ untested</td></tr>
<tr><td>broken 1 recorded at batch #12's price</td><td>⬜ untested</td></tr>
<tr><td>the warehouse owes the selling team for it</td><td>⬜ untested</td></tr>
<tr><td>stock loss on the warehouse's daily statement</td><td>⬜ untested</td></tr>
<tr><td>recorded in lost stock analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="5" valign="top">5</td><td rowspan="5" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to correct the stock on a rack<br>(rack A · product X batch #12 · 1 lost · note)</td><td rowspan="5" valign="top">adjust lost</td><td>ready stock of product X decreases by 1, from batch #12</td><td>⬜ untested</td></tr>
<tr><td>lost 1 recorded at batch #12's price</td><td>⬜ untested</td></tr>
<tr><td>the warehouse owes the selling team for it</td><td>⬜ untested</td></tr>
<tr><td>stock loss on the warehouse's daily statement</td><td>⬜ untested</td></tr>
<tr><td>recorded in lost stock analytic metric</td><td>⬜ untested</td></tr>
</table>
