# Acceptance — product / cross

Another team's products, found on **Discover Product** (`/products/discover`) and sold on one's own orders, under the owner's
cross markup and lock ([catalogue](catalogue.md)): the **division** each product carries, and the **Discover Product** screen
and a product's page there. Selling another team's product on an order is [order](../inventory/order.md#create). Business:
[context.md](../../business/product/context.md) · rules: [guide.md](../guide.md)

## division

A product is **Prioritas**, **Riset** or **Umum**, set per product; Discover Product opens on Prioritas.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">1</td><td rowspan="2" valign="top"><code>selling:all</code> wants to find products to sell<br>(products of other teams · some Prioritas, some Riset, some Umum)</td><td rowspan="2" valign="top">open discover product</td><td>only Prioritas products shown at first</td><td>🚧 unimplemented</td></tr>
<tr><td>each product shows its division badge: Prioritas, Riset or Umum</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>selling:all</code> wants to find products to sell<br>(products of other teams · some Prioritas, some Riset, some Umum · filter: Prioritas)</td><td rowspan="1" valign="top">filter discover product</td><td>only Prioritas products shown</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:all</code> wants to find products to sell<br>(products of other teams · some Prioritas, some Riset, some Umum · filter: Riset)</td><td rowspan="1" valign="top">filter discover product</td><td>only Riset products shown</td><td>🚧 unimplemented</td></tr>
</table>

> 📝 **The division is not in the business context yet.** It was asked for on the Discover Product screen (2026-10-26,
> [discover-opens-on-priority](../../technical/frontend/products_decision.md#discover-opens-on-priority)): Prioritas ·
> Riset · Umum, set per product, Discover Product opening on Prioritas. The chips and the product badges are on screen but marked
> pending — the pick narrows nothing and the badges are samples. The system has only a **team** flag,
> `Team.priority_product`, set by root (how is not designed yet): every product of such a team is priority, and there
> is no Riset. Per product with three values against per team with two is recorded as a contradiction in that decision.
> Who sets a product's division, and where, is not designed.

## discover product

Every selling role finds other teams' products on Discover Product — each product with its stock and its cross price, a locked one
marked — and opens one to read it, never its cost.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top">4</td><td rowspan="3" valign="top"><code>selling:all</code> wants to find products to sell<br>(products of other teams · one always locked · one under its minimum stock)</td><td rowspan="3" valign="top">open discover product</td><td>each product shows its ready stock, its ongoing stock and its cross price</td><td>⬜ untested</td></tr>
<tr><td>the always locked one marked Locked</td><td>⬜ untested</td></tr>
<tr><td>the one under its minimum marked Locked · Min N</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:all</code> wants to find products to sell<br>(products of other teams · search "Kopi")</td><td rowspan="1" valign="top">filter discover product</td><td>only products whose name or code matches</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>selling:all</code> wants to find products to sell<br>(products of several teams · filter: owner selling team Melati)</td><td rowspan="1" valign="top">filter discover product</td><td>only team Melati's products</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>selling:all</code> wants to find products to sell<br>(products of other teams and of its own · filter: hide own products)</td><td rowspan="1" valign="top">filter discover product</td><td>the team's own products not listed</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">8</td><td rowspan="2" valign="top"><code>selling:all</code> wants to find products to sell<br>(products with ready stock in warehouse A or warehouse B · filter: warehouse A)</td><td rowspan="2" valign="top">filter discover product</td><td>only products with ready stock in warehouse A</td><td>⬜ untested</td></tr>
<tr><td>each product shows warehouse A's stock</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">9</td><td rowspan="1" valign="top"><code>selling:all</code> wants to find products to sell<br>(products with ready stock 5, 20 and 80 · filter: ready stock 10–50)</td><td rowspan="1" valign="top">filter discover product</td><td>only the product with ready stock 20</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">10</td><td rowspan="1" valign="top"><code>selling:all</code> wants to find products to sell<br>(products with cross prices Rp 8.000, Rp 15.000 and Rp 25.000 · filter: cross price Rp 10.000–20.000)</td><td rowspan="1" valign="top">filter discover product</td><td>only the product with cross price Rp 15.000</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">11</td><td rowspan="1" valign="top"><code>selling:all</code> wants to find products to sell<br>(category Minuman with a subcategory Kopi · filter: category Minuman)</td><td rowspan="1" valign="top">filter discover product</td><td>the products of Minuman and of Kopi</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">12</td><td rowspan="1" valign="top"><code>selling:all</code> wants to find products to sell<br>(one product always locked · one under its minimum stock · one open · filter: lock Locked)</td><td rowspan="1" valign="top">filter discover product</td><td>only the two other teams cannot order now</td><td>⬜ untested</td></tr>
<tr><td rowspan="5" valign="top">13</td><td rowspan="5" valign="top"><code>selling:all</code> wants to find products to sell<br>(another team's product)</td><td rowspan="5" valign="top">open discover product detail</td><td>its photos</td><td>⬜ untested</td></tr>
<tr><td>its cross price per warehouse, never its cost or its markup</td><td>⬜ untested</td></tr>
<tr><td>its stock history, without prices or names</td><td>⬜ untested</td></tr>
<tr><td>its suppliers, without costs</td><td>⬜ untested</td></tr>
<tr><td>its stock in and out per day</td><td>⬜ untested</td></tr>
</table>
