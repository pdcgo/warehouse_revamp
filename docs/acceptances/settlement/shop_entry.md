# Acceptance — settlement / shop_entry

The settlement rows addressed to a shop rather than to an order — withdrawals, shop-level fees, and imported rows that
match no order — read on **Penyelesaian › Entri Toko** (`/settlement/shop-entries`) and corrected by a reversing row
(a row is never edited). The window is the day a row was learned, not the day it belongs to. Business:
[context.md](../../business/settlement/context.md) · rules: [guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="4" valign="top"><code>selling:all</code> wants to see money not tied to an order<br>(withdrawal · shop ads fee · imported row with no order)</td><td rowspan="4" valign="top">open shop entries</td><td>withdrawal, ads fee and unmatched row shown as rows</td><td>⬜ untested</td></tr>
<tr><td>withdrawal counted in withdrawn, not in received</td><td>⬜ untested</td></tr>
<tr><td>unmatched row shows its Order ID with order not found</td><td>⬜ untested</td></tr>
<tr><td>imported row links to its statement</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:all</code> wants to see money not tied to an order<br>(imported row matching 2 active orders)</td><td rowspan="1" valign="top">open shop entries</td><td>row shows its Order ID and both orders</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:all</code> wants to see money not tied to an order<br>(entry belongs to 3 Nov · learned 10 Nov)</td><td rowspan="1" valign="top">open shop entries</td><td>shown on 10 Nov with for 3 Nov</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:all</code> wants to find a shop's entries<br>(shop and kind chosen)</td><td rowspan="2" valign="top">filter shop entries</td><td>cards total only the filtered rows</td><td>⬜ untested</td></tr>
<tr><td>filter kept after reload</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top"><code>selling:all</code> wants to undo a wrong shop entry<br>(imported fee on the wrong shop)</td><td rowspan="3" valign="top">reverse shop entry</td><td>reversing row added on the same shop</td><td>⬜ untested</td></tr>
<tr><td>original shown as reversed</td><td>⬜ untested</td></tr>
<tr><td>received back to before</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:all</code> wants to undo a wrong shop entry<br>(already reversed)</td><td rowspan="1" valign="top">reverse shop entry</td><td>cannot reverse it again</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:all</code> wants to undo a wrong shop entry<br>(reversed by 2 people at once)</td><td rowspan="1" valign="top">reverse shop entry</td><td>reversed once</td><td>⬜ untested</td></tr>
</table>
