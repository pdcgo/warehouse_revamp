# Acceptance — inventory / order

Business: [order.md](../../business/inventory/order.md) · rules: [guide.md](../guide.md)

## create

The selling team places an order, and takes it back while it is still pending.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="11" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · 1 supplier · note · receipt label · typed in)</td><td rowspan="11" valign="top">create order</td><td>order created with 1 product</td><td>⬜ untested</td></tr>
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
<tr><td rowspan="13" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · cross product · 1 warehouse · 1 supplier · note · receipt label · typed in)</td><td rowspan="13" valign="top">create order</td><td>order created with 1 product</td><td>⬜ untested</td></tr>
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
<tr><td rowspan="12" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · 1 supplier · note · receipt label · from draft)</td><td rowspan="12" valign="top">create order</td><td>order created with 1 product</td><td>⬜ untested</td></tr>
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
<tr><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · Order ID on 1 pending order of same shop)</td><td rowspan="2" valign="top">create order</td><td>warning names the used order in frontend</td><td>⬜ untested</td></tr>
<tr><td>can create but needs confirm in frontend</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · Order ID on 1 cancelled order of same shop)</td><td rowspan="1" valign="top">create order</td><td>no warning in frontend</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · Order ID on 1 pending order of other shop)</td><td rowspan="1" valign="top">create order</td><td>no warning in frontend</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · Order ID on 1 draft of same shop)</td><td rowspan="2" valign="top">create order</td><td>warning names the draft in frontend</td><td>⬜ untested</td></tr>
<tr><td>can create but needs confirm in frontend</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · debt to warehouse at limit)</td><td rowspan="2" valign="top">create order</td><td>order refused</td><td>⬜ untested</td></tr>
<tr><td>message names team, debt and limit</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · cross product · 1 warehouse · return map chosen · debt to cross team at limit)</td><td rowspan="2" valign="top">create order</td><td>order refused</td><td>⬜ untested</td></tr>
<tr><td>message names team, debt and limit</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · debt to warehouse at 80% of limit)</td><td rowspan="2" valign="top">create order</td><td>has warning in frontend</td><td>⬜ untested</td></tr>
<tr><td>order created</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · cross product · 1 warehouse · no return map)</td><td rowspan="2" valign="top">create order</td><td>cannot create order</td><td>⬜ untested</td></tr>
<tr><td>reason shown in frontend</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · cross product · 1 warehouse · return map chosen)</td><td rowspan="2" valign="top">create order</td><td>return map saved and locked</td><td>⬜ untested</td></tr>
<tr><td>return map used on next order</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · no return warehouse set)</td><td rowspan="2" valign="top">create order</td><td>order refused</td><td>⬜ untested</td></tr>
<tr><td>message says to set return warehouse</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:all</code> wants to create an order<br>(1 product · own product · 1 warehouse · ready stock less than ordered)</td><td rowspan="1" valign="top">create order</td><td>order refused</td><td>⬜ untested</td></tr>
<tr><td rowspan="10" valign="top"><code>selling:all</code> wants to cancel an order<br>(status: pending · 1 product · own product · 1 warehouse · 1 rack · 1 supplier)</td><td rowspan="10" valign="top">cancel order</td><td>status changed from pending to cancelled</td><td>⬜ untested</td></tr>
<tr><td>cancel recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>ready stock of 1 product increases at 1 warehouse</td><td>⬜ untested</td></tr>
<tr><td>stock on 1 rack increases</td><td>⬜ untested</td></tr>
<tr><td>recorded in product history</td><td>⬜ untested</td></tr>
<tr><td>warehouse sees order cancelled</td><td>⬜ untested</td></tr>
<tr><td>warehouse fee reversed in liability</td><td>⬜ untested</td></tr>
<tr><td>sale cancelled in order settlement</td><td>⬜ untested</td></tr>
<tr><td>cancel recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td>cancel recorded at 1 supplier</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top"><code>selling:all</code> wants to cancel an order<br>(status: pending · 1 product · cross product · 1 warehouse · 1 rack · 1 supplier)</td><td rowspan="3" valign="top">cancel order</td><td>status changed from pending to cancelled</td><td>⬜ untested</td></tr>
<tr><td>cross team's ready stock increases</td><td>⬜ untested</td></tr>
<tr><td>product fee reversed in liability to cross team</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:all</code> wants to cancel an order<br>(status: processed · 1 product · own product · 1 warehouse)</td><td rowspan="1" valign="top">cancel order</td><td>cannot cancel order</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:all</code> wants to cancel an order<br>(status: pending · 1 product · own product · 1 warehouse · opname running on its rack)</td><td rowspan="2" valign="top">cancel order</td><td>cancel refused</td><td>⬜ untested</td></tr>
<tr><td>message names opname, who started it and when</td><td>⬜ untested</td></tr>
</table>

## process

The order's way out: the warehouse confirms, picks and hands it over, customer service marks it shipped and completes it.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="5" valign="top"><code>warehouse:all</code> wants to confirm an order<br>(status: pending · 1 order)</td><td rowspan="5" valign="top">confirm order</td><td>status changed from pending to processed</td><td>⬜ untested</td></tr>
<tr><td>confirm recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>selling team sees order processed</td><td>⬜ untested</td></tr>
<tr><td>confirm recorded in analytic metric</td><td>🚧 unimplemented</td></tr>
<tr><td>order can be picked</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top"><code>warehouse:all</code> wants to confirm an order<br>(status: pending · multi orders)</td><td rowspan="3" valign="top">confirm order</td><td>status of every order changed from pending to processed</td><td>⬜ untested</td></tr>
<tr><td>confirm recorded in each order timeline</td><td>⬜ untested</td></tr>
<tr><td>selling team sees every order processed</td><td>⬜ untested</td></tr>
<tr><td rowspan="8" valign="top"><code>warehouse:all</code> wants to pick an order<br>(status: processed · 1 product · 1 rack · opened by receipt scan · all items scanned)</td><td rowspan="8" valign="top">pick order</td><td>pick page opens from receipt scan</td><td>⬜ untested</td></tr>
<tr><td>pick page shows 1 rack for 1 product</td><td>⬜ untested</td></tr>
<tr><td>every scanned item correct</td><td>⬜ untested</td></tr>
<tr><td>status changed from processed to picked</td><td>⬜ untested</td></tr>
<tr><td>pick recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>selling team sees order picked</td><td>⬜ untested</td></tr>
<tr><td>pick recorded in analytic metric</td><td>🚧 unimplemented</td></tr>
<tr><td>order can be handed over</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>warehouse:all</code> wants to pick an order<br>(status: processed · 1 product · 2 racks · all items scanned)</td><td rowspan="2" valign="top">pick order</td><td>pick page shows 2 racks with quantity of each</td><td>⬜ untested</td></tr>
<tr><td>status changed from processed to picked</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>warehouse:all</code> wants to pick an order<br>(status: processed · item not on order scanned)</td><td rowspan="2" valign="top">pick order</td><td>scan refused with wrong sound</td><td>⬜ untested</td></tr>
<tr><td>cannot set picked</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>warehouse:all</code> wants to pick an order<br>(status: processed · more items than ordered scanned)</td><td rowspan="2" valign="top">pick order</td><td>scan refused with wrong sound</td><td>⬜ untested</td></tr>
<tr><td>item count stays at ordered quantity</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>warehouse:all</code> wants to pick an order<br>(status: processed · not every item scanned)</td><td rowspan="1" valign="top">pick order</td><td>cannot set picked</td><td>⬜ untested</td></tr>
<tr><td rowspan="5" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: picked · 1 order · receipt scan · mass pickup off)</td><td rowspan="5" valign="top">hand over order</td><td>status changed from picked to shipping</td><td>⬜ untested</td></tr>
<tr><td>hand over recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>selling team sees order shipping</td><td>⬜ untested</td></tr>
<tr><td>hand over recorded in analytic metric</td><td>🚧 unimplemented</td></tr>
<tr><td>order can be marked shipped</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: picked · multi orders · receipt scan · mass pickup on)</td><td rowspan="3" valign="top">hand over order</td><td>scanned orders collected in list</td><td>⬜ untested</td></tr>
<tr><td>status of every order changed from picked to shipping</td><td>⬜ untested</td></tr>
<tr><td>hand over recorded in each order timeline</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: picked · multi orders · selected from list)</td><td rowspan="1" valign="top">hand over order</td><td>status of every order changed from picked to shipping</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: processed · receipt scan)</td><td rowspan="1" valign="top">hand over order</td><td>scan marked error with wrong sound</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: picked · same receipt scanned twice · mass pickup on)</td><td rowspan="1" valign="top">hand over order</td><td>order listed once</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: picked · 1 receipt on 2 orders · receipt scan)</td><td rowspan="2" valign="top">hand over order</td><td>both orders shown</td><td>⬜ untested</td></tr>
<tr><td>no order handed over</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: picked and processed · multi orders · selected from list)</td><td rowspan="2" valign="top">hand over order</td><td>picked orders changed from picked to shipping</td><td>⬜ untested</td></tr>
<tr><td>processed orders skipped with warning</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(receipt not found · receipt scan)</td><td rowspan="1" valign="top">hand over order</td><td>scan marked not found with wrong sound</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: picked · 1 receipt on 1 order and 1 cancelled order · receipt scan)</td><td rowspan="1" valign="top">hand over order</td><td>status changed from picked to shipping</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>warehouse:all</code> wants to hand an order to the courier<br>(status: processed · mass pickup on · only error scans)</td><td rowspan="1" valign="top">hand over order</td><td>cannot hand over</td><td>⬜ untested</td></tr>
<tr><td rowspan="5" valign="top"><code>selling:all</code> wants to mark an order shipped<br>(status: shipping · 1 order)</td><td rowspan="5" valign="top">mark shipped order</td><td>status changed from shipping to shipped</td><td>⬜ untested</td></tr>
<tr><td>shipped recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>warehouse sees order shipped</td><td>⬜ untested</td></tr>
<tr><td>shipped recorded in analytic metric</td><td>🚧 unimplemented</td></tr>
<tr><td>order can be completed</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top"><code>selling:all</code> wants to complete an order<br>(status: shipped · 1 order)</td><td rowspan="4" valign="top">complete order</td><td>status changed from shipped to completed</td><td>⬜ untested</td></tr>
<tr><td>complete recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>warehouse sees order completed</td><td>⬜ untested</td></tr>
<tr><td>complete recorded in analytic metric</td><td>🚧 unimplemented</td></tr>
</table>

## return

The parcel comes back: customer service or the warehouse returns the order, the return warehouse accepts it.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="5" valign="top"><code>selling:all</code> wants to return an order<br>(status: shipped · 1 order · 1 return warehouse)</td><td rowspan="5" valign="top">return order</td><td>status changed from shipped to return</td><td>⬜ untested</td></tr>
<tr><td>return recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>return warehouse sees order return</td><td>⬜ untested</td></tr>
<tr><td>return recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td>return can be accepted</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:all</code> wants to return an order<br>(status: shipping · 1 order)</td><td rowspan="1" valign="top">return order</td><td>status changed from shipping to return</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:all</code> wants to return an order<br>(status: problem · 1 order)</td><td rowspan="1" valign="top">return order</td><td>status changed from problem to return</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:all</code> wants to return an order<br>(status: completed · 1 order)</td><td rowspan="1" valign="top">return order</td><td>status changed from completed to return</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top"><code>warehouse:all</code> wants to return an order<br>(status: shipped · 1 order · parcel in warehouse before return claimed)</td><td rowspan="4" valign="top">return order</td><td>status changed from shipped to return</td><td>⬜ untested</td></tr>
<tr><td>return recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>selling team sees order return</td><td>⬜ untested</td></tr>
<tr><td>return can be accepted</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:all</code> wants to return an order<br>(status: picked · 1 order)</td><td rowspan="1" valign="top">return order</td><td>cannot return order</td><td>⬜ untested</td></tr>
<tr><td rowspan="7" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · all returned · 1 rack · return warehouse · no courier charge)</td><td rowspan="7" valign="top">accept return</td><td>status changed from return to return completed</td><td>⬜ untested</td></tr>
<tr><td>accept recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>ready stock of 1 product increases at return warehouse</td><td>⬜ untested</td></tr>
<tr><td>stock on 1 rack increases</td><td>⬜ untested</td></tr>
<tr><td>recorded in product history</td><td>⬜ untested</td></tr>
<tr><td>selling team sees order return completed</td><td>⬜ untested</td></tr>
<tr><td>return arrival recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · brokens thrown away · missing items · 1 rack · return warehouse)</td><td rowspan="4" valign="top">accept return</td><td>ready stock increases by good items only</td><td>⬜ untested</td></tr>
<tr><td>broken items thrown away</td><td>⬜ untested</td></tr>
<tr><td>missing items recorded</td><td>⬜ untested</td></tr>
<tr><td>broken and missing items shown in order timeline</td><td>⬜ untested</td></tr>
<tr><td valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · brokens on rack · 1 rack · return warehouse)</td><td valign="top">accept return<br><a href="#brokens-on-rack-goes-against-a-business-decision">⚠ against a business decision</a></td><td>brokens on rack</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · cross product · return map chosen · all returned · 1 rack · return warehouse)</td><td rowspan="2" valign="top">accept return</td><td>ready stock of mapped own product increases</td><td>⬜ untested</td></tr>
<tr><td>can print barcode of mapped own product</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · all returned · 1 rack · return warehouse · courier charge with note)</td><td rowspan="1" valign="top">accept return</td><td>courier charge recorded in liability to return warehouse</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · return warehouse changed after order created · parcel at old return warehouse)</td><td rowspan="3" valign="top">accept return</td><td>cannot accept return</td><td>⬜ untested</td></tr>
<tr><td>message names new return warehouse</td><td>⬜ untested</td></tr>
<tr><td>message says to keep parcel aside</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · return warehouse · opname running on chosen rack)</td><td rowspan="2" valign="top">accept return</td><td>accept refused</td><td>⬜ untested</td></tr>
<tr><td>message names opname</td><td>⬜ untested</td></tr>
</table>

## Warnings

### brokens-on-rack-goes-against-a-business-decision

⚠ *brokens on rack* is written to match restock, where a broken unit may be thrown away or put on a rack. For a
return the owner decided the other way: a broken returned unit is **thrown away, never shelved**, because the stock
holds sellable units only, and shelving it is named as *not chosen*
([a-broken-returned-unit-is-thrown-away-at-the-door](../../business/inventory/return_decision.md#a-broken-returned-unit-is-thrown-away-at-the-door)).
The system follows that decision. The given stays 🚧 until the business owner settles which one holds.
