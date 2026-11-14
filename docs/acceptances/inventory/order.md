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
</table>
