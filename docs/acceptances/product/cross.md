# Acceptance — product / cross

Another team's products, found on **Discover** (`/products/discover`) and sold on one's own orders, under the owner's
cross markup and lock ([catalogue](catalogue.md)). Only the **division** part is written so far. Business:
[context.md](../../business/product/context.md) · rules: [guide.md](../guide.md)

## division

A product is **Prioritas**, **Riset** or **Umum**, set per product; Discover opens on Prioritas.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">1</td><td rowspan="2" valign="top"><code>selling:all</code> wants to find products to sell<br>(products of other teams · some Prioritas, some Riset, some Umum)</td><td rowspan="2" valign="top">open discover</td><td>only Prioritas products shown at first</td><td>🚧 unimplemented</td></tr>
<tr><td>each card shows its division badge: Prioritas, Riset or Umum</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>selling:all</code> wants to find products to sell<br>(products of other teams · some Prioritas, some Riset, some Umum · filter: Prioritas)</td><td rowspan="1" valign="top">filter discover</td><td>only Prioritas products shown</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:all</code> wants to find products to sell<br>(products of other teams · some Prioritas, some Riset, some Umum · filter: Riset)</td><td rowspan="1" valign="top">filter discover</td><td>only Riset products shown</td><td>🚧 unimplemented</td></tr>
</table>

> 📝 **The division is not in the business context yet.** It was asked for on the Discover screen (2026-10-26,
> [discover-opens-on-priority](../../technical/frontend/products_decision.md#discover-opens-on-priority)): Prioritas ·
> Riset · Umum, set per product, Discover opening on Prioritas. The chips and the card badges are on screen but marked
> pending — the pick narrows nothing and the badges are samples. The system has only a **team** flag,
> `Team.priority_product`, set by root (how is not designed yet): every product of such a team is priority, and there
> is no Riset. Per product with three values against per team with two is recorded as a contradiction in that decision.
> Who sets a product's division, and where, is not designed.
