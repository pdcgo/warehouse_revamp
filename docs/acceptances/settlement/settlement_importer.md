# Acceptance — settlement / settlement_importer

A shop's statement from the platform, uploaded on **Penyelesaian › Impor**: each row posts to the order its ref finds, or
to the shop. Business: [settlement_importer.md](../../business/settlement/settlement_importer.md) · rules:
[guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="4" valign="top">1</td><td rowspan="4" valign="top"><code>selling:all</code> wants to record the platform's payouts<br>(Shopee shop · statement · refs on orders of this shop)</td><td rowspan="4" valign="top">import settlement</td><td>payout shown in each order's settlement as from import</td><td>✅ ok</td></tr>
<tr><td>deductions shown after the payout arrives</td><td>✅ ok</td></tr>
<tr><td>report recorded by shop and period</td><td>✅ ok</td></tr>
<tr><td>recorded in settlement analytic metric</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>selling:all</code> wants to record the platform's payouts<br>(Shopee shop · statement · ref with no order)</td><td rowspan="1" valign="top">import settlement</td><td>row posted to the shop</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:all</code> wants to record the platform's payouts<br>(Shopee shop · statement · same file twice)</td><td rowspan="1" valign="top">import settlement</td><td>nothing posted twice</td><td>✅ ok</td></tr>
<tr><td rowspan="3" valign="top">4</td><td rowspan="3" valign="top"><code>selling:all</code> wants to record the platform's payouts<br>(Shopee shop · statement · ref on an order of another shop)</td><td rowspan="3" valign="top">import settlement</td><td>whole file refused</td><td>✅ ok</td></tr>
<tr><td>message names the other shop</td><td>✅ ok</td></tr>
<tr><td>nothing posted</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:all</code> wants to record the platform's payouts<br>(Shopee shop · statement · failed withdrawal and its return)</td><td rowspan="1" valign="top">import settlement</td><td>both skipped</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>selling:all</code> wants to record the platform's payouts<br>(TikTok shop · statement)</td><td rowspan="1" valign="top">import settlement</td><td>rows matched by related order ID</td><td>✅ ok</td></tr>
<tr><td rowspan="2" valign="top">7</td><td rowspan="2" valign="top"><code>selling:all</code> wants to record the platform's payouts<br>(Shopee shop · statement · page closed / reloaded / changed during import)</td><td rowspan="2" valign="top">import settlement</td><td>import still processed until finish</td><td>✅ ok</td></tr>
<tr><td>result shown in the import list</td><td>✅ ok</td></tr>
<tr><td rowspan="2" valign="top">8</td><td rowspan="2" valign="top"><code>selling:all</code> wants to record the platform's payouts<br>(Shopee shop · TikTok statement)</td><td rowspan="2" valign="top">import settlement</td><td>file refused</td><td>✅ ok</td></tr>
<tr><td>nothing posted</td><td>✅ ok</td></tr>
<tr><td rowspan="2" valign="top">9</td><td rowspan="2" valign="top"><code>selling:all</code> wants to record the platform's payouts<br>(Shopee shop · statement · successful withdrawal)</td><td rowspan="2" valign="top">import settlement</td><td>withdrawal recorded to the shop</td><td>✅ ok</td></tr>
<tr><td>withdrawal recorded in finance analytic metric</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">10</td><td rowspan="1" valign="top"><code>selling:all</code> wants to check what an import did<br>(Shopee shop · statement · imported)</td><td rowspan="1" valign="top">open import detail</td><td>each row shown with its result</td><td>✅ ok</td></tr>
</table>
