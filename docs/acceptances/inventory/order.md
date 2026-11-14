# Acceptance — inventory / order

Business: [order.md](../../business/inventory/order.md) · rules: [guide.md](../guide.md)

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
<tr><td rowspan="4" valign="top"><code>warehouse:all</code> wants to confirm an order<br>(status: pending · 1 order)</td><td rowspan="4" valign="top">confirm order</td><td>status changed from pending to processed</td><td>⬜ untested</td></tr>
<tr><td>confirm recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>selling team sees order processed</td><td>⬜ untested</td></tr>
<tr><td>order can be changed to picked</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top"><code>warehouse:all</code> wants to confirm an order<br>(status: pending · multi orders)</td><td rowspan="3" valign="top">confirm order</td><td>status of every order changed from pending to processed</td><td>⬜ untested</td></tr>
<tr><td>confirm recorded in each order timeline</td><td>⬜ untested</td></tr>
<tr><td>selling team sees every order processed</td><td>⬜ untested</td></tr>
<tr><td rowspan="7" valign="top"><code>warehouse:all</code> wants to pick an order<br>(status: processed · 1 product · 1 rack · opened by receipt scan · all items scanned)</td><td rowspan="7" valign="top">pick order</td><td>pick page opens from receipt scan</td><td>⬜ untested</td></tr>
<tr><td>pick page shows 1 rack for 1 product</td><td>⬜ untested</td></tr>
<tr><td>every scanned item correct</td><td>⬜ untested</td></tr>
<tr><td>status changed from processed to picked</td><td>⬜ untested</td></tr>
<tr><td>pick recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>selling team sees order picked</td><td>⬜ untested</td></tr>
<tr><td>order can be changed to shipping</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>warehouse:all</code> wants to pick an order<br>(status: processed · 1 product · 2 racks · all items scanned)</td><td rowspan="2" valign="top">pick order</td><td>pick page shows 2 racks with quantity of each</td><td>⬜ untested</td></tr>
<tr><td>status changed from processed to picked</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>warehouse:all</code> wants to pick an order<br>(status: processed · item not on order scanned)</td><td rowspan="2" valign="top">pick order</td><td>scan refused with wrong sound</td><td>⬜ untested</td></tr>
<tr><td>cannot set picked</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>warehouse:all</code> wants to pick an order<br>(status: processed · more items than ordered scanned)</td><td rowspan="2" valign="top">pick order</td><td>scan refused with wrong sound</td><td>⬜ untested</td></tr>
<tr><td>item count stays at ordered quantity</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>warehouse:all</code> wants to pick an order<br>(status: processed · not every item scanned)</td><td rowspan="1" valign="top">pick order</td><td>cannot set picked</td><td>⬜ untested</td></tr>
</table>
