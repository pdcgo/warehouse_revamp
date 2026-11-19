# Acceptance — balance / credit_limit

How much a team may owe the team it owes. A team's own limit is set on that team's page (`/liability/:id`, **Terms**);
the default for every team without one is **Default Terms** on the liability list. Empty is unlimited, 0 is no credit.
Business: [context.md](../../business/balance/context.md) · rules: [guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top">1</td><td rowspan="3" valign="top"><code>warehouse:owner</code> wants to cap a team's debt<br>(1 selling team · no limit before)</td><td rowspan="3" valign="top">set credit limit</td><td>limit shown on the team</td><td>⬜ untested</td></tr>
<tr><td>limit recorded in history</td><td>⬜ untested</td></tr>
<tr><td>selling team sees the limit set on it</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>warehouse:owner</code> wants to cap a team's debt<br>(default limit · team without its own limit)</td><td rowspan="1" valign="top">set credit limit</td><td>every team without its own limit follows the default</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>warehouse:owner</code> wants to cap a team's debt<br>(1 selling team · limit 0)</td><td rowspan="1" valign="top">set credit limit</td><td>the team cannot create orders with this warehouse</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>warehouse:owner</code> wants to cap a team's debt<br>(1 selling team · debt at 80% of the new limit)</td><td rowspan="1" valign="top">set credit limit</td><td>warning shown on liability and in the order form</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to cap a team's debt<br>(1 selling team owes product fee · no limit before)</td><td rowspan="1" valign="top">set credit limit</td><td>limit shown on the team</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>warehouse:owner</code> wants to cap a team's debt<br>(1 selling team · at limit · limit raised)</td><td rowspan="1" valign="top">set credit limit</td><td>the team can create orders again</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>warehouse:owner</code> wants to cap a team's debt<br>(1 selling team · limit lowered below debt)</td><td rowspan="1" valign="top">set credit limit</td><td>the team cannot create orders with this warehouse</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">8</td><td rowspan="1" valign="top"><code>warehouse:owner</code> wants to cap a team's debt<br>(default limit · team set to no limit)</td><td rowspan="1" valign="top">set credit limit</td><td>the team's own limit is used, not the default</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">9</td><td rowspan="2" valign="top"><code>warehouse:owner</code> wants to lift a team's own limit<br>(team limit · default set)</td><td rowspan="2" valign="top">remove credit limit</td><td>the team follows the default again</td><td>⬜ untested</td></tr>
<tr><td>removal recorded in history</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">10</td><td rowspan="1" valign="top"><code>warehouse:owner</code> wants to lift a team's own limit<br>(team limit · no default)</td><td rowspan="1" valign="top">remove credit limit</td><td>the team has no limit</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">11</td><td rowspan="1" valign="top"><code>selling:all</code> wants to create an order<br>(at credit limit · payment pending)</td><td rowspan="1" valign="top">create order</td><td>order refused until the payment is confirmed</td><td>⬜ untested</td></tr>
</table>
