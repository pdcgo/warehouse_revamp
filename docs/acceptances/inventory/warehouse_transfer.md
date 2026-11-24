# Acceptance — inventory / warehouse_transfer

A selling team moves its own stock from warehouse A to warehouse B: the team opens the transfer, A processes and ships it,
B signs for the box and counts it in. The units leave A's book at create and are in transit until B accepts; broken,
missing and lost are the team's loss; the shipping cost is the team's expense, and a courier's charge at B's door is the
team's debt to B. Business: [warehouse_transfer.md](../../business/inventory/warehouse_transfer.md) ·
[decisions](../../business/inventory/warehouse_transfer_decision.md) · rules: [guide.md](../guide.md)

## create

The selling team opens a transfer, fills its shipping cost while it can, calls it off or gives the box up.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="6" valign="top">1</td><td rowspan="6" valign="top"><code>selling:all</code> wants to move stock to another warehouse<br>(1 product · warehouse A to warehouse B · no shipping cost)</td><td rowspan="6" valign="top">create transfer</td><td>transfer created, status created</td><td>⬜ untested</td></tr>
<tr><td>ready stock of 1 product at warehouse A decreases</td><td>⬜ untested</td></tr>
<tr><td>in transit on the products page increases</td><td>⬜ untested</td></tr>
<tr><td>outgoing at warehouse A, incoming at warehouse B</td><td>⬜ untested</td></tr>
<tr><td>value worked out from warehouse A's batch prices</td><td>⬜ untested</td></tr>
<tr><td>sent recorded in transfer analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top">2</td><td rowspan="4" valign="top"><code>selling:all</code> wants to move stock to another warehouse<br>(1 product · warehouse A to warehouse B · shipping cost · paid from BCA)</td><td rowspan="4" valign="top">create transfer</td><td>transfer created with shipping cost</td><td>⬜ untested</td></tr>
<tr><td>BCA decreases by shipping cost</td><td>⬜ untested</td></tr>
<tr><td>recorded in BCA's history as expense, naming the transfer</td><td>⬜ untested</td></tr>
<tr><td>recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:all</code> wants to move stock to another warehouse<br>(1 product · warehouse A to warehouse B · count more than warehouse A holds)</td><td rowspan="1" valign="top">create transfer</td><td>cannot create, says counts within the stock at warehouse A</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>selling:all</code> wants to move stock to another warehouse<br>(1 product · warehouse A to warehouse B · its units at warehouse A on a rack in a running stock opname)</td><td rowspan="1" valign="top">create transfer</td><td>cannot create, names the rack and the stock opname holding it</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top">5</td><td rowspan="4" valign="top"><code>selling:all</code> wants to record the shipping cost<br>(status: process · no shipping cost yet · shipping cost typed · paid from BCA)</td><td rowspan="4" valign="top">edit transfer cost</td><td>shipping cost shown on the transfer</td><td>⬜ untested</td></tr>
<tr><td>BCA decreases by shipping cost</td><td>⬜ untested</td></tr>
<tr><td>recorded in BCA's history</td><td>⬜ untested</td></tr>
<tr><td>recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>selling:all</code> wants to record the shipping cost<br>(status: process · shipping cost changed from Rp 20.000 to Rp 25.000 · same account BCA)</td><td rowspan="1" valign="top">edit transfer cost</td><td>BCA decreases by the difference</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">7</td><td rowspan="2" valign="top"><code>selling:all</code> wants to record the shipping cost<br>(status: process · shipping cost paid from BCA · account changed to ShopeePay)</td><td rowspan="2" valign="top">edit transfer cost</td><td>shipping cost back into BCA</td><td>⬜ untested</td></tr>
<tr><td>shipping cost out of ShopeePay</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">8</td><td rowspan="1" valign="top"><code>selling:all</code> wants to record the shipping cost<br>(status: accepted)</td><td rowspan="1" valign="top">edit transfer cost</td><td>edit cost not offered</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top">9</td><td rowspan="4" valign="top"><code>selling:all</code> wants to call a transfer off<br>(status: created · 1 product · shipping cost paid from BCA · reason)</td><td rowspan="4" valign="top">cancel transfer</td><td>status cancelled</td><td>⬜ untested</td></tr>
<tr><td>ready stock of 1 product back at warehouse A</td><td>⬜ untested</td></tr>
<tr><td>shipping cost back into BCA</td><td>⬜ untested</td></tr>
<tr><td>reason recorded in transfer timeline</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">10</td><td rowspan="1" valign="top"><code>selling:all</code> wants to call a transfer off<br>(status: process)</td><td rowspan="1" valign="top">cancel transfer</td><td>cancel not offered</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top">11</td><td rowspan="4" valign="top"><code>selling:all</code> wants to give a box up<br>(status: shipped · shipping cost paid from BCA · reason)</td><td rowspan="4" valign="top">mark lost transfer</td><td>status lost</td><td>⬜ untested</td></tr>
<tr><td>reason recorded in transfer timeline</td><td>⬜ untested</td></tr>
<tr><td>shipping cost not returned to BCA</td><td>⬜ untested</td></tr>
<tr><td>units still in transit</td><td>⬜ untested</td></tr>
</table>

## send

Warehouse A confirms the transfer, picks it, and hands the box over.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top">12</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to send a transfer<br>(warehouse A · status: created)</td><td rowspan="3" valign="top">process transfer</td><td>status process</td><td>⬜ untested</td></tr>
<tr><td>selling team can no longer cancel</td><td>⬜ untested</td></tr>
<tr><td>pick list names the racks to take from</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">13</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to send a transfer<br>(warehouse A · status: process · courier · tracking number · label photo)</td><td rowspan="3" valign="top">ship transfer</td><td>status shipped</td><td>⬜ untested</td></tr>
<tr><td>courier and tracking number shown to the selling team and warehouse B</td><td>⬜ untested</td></tr>
<tr><td>label photo opens for the selling team and warehouse B</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">14</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to send a transfer<br>(warehouse A · status: process · own vehicle · no courier, tracking number or label photo)</td><td rowspan="1" valign="top">ship transfer</td><td>status shipped, without a courier</td><td>⬜ untested</td></tr>
</table>

## receive

Warehouse B signs for the box, counts it in, and corrects a wrong count.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">15</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to receive a transfer<br>(warehouse B · status: shipped)</td><td rowspan="2" valign="top">arrive transfer</td><td>status arrived</td><td>⬜ untested</td></tr>
<tr><td>ready stock at warehouse B unchanged</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">16</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to receive a transfer<br>(warehouse B · status: lost · box turned up)</td><td rowspan="2" valign="top">arrive transfer</td><td>status arrived</td><td>⬜ untested</td></tr>
<tr><td>lost, then arrived, in transfer timeline</td><td>⬜ untested</td></tr>
<tr><td rowspan="6" valign="top">17</td><td rowspan="6" valign="top"><code>warehouse:all</code> wants to count a transfer in<br>(warehouse B · status: arrived · 1 product · all arrived · put away on a rack · no courier charge)</td><td rowspan="6" valign="top">accept transfer</td><td>status accepted</td><td>⬜ untested</td></tr>
<tr><td>ready stock of 1 product at warehouse B increases</td><td>⬜ untested</td></tr>
<tr><td>units on the rack they were put away on</td><td>⬜ untested</td></tr>
<tr><td>batch at warehouse B with warehouse A's price, expiry and supplier</td><td>⬜ untested</td></tr>
<tr><td>in transit on the products page decreases</td><td>⬜ untested</td></tr>
<tr><td>received recorded in transfer analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">18</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to count a transfer in<br>(warehouse B · status: shipped · all arrived)</td><td rowspan="1" valign="top">accept transfer</td><td>status accepted, without signing for the box first</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">19</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to count a transfer in<br>(warehouse B · status: arrived · 1 broken · 1 missing · notes)</td><td rowspan="3" valign="top">accept transfer</td><td>broken and missing rows, with their notes</td><td>⬜ untested</td></tr>
<tr><td>broken or missing value shown as the team's loss</td><td>⬜ untested</td></tr>
<tr><td>ready stock at warehouse B increases by the good units only</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">20</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to count a transfer in<br>(warehouse B · status: arrived · courier charge at the door)</td><td rowspan="2" valign="top">accept transfer</td><td>courier charge shown on the transfer</td><td>⬜ untested</td></tr>
<tr><td>selling team's debt to warehouse B increases</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">21</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to count a transfer in<br>(warehouse B · status: arrived · 1 product from 2 batches at warehouse A with different prices)</td><td rowspan="1" valign="top">accept transfer</td><td>2 batches at warehouse B, each at its own price</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top">22</td><td rowspan="4" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to correct a received count<br>(warehouse B · status: accepted · counted 5 · really 4 · reason)</td><td rowspan="4" valign="top">correct received count transfer</td><td>arrived count 4</td><td>⬜ untested</td></tr>
<tr><td>ready stock at warehouse B decreases by 1</td><td>⬜ untested</td></tr>
<tr><td>correction and its reason shown on the transfer</td><td>⬜ untested</td></tr>
<tr><td>received adjusted in transfer analytic metric</td><td>⬜ untested</td></tr>
</table>
