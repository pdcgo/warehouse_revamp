# Acceptance — inventory / order

Business: [order.md](../../business/inventory/order.md) · rules: [guide.md](../guide.md)

## create

The selling team places an order, and takes it back while it is still pending.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="12" valign="top">1</td><td rowspan="12" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · 1 supplier · note · receipt label · typed in)</td><td rowspan="12" valign="top">create order</td><td>order created with 1 product</td><td>⬜ untested</td></tr>
<tr><td>note shown in order timeline</td><td>⬜ untested</td></tr>
<tr><td>ready stock of 1 product decreases at 1 warehouse</td><td>⬜ untested</td></tr>
<tr><td>recorded in product history</td><td>⬜ untested</td></tr>
<tr><td>order shows items cost and warehouse fee</td><td>⬜ untested</td></tr>
<tr><td>target warehouse sees order pending</td><td>⬜ untested</td></tr>
<tr><td>target warehouse can print receipt</td><td>⬜ untested</td></tr>
<tr><td>warehouse fee recorded in liability</td><td>⬜ untested</td></tr>
<tr><td>sale recorded in order settlement</td><td>⬜ untested</td></tr>
<tr><td>order recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td>recorded at 1 supplier</td><td>⬜ untested</td></tr>
<tr><td>warehouse fee recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="13" valign="top">2</td><td rowspan="13" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · cross product · 1 warehouse · 1 supplier · note · receipt label · typed in)</td><td rowspan="13" valign="top">create order</td><td>order created with 1 product</td><td>⬜ untested</td></tr>
<tr><td>note shown in order timeline</td><td>⬜ untested</td></tr>
<tr><td>ready stock of 1 product decreases at 1 warehouse</td><td>⬜ untested</td></tr>
<tr><td>cross team's ready stock decreases</td><td>⬜ untested</td></tr>
<tr><td>recorded in product history</td><td>⬜ untested</td></tr>
<tr><td>order shows items cost and warehouse fee</td><td>⬜ untested</td></tr>
<tr><td>target warehouse sees order pending</td><td>⬜ untested</td></tr>
<tr><td>target warehouse can print receipt</td><td>⬜ untested</td></tr>
<tr><td>warehouse fee recorded in liability</td><td>⬜ untested</td></tr>
<tr><td>product fee recorded in liability to cross team</td><td>⬜ untested</td></tr>
<tr><td>sale recorded in order settlement</td><td>⬜ untested</td></tr>
<tr><td>order recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td>recorded at 1 supplier</td><td>⬜ untested</td></tr>
<tr><td rowspan="12" valign="top">3</td><td rowspan="12" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · 1 supplier · note · receipt label · from draft)</td><td rowspan="12" valign="top">create order</td><td>order created with 1 product</td><td>⬜ untested</td></tr>
<tr><td>draft removed from drafts</td><td>⬜ untested</td></tr>
<tr><td>note shown in order timeline</td><td>⬜ untested</td></tr>
<tr><td>ready stock of 1 product decreases at 1 warehouse</td><td>⬜ untested</td></tr>
<tr><td>recorded in product history</td><td>⬜ untested</td></tr>
<tr><td>order shows items cost and warehouse fee</td><td>⬜ untested</td></tr>
<tr><td>target warehouse sees order pending</td><td>⬜ untested</td></tr>
<tr><td>target warehouse can print receipt</td><td>⬜ untested</td></tr>
<tr><td>warehouse fee recorded in liability</td><td>⬜ untested</td></tr>
<tr><td>sale recorded in order settlement</td><td>⬜ untested</td></tr>
<tr><td>order recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td>recorded at 1 supplier</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">4</td><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · Order ID on 1 pending order of same shop)</td><td rowspan="2" valign="top">create order</td><td>warning names the used order in frontend</td><td>⬜ untested</td></tr>
<tr><td>can create but needs confirm in frontend</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · Order ID on 1 cancelled order of same shop)</td><td rowspan="1" valign="top">create order</td><td>no warning in frontend</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · Order ID on 1 pending order of other shop)</td><td rowspan="1" valign="top">create order</td><td>no warning in frontend</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">7</td><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · Order ID on 1 draft of same shop)</td><td rowspan="2" valign="top">create order</td><td>warning names the draft in frontend</td><td>⬜ untested</td></tr>
<tr><td>can create but needs confirm in frontend</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">8</td><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · debt to warehouse at limit)</td><td rowspan="2" valign="top">create order</td><td>order refused</td><td>⬜ untested</td></tr>
<tr><td>message names team, debt and limit</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">9</td><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · cross product · 1 warehouse · return map chosen · debt to cross team at limit)</td><td rowspan="2" valign="top">create order</td><td>order refused</td><td>⬜ untested</td></tr>
<tr><td>message names team, debt and limit</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">10</td><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · debt to warehouse at 80% of limit)</td><td rowspan="2" valign="top">create order</td><td>has warning in frontend</td><td>⬜ untested</td></tr>
<tr><td>order created</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">11</td><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · cross product · 1 warehouse · no return map)</td><td rowspan="2" valign="top">create order</td><td>cannot create order</td><td>⬜ untested</td></tr>
<tr><td>reason shown in frontend</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">12</td><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · cross product · 1 warehouse · return map chosen)</td><td rowspan="2" valign="top">create order</td><td>return map saved and locked</td><td>⬜ untested</td></tr>
<tr><td>return map used on next order</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">13</td><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · no return warehouse set)</td><td rowspan="2" valign="top">create order</td><td>order refused</td><td>⬜ untested</td></tr>
<tr><td>message says to set return warehouse</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">14</td><td rowspan="1" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · ready stock less than ordered)</td><td rowspan="1" valign="top">create order</td><td>order refused</td><td>⬜ untested</td></tr>
<tr><td rowspan="10" valign="top">15</td><td rowspan="10" valign="top"><code>selling:all</code> wants to cancel an order<br>(status: pending · 1 product · own product · 1 warehouse · 1 rack · 1 supplier)</td><td rowspan="10" valign="top">cancel order</td><td>status changed from pending to cancelled</td><td>⬜ untested</td></tr>
<tr><td>cancel recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>ready stock of 1 product increases at 1 warehouse</td><td>⬜ untested</td></tr>
<tr><td>stock on 1 rack increases</td><td>⬜ untested</td></tr>
<tr><td>recorded in product history</td><td>⬜ untested</td></tr>
<tr><td>warehouse sees order cancelled</td><td>⬜ untested</td></tr>
<tr><td>warehouse fee reversed in liability</td><td>⬜ untested</td></tr>
<tr><td>sale cancelled in order settlement</td><td>⬜ untested</td></tr>
<tr><td>cancel recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td>cancel recorded at 1 supplier</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">16</td><td rowspan="3" valign="top"><code>selling:all</code> wants to cancel an order<br>(status: pending · 1 product · cross product · 1 warehouse · 1 rack · 1 supplier)</td><td rowspan="3" valign="top">cancel order</td><td>status changed from pending to cancelled</td><td>⬜ untested</td></tr>
<tr><td>cross team's ready stock increases</td><td>⬜ untested</td></tr>
<tr><td>product fee reversed in liability to cross team</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">17</td><td rowspan="1" valign="top"><code>selling:all</code> wants to cancel an order<br>(status: processed · 1 product · own product · 1 warehouse)</td><td rowspan="1" valign="top">cancel order</td><td>cannot cancel order</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">18</td><td rowspan="2" valign="top"><code>selling:all</code> wants to cancel an order<br>(status: pending · 1 product · own product · 1 warehouse · opname running on its rack)</td><td rowspan="2" valign="top">cancel order</td><td>cancel refused</td><td>⬜ untested</td></tr>
<tr><td>message names opname, who started it and when</td><td>⬜ untested</td></tr>
</table>

## draft

Drafts come in from a third-party app; the selling team finishes them in the order form, or clears them.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="1" valign="top">19</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see their drafts<br>(own drafts · colleague's drafts)</td><td rowspan="1" valign="top">list draft order</td><td>only own drafts shown</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">20</td><td rowspan="1" valign="top"><code>selling:all</code> wants to finish a draft<br>(1 draft from app · 1 product)</td><td rowspan="1" valign="top">open draft order</td><td>draft opens in order form with its data</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">21</td><td rowspan="1" valign="top"><code>selling:all</code> wants to clear drafts<br>(1 draft)</td><td rowspan="1" valign="top">delete draft order</td><td>draft removed from drafts</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">22</td><td rowspan="1" valign="top"><code>selling:all</code> wants to clear drafts<br>(multi drafts selected)</td><td rowspan="1" valign="top">delete draft order</td><td>every selected draft removed</td><td>⬜ untested</td></tr>
</table>

## edit

What can still change on an order after create: the resi, the shop, and notes added by either side.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="4" valign="top">23</td><td rowspan="4" valign="top"><code>selling:all</code> wants to fix an order's resi<br>(status: pending · new resi)</td><td rowspan="4" valign="top">edit resi order</td><td>resi changed</td><td>⬜ untested</td></tr>
<tr><td>old and new resi shown in order timeline</td><td>⬜ untested</td></tr>
<tr><td>warehouse sees new resi</td><td>⬜ untested</td></tr>
<tr><td>receipt scan finds order by new resi</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">24</td><td rowspan="3" valign="top"><code>selling:all</code> wants to fix an order's resi<br>(status: processed · new label file)</td><td rowspan="3" valign="top">edit resi order</td><td>label changed</td><td>⬜ untested</td></tr>
<tr><td>label change shown in order timeline</td><td>⬜ untested</td></tr>
<tr><td>warehouse prints new label</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">25</td><td rowspan="1" valign="top"><code>selling:all</code> wants to fix an order's resi<br>(status: picked · new resi · new label file)</td><td rowspan="1" valign="top">edit resi order</td><td>resi and label changed</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">26</td><td rowspan="2" valign="top"><code>selling:all</code> wants to fix an order's resi<br>(status: picked · label printed · wrong label uploaded · new label file)</td><td rowspan="2" valign="top">edit resi order</td><td>label changed</td><td>⬜ untested</td></tr>
<tr><td>warehouse told to reprint label</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="3" valign="top">27</td><td rowspan="3" valign="top"><code>selling:all</code> wants to fix an order's shop<br>(status: completed · order in wrong shop · statement import refused)</td><td rowspan="3" valign="top">edit shop order</td><td>shop changed</td><td>🚧 unimplemented</td></tr>
<tr><td>shop change shown in order timeline</td><td>🚧 unimplemented</td></tr>
<tr><td>statement import succeeds</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="3" valign="top">28</td><td rowspan="3" valign="top"><code>selling:all</code> wants to leave a note on an order<br>(status: pending · 1 order)</td><td rowspan="3" valign="top">add order note</td><td>note shown in order timeline</td><td>⬜ untested</td></tr>
<tr><td>note shown as from selling team</td><td>⬜ untested</td></tr>
<tr><td>warehouse sees note</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">29</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to leave a note on an order<br>(status: processed · 1 order)</td><td rowspan="3" valign="top">add order note</td><td>note shown in order timeline</td><td>⬜ untested</td></tr>
<tr><td>note shown as from warehouse</td><td>⬜ untested</td></tr>
<tr><td>selling team sees note</td><td>⬜ untested</td></tr>
</table>

## process

The order's way out: the warehouse confirms, picks, packs and hands it over, customer service marks it shipped and completes it.

### process: confirm

**pending → processed** — the warehouse takes the order on: prints the receipts and confirms. **processed / picked → pending** — it hands an order back.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="4" valign="top">30</td><td rowspan="4" valign="top"><code>warehouse:all</code> wants to print receipts<br>(status: pending · multi orders · unboxing warning on)</td><td rowspan="4" valign="top">print receipt order</td><td>print page shows chosen orders</td><td>🚧 unimplemented</td></tr>
<tr><td>labels printed in one session</td><td>🚧 unimplemented</td></tr>
<tr><td>unboxing video warning printed</td><td>🚧 unimplemented</td></tr>
<tr><td>status of every order changed from pending to processed</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">31</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to print receipts<br>(status: pending · multi orders · unboxing warning off)</td><td rowspan="1" valign="top">print receipt order</td><td>labels printed without unboxing warning</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">32</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to print receipts<br>(status: pending · multi orders · 1 order without label)</td><td rowspan="1" valign="top">print receipt order</td><td>message names order without label</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">33</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to print receipts<br>(status: pending · multi orders · status change off)</td><td rowspan="2" valign="top">print receipt order</td><td>labels printed</td><td>🚧 unimplemented</td></tr>
<tr><td>orders stay pending</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">34</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to print receipts<br>(status: processed · 1 order · reprint)</td><td rowspan="2" valign="top">print receipt order</td><td>label printed</td><td>🚧 unimplemented</td></tr>
<tr><td>status unchanged</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="5" valign="top">35</td><td rowspan="5" valign="top"><code>warehouse:all</code> wants to confirm an order<br>(status: pending · 1 order)</td><td rowspan="5" valign="top">confirm order</td><td>status changed from pending to processed</td><td>⬜ untested</td></tr>
<tr><td>confirm recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>selling team sees order processed</td><td>⬜ untested</td></tr>
<tr><td>confirm recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td>package can be validated</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">36</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to confirm an order<br>(status: pending · multi orders)</td><td rowspan="3" valign="top">confirm order</td><td>status of every order changed from pending to processed</td><td>⬜ untested</td></tr>
<tr><td>confirm recorded in each order timeline</td><td>⬜ untested</td></tr>
<tr><td>selling team sees every order processed</td><td>⬜ untested</td></tr>
<tr><td rowspan="5" valign="top">37</td><td rowspan="5" valign="top"><code>warehouse:all</code> wants to hand an order back to pending<br>(status: processed · goods missing on rack · note)</td><td rowspan="5" valign="top">back to pending order</td><td>status changed from processed to pending</td><td>⬜ untested</td></tr>
<tr><td>note shown in order timeline</td><td>⬜ untested</td></tr>
<tr><td>selling team sees order pending</td><td>⬜ untested</td></tr>
<tr><td>back to pending recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td>order can be cancelled</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">38</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to hand an order back to pending<br>(status: picked · cancelled on platform · goods back on rack · note)</td><td rowspan="2" valign="top">back to pending order</td><td>status changed from picked to pending</td><td>⬜ untested</td></tr>
<tr><td>note shown in order timeline</td><td>⬜ untested</td></tr>
</table>

### process: pick and pack

**processed → picked** — the goods come off the racks, for many orders at once, and each package is validated by scanning every item.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">39</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to pick goods for many orders<br>(status: processed · multi orders · grouped by product)</td><td rowspan="2" valign="top">bulk pick order</td><td>each product shown with total quantity and its racks</td><td>🚧 unimplemented</td></tr>
<tr><td>order stays processed</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">40</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to pick goods for many orders<br>(status: processed · multi orders · grouped by order)</td><td rowspan="1" valign="top">bulk pick order</td><td>each order shown with its products and racks</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="8" valign="top">41</td><td rowspan="8" valign="top"><code>warehouse:all</code> wants to validate an order's package<br>(status: processed · 1 product · 1 rack · opened by receipt scan · all items scanned)</td><td rowspan="8" valign="top">validate package order</td><td>pick page opens from receipt scan</td><td>⬜ untested</td></tr>
<tr><td>pick page shows 1 rack for 1 product</td><td>⬜ untested</td></tr>
<tr><td>every scanned item correct</td><td>⬜ untested</td></tr>
<tr><td>status changed from processed to picked</td><td>⬜ untested</td></tr>
<tr><td>pick recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>selling team sees order picked</td><td>⬜ untested</td></tr>
<tr><td>pick recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td>order can be handed over</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">42</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to validate an order's package<br>(status: processed · 1 product · 2 racks · all items scanned)</td><td rowspan="2" valign="top">validate package order</td><td>pick page shows 2 racks with quantity of each</td><td>⬜ untested</td></tr>
<tr><td>status changed from processed to picked</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">43</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to validate an order's package<br>(status: processed · item not on order scanned)</td><td rowspan="2" valign="top">validate package order</td><td>scan refused with wrong sound</td><td>⬜ untested</td></tr>
<tr><td>cannot set picked</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">44</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to validate an order's package<br>(status: processed · more items than ordered scanned)</td><td rowspan="2" valign="top">validate package order</td><td>scan refused with wrong sound</td><td>⬜ untested</td></tr>
<tr><td>item count stays at ordered quantity</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">45</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to validate an order's package<br>(status: processed · not every item scanned)</td><td rowspan="1" valign="top">validate package order</td><td>cannot set picked</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">46</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to validate an order's package<br>(status: processed · 1 product · restock sticker scanned)</td><td rowspan="1" valign="top">validate package order</td><td>every scanned item correct</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">47</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to validate an order's package<br>(status: processed · 1 receipt on 2 orders · receipt scan)</td><td rowspan="2" valign="top">validate package order</td><td>both orders shown</td><td>⬜ untested</td></tr>
<tr><td>no pick page opened</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">48</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to validate an order's package<br>(status: cancel · receipt of cancelled order scanned)</td><td rowspan="2" valign="top">validate package order</td><td>scan marked with wrong sound</td><td>⬜ untested</td></tr>
<tr><td>no pick page opened</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">49</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to validate an order's package<br>(status: picked · set picked by another person)</td><td rowspan="2" valign="top">validate package order</td><td>set picked refused</td><td>⬜ untested</td></tr>
<tr><td>message says already picked</td><td>⬜ untested</td></tr>
</table>

### process: hand over

**picked → shipping** — the packed parcels go to the courier by scan. Finding one in the pile changes no status.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="5" valign="top">50</td><td rowspan="5" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: picked · 1 order · receipt scan · bulk handover off)</td><td rowspan="5" valign="top">hand over order</td><td>status changed from picked to shipping</td><td>⬜ untested</td></tr>
<tr><td>hand over recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>selling team sees order shipping</td><td>⬜ untested</td></tr>
<tr><td>hand over recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td>order can be marked shipped</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top">51</td><td rowspan="4" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: picked · multi orders · receipt scan · bulk handover on)</td><td rowspan="4" valign="top">hand over order</td><td>scanned orders collected in list</td><td>⬜ untested</td></tr>
<tr><td>status of every order changed from picked to shipping</td><td>⬜ untested</td></tr>
<tr><td>hand over recorded in each order timeline</td><td>⬜ untested</td></tr>
<tr><td>parcel count per courier shown</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">52</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: picked · multi orders · selected from list)</td><td rowspan="1" valign="top">hand over order</td><td>status of every order changed from picked to shipping</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">53</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: processed · receipt scan)</td><td rowspan="1" valign="top">hand over order</td><td>scan marked error with wrong sound</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">54</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: picked · same receipt scanned twice · bulk handover on)</td><td rowspan="1" valign="top">hand over order</td><td>order listed once</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">55</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: picked · 1 receipt on 2 orders · receipt scan)</td><td rowspan="2" valign="top">hand over order</td><td>both orders shown</td><td>⬜ untested</td></tr>
<tr><td>no order handed over</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">56</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: picked and processed · multi orders · selected from list)</td><td rowspan="2" valign="top">hand over order</td><td>picked orders changed from picked to shipping</td><td>⬜ untested</td></tr>
<tr><td>processed orders skipped with warning</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">57</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(receipt not found · receipt scan)</td><td rowspan="1" valign="top">hand over order</td><td>scan marked not found with wrong sound</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">58</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: picked · 1 receipt on 1 order and 1 cancelled order · receipt scan)</td><td rowspan="1" valign="top">hand over order</td><td>status changed from picked to shipping</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">59</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: processed · bulk handover on · only error scans)</td><td rowspan="1" valign="top">hand over order</td><td>cannot hand over</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">60</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: picked and processed · multi orders · receipt scan · bulk handover on)</td><td rowspan="2" valign="top">hand over order</td><td>only picked orders handed over</td><td>⬜ untested</td></tr>
<tr><td>processed scans marked error</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">61</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: picked · resi changed after label printed · old label scanned)</td><td rowspan="1" valign="top">hand over order</td><td>scan marked not found with wrong sound</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">62</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to find a parcel in a pile<br>(status: picked · 1 order · its label scanned)</td><td rowspan="2" valign="top">find parcel</td><td>scan shows match with right sound</td><td>⬜ untested</td></tr>
<tr><td>order status unchanged</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">63</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to find a parcel in a pile<br>(status: shipping · 1 order · another order's label scanned)</td><td rowspan="1" valign="top">find parcel</td><td>scan shows not this parcel with wrong sound</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">64</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to find a parcel in a pile<br>(status: picked · 1 order · no resi recorded · its Order ID scanned)</td><td rowspan="1" valign="top">find parcel</td><td>scan shows match with right sound</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">65</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to find a parcel in a pile<br>(status: picked · 1 order · resi changed after label printed · old label scanned)</td><td rowspan="1" valign="top">find parcel</td><td>scan shows not this parcel with wrong sound</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">66</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to find a parcel in a pile<br>(status: shipping · 2 orders with same Order ID · other order's label scanned)</td><td rowspan="1" valign="top">find parcel<br><a href="#a-same-order-id-matches-another-parcel">⚠ a risk</a></td><td>scan shows match with right sound</td><td>⬜ untested</td></tr>
</table>

### process: delivery

**shipping → shipped → completed** — customer service follows the parcel on the platform.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="6" valign="top">67</td><td rowspan="6" valign="top"><code>selling:all</code> wants to mark an order shipped<br>(status: shipping · 1 order)</td><td rowspan="6" valign="top">mark shipped order</td><td>status changed from shipping to shipped</td><td>⬜ untested</td></tr>
<tr><td>shipped recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>warehouse sees order shipped</td><td>⬜ untested</td></tr>
<tr><td>shipped recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td>order can be completed</td><td>⬜ untested</td></tr>
<tr><td>parcel tracking shown on order</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="4" valign="top">68</td><td rowspan="4" valign="top"><code>selling:all</code> wants to complete an order<br>(status: shipped · 1 order)</td><td rowspan="4" valign="top">complete order</td><td>status changed from shipped to completed</td><td>⬜ untested</td></tr>
<tr><td>complete recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>warehouse sees order completed</td><td>⬜ untested</td></tr>
<tr><td>complete recorded in analytic metric</td><td>⬜ untested</td></tr>
</table>

## return

The parcel comes back: customer service or the warehouse returns the order, the return warehouse accepts it.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="5" valign="top">69</td><td rowspan="5" valign="top"><code>selling:all</code> wants to return an order<br>(status: shipped · 1 order · 1 return warehouse)</td><td rowspan="5" valign="top">return order</td><td>status changed from shipped to return</td><td>⬜ untested</td></tr>
<tr><td>return recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>return warehouse sees order return</td><td>⬜ untested</td></tr>
<tr><td>return recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td>return can be accepted</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">70</td><td rowspan="1" valign="top"><code>selling:all</code> wants to return an order<br>(status: shipping · 1 order)</td><td rowspan="1" valign="top">return order</td><td>status changed from shipping to return</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">71</td><td rowspan="1" valign="top"><code>selling:all</code> wants to return an order<br>(status: problem · 1 order)</td><td rowspan="1" valign="top">return order</td><td>status changed from problem to return</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">72</td><td rowspan="1" valign="top"><code>selling:all</code> wants to return an order<br>(status: completed · 1 order)</td><td rowspan="1" valign="top">return order</td><td>status changed from completed to return</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top">73</td><td rowspan="4" valign="top"><code>warehouse:all</code> wants to return an order<br>(status: shipped · 1 order · parcel in warehouse before return claimed)</td><td rowspan="4" valign="top">return order</td><td>status changed from shipped to return</td><td>⬜ untested</td></tr>
<tr><td>return recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>selling team sees order return</td><td>⬜ untested</td></tr>
<tr><td>return can be accepted</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">74</td><td rowspan="1" valign="top"><code>selling:all</code> wants to return an order<br>(status: picked · 1 order)</td><td rowspan="1" valign="top">return order</td><td>cannot return order</td><td>⬜ untested</td></tr>
<tr><td rowspan="7" valign="top">75</td><td rowspan="7" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · all returned · 1 rack · return warehouse · no courier charge)</td><td rowspan="7" valign="top">accept return</td><td>status changed from return to return completed</td><td>⬜ untested</td></tr>
<tr><td>accept recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>ready stock of 1 product increases at return warehouse</td><td>⬜ untested</td></tr>
<tr><td>stock on 1 rack increases</td><td>⬜ untested</td></tr>
<tr><td>recorded in product history</td><td>⬜ untested</td></tr>
<tr><td>selling team sees order return completed</td><td>⬜ untested</td></tr>
<tr><td>return arrival recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top">76</td><td rowspan="4" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · brokens thrown away · missing items · 1 rack · return warehouse)</td><td rowspan="4" valign="top">accept return</td><td>ready stock increases by good items only</td><td>⬜ untested</td></tr>
<tr><td>broken items thrown away</td><td>⬜ untested</td></tr>
<tr><td>missing items recorded</td><td>⬜ untested</td></tr>
<tr><td>broken and missing items shown in order timeline</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">77</td><td valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · brokens on rack · 1 rack · return warehouse)</td><td valign="top">accept return<br><a href="#brokens-on-rack-goes-against-a-business-decision">⚠ against a business decision</a></td><td>brokens on rack</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">78</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · cross product · return map chosen · all returned · 1 rack · return warehouse)</td><td rowspan="2" valign="top">accept return</td><td>ready stock of mapped own product increases</td><td>⬜ untested</td></tr>
<tr><td>can print barcode of mapped own product</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">79</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · all returned · 1 rack · return warehouse · courier charge with note)</td><td rowspan="1" valign="top">accept return</td><td>courier charge recorded in liability to return warehouse</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">80</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · return warehouse changed after order created · parcel at old return warehouse)</td><td rowspan="3" valign="top">accept return</td><td>cannot accept return</td><td>⬜ untested</td></tr>
<tr><td>message names new return warehouse</td><td>⬜ untested</td></tr>
<tr><td>message says to keep parcel aside</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">81</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · return warehouse · opname running on chosen rack)</td><td rowspan="2" valign="top">accept return</td><td>accept refused</td><td>⬜ untested</td></tr>
<tr><td>message names opname</td><td>⬜ untested</td></tr>
</table>

## problem and lost

After the handover something goes wrong: customer service marks a problem and resolves it, or writes the parcel off as lost — and the warehouse puts a lost parcel that turns up back in stock.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="5" valign="top">82</td><td rowspan="5" valign="top"><code>selling:all</code> wants to mark an order as problem<br>(status: shipped · 1 order)</td><td rowspan="5" valign="top">mark problem order</td><td>status changed from shipped to problem</td><td>⬜ untested</td></tr>
<tr><td>problem recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>warehouse sees order problem</td><td>⬜ untested</td></tr>
<tr><td>problem recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td>dispute can be resolved</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top">83</td><td rowspan="4" valign="top"><code>selling:all</code> wants to resolve a dispute<br>(status: problem · 1 order)</td><td rowspan="4" valign="top">resolve dispute order</td><td>status changed from problem to completed</td><td>⬜ untested</td></tr>
<tr><td>resolve recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>warehouse sees order completed</td><td>⬜ untested</td></tr>
<tr><td>resolve recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="5" valign="top">84</td><td rowspan="5" valign="top"><code>selling:all</code> wants to mark an order lost<br>(status: shipped · 1 order)</td><td rowspan="5" valign="top">mark lost order</td><td>status changed from shipped to lost</td><td>⬜ untested</td></tr>
<tr><td>lost recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>warehouse sees order lost</td><td>⬜ untested</td></tr>
<tr><td>lost recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td>no status change available on lost order</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">85</td><td rowspan="1" valign="top"><code>selling:all</code> wants to mark an order lost<br>(status: problem · 1 order)</td><td rowspan="1" valign="top">mark lost order</td><td>status changed from problem to lost</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">86</td><td rowspan="1" valign="top"><code>selling:all</code> wants to mark an order lost<br>(status: return · 1 order)</td><td rowspan="1" valign="top">mark lost order</td><td>status changed from return to lost</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">87</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to put a found parcel back in stock<br>(status: lost · parcel back at warehouse · 1 product · 1 rack)</td><td rowspan="2" valign="top">report found</td><td>found names the lost order</td><td>🚧 unimplemented</td></tr>
<tr><td>order stays lost</td><td>⬜ untested</td></tr>
</table>

## export

Either side takes the list it is looking at — its filter, every page — to a spreadsheet.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top">88</td><td rowspan="3" valign="top"><code>selling:all</code> wants to take orders to a spreadsheet<br>(status tab: shipped · multi pages)</td><td rowspan="3" valign="top">export order</td><td>file holds every order of the tab, all pages</td><td>⬜ untested</td></tr>
<tr><td>file shows money columns</td><td>⬜ untested</td></tr>
<tr><td>progress shown while exporting</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">89</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to take orders to a spreadsheet<br>(status tab: picked · search filter)</td><td rowspan="2" valign="top">export order</td><td>file holds only the filtered orders</td><td>⬜ untested</td></tr>
<tr><td>file shows no seller money</td><td>⬜ untested</td></tr>
</table>

## import

> ❓ **Open — no givens yet (2026-11-17).** Importing a marketplace file of orders is not decided, so it is held as
> questions until it is. The settlement import is the main import; this one has to be placed beside it.
>
> - **What does it change?** The order's status only, as the system does today (after handover), or also the order's
>   settlement — the sale total (*Terjual*), or the payout and deductions the settlement import already posts?
> - **How are the products in the file treated?** Matched to the order's lines, used to correct them, or ignored?
> - **An order in the file with no order here** — ignored, listed, or made into a draft? And one that belongs to
>   another shop?
> - **Which statuses may it move, and from when?** Only after handover today: shipped, completed, return, lost.
> - **One file, two imports?** If the platform's files overlap, which import owns which figure, so nothing is posted twice.

## Warnings

### a-same-order-id-matches-another-parcel

⚠ Find This Parcel matches a scan against the order's resi, its Order ID and its order number. An Order ID may sit on
two live orders of one shop (it is warned at create, not refused), so when both parcels are in the same pile, scanning
the OTHER order's label still reads *Match — this is the parcel* if the label carries the Order ID. A different resi
tells them apart; the Order ID does not. Recorded as a risk: the given checks the system as it is.

### brokens-on-rack-goes-against-a-business-decision

⚠ *brokens on rack* is written to match restock, where a broken unit may be thrown away or put on a rack. For a
return the owner decided the other way: a broken returned unit is **thrown away, never shelved**, because the stock
holds sellable units only, and shelving it is named as *not chosen*
([a-broken-returned-unit-is-thrown-away-at-the-door](../../business/inventory/return_decision.md#a-broken-returned-unit-is-thrown-away-at-the-door)).
The system follows that decision. The given stays 🚧 until the business owner settles which one holds.
