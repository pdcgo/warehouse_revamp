# Acceptance — inventory / return

The parcel comes back: customer service or the warehouse returns the order, the return warehouse accepts it — and the
stock half of the accept: the batches the return warehouse makes, the missing and broken units the selling team bears,
the note copied to the order. The **Retur** menu (`/inventories/returns`) is not checked here: it is a preview on
invented rows, built before the return flow was decided
([return_decision.md](../../business/inventory/return_decision.md)), and no decision asks for it yet. Rules:
[guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="5" valign="top">1</td><td rowspan="5" valign="top"><code>selling:all</code> wants to return an order<br>(status: shipped · 1 order · 1 return warehouse)</td><td rowspan="5" valign="top">return order</td><td>status changed from shipped to return</td><td>⬜ untested</td></tr>
<tr><td>return recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>return warehouse sees order return</td><td>⬜ untested</td></tr>
<tr><td>return recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td>return can be accepted</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>selling:all</code> wants to return an order<br>(status: shipping · 1 order)</td><td rowspan="1" valign="top">return order</td><td>status changed from shipping to return</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:all</code> wants to return an order<br>(status: problem · 1 order)</td><td rowspan="1" valign="top">return order</td><td>status changed from problem to return</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>selling:all</code> wants to return an order<br>(status: completed · 1 order)</td><td rowspan="1" valign="top">return order</td><td>status changed from completed to return</td><td>⬜ untested</td></tr>
<tr><td rowspan="5" valign="top">5</td><td rowspan="5" valign="top"><code>warehouse:all</code> wants to return an order<br>(status: shipped · 1 order · parcel in warehouse before return claimed)</td><td rowspan="5" valign="top">return order</td><td>status changed from shipped to return</td><td>⬜ untested</td></tr>
<tr><td>return recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>selling team sees order return</td><td>⬜ untested</td></tr>
<tr><td>return can be accepted</td><td>⬜ untested</td></tr>
<tr><td>stock unchanged until the return is accepted</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>selling:all</code> wants to return an order<br>(status: picked · 1 order)</td><td rowspan="1" valign="top">return order</td><td>cannot return order</td><td>⬜ untested</td></tr>
<tr><td rowspan="7" valign="top">7</td><td rowspan="7" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · all returned · 1 rack · return warehouse · no courier charge)</td><td rowspan="7" valign="top">accept return</td><td>status changed from return to return completed</td><td>⬜ untested</td></tr>
<tr><td>accept recorded in order timeline</td><td>⬜ untested</td></tr>
<tr><td>ready stock of 1 product increases at return warehouse</td><td>⬜ untested</td></tr>
<tr><td>stock on 1 rack increases</td><td>⬜ untested</td></tr>
<tr><td>recorded in product history</td><td>⬜ untested</td></tr>
<tr><td>selling team sees order return completed</td><td>⬜ untested</td></tr>
<tr><td>return arrival recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top">8</td><td rowspan="4" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · brokens thrown away · missing items · 1 rack · return warehouse)</td><td rowspan="4" valign="top">accept return</td><td>ready stock increases by good items only</td><td>⬜ untested</td></tr>
<tr><td>broken items thrown away</td><td>⬜ untested</td></tr>
<tr><td>missing items recorded</td><td>⬜ untested</td></tr>
<tr><td>broken and missing items shown in order timeline</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">9</td><td valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · brokens on rack · 1 rack · return warehouse)</td><td valign="top">accept return<br><a href="order.md#brokens-on-rack-goes-against-a-business-decision">⚠ against a business decision</a></td><td>brokens on rack</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">10</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · cross product · return map chosen · all returned · 1 rack · return warehouse)</td><td rowspan="2" valign="top">accept return</td><td>ready stock of mapped own product increases</td><td>⬜ untested</td></tr>
<tr><td>can print barcode of mapped own product</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">11</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · all returned · 1 rack · return warehouse · courier charge with note)</td><td rowspan="1" valign="top">accept return</td><td>courier charge recorded in liability to return warehouse</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">12</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · return warehouse changed after order created · parcel at old return warehouse)</td><td rowspan="3" valign="top">accept return</td><td>cannot accept return</td><td>⬜ untested</td></tr>
<tr><td>message names new return warehouse</td><td>⬜ untested</td></tr>
<tr><td>message says to keep parcel aside</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">13</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · return warehouse · opname running on chosen rack)</td><td rowspan="2" valign="top">accept return</td><td>accept refused</td><td>⬜ untested</td></tr>
<tr><td>message names opname</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">14</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · 3 units taken 2 from a Rp 10.000 batch and 1 from a Rp 12.000 batch · all returned · 1 rack · return warehouse)</td><td rowspan="2" valign="top">accept return</td><td>2 batches made, each with its price, expiry and supplier</td><td>⬜ untested</td></tr>
<tr><td>returned value Rp 32.000, the order's cost</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">15</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · cross product · return map chosen · borrowed at 20% markup · all returned · 1 rack · return warehouse)</td><td rowspan="2" valign="top">accept return</td><td>made at the price the team paid, markup included</td><td>⬜ untested</td></tr>
<tr><td>the lender's batches untouched</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">16</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · 3 units · 1 missing · 1 broken · 1 rack · return warehouse)</td><td rowspan="3" valign="top">accept return</td><td>missing unit taken off the newest batch</td><td>⬜ untested</td></tr>
<tr><td>missing and broken borne by the selling team, not the warehouse's debt</td><td>⬜ untested</td></tr>
<tr><td>not counted in lost stock</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">17</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to accept a return<br>(status: return · 1 product · own product · 1 broken · note "sobek di jahitan" · 1 rack · return warehouse)</td><td rowspan="1" valign="top">accept return</td><td>note copied onto the order's warehouse note</td><td>⬜ untested</td></tr>
</table>

> 📝 **Returns move to the warehouse's own screen** — the warehouse should manage returns at `/inventories/returns`, not
> through the order. A note for now, not a decision: the givens above follow today's flow, where a return is accepted on
> the order's page. It goes against
> [the-return-accept-page-is-accepted](../../business/inventory/return_decision.md#the-return-accept-page-is-accepted),
> which puts the accept at `/warehouse-orders/:orderId/accept-return`, opened from the pick page, the warehouse order
> detail and Receive a Return.

> 📝 These givens are the same as [order](order.md#return), ids 71–87 — a copy, so a change to one is made to
> the other too.
