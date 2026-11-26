# Acceptance — product / pricing

A product has no one price: each **batch** has its unit price, set when a restock is accepted, and stock leaves oldest
batch first (FIFO). A restock line is typed as its total, as the invoice prints it; a batch's unit price is the line's
total over its units plus the shipping and the courier's charge at the door, spread over **every** unit of the restock
([unit-price-is-line-price-plus-costs-per-unit](../../business/inventory/restock_decision.md#unit-price-is-line-price-plus-costs-per-unit)). An order costs what leaves the shelf — the batches it takes; another team's
product costs that plus its cross markup. The whens belong to other features (accept restock, create order); here they
check the price. A batch's price correction is [batch](../inventory/batch.md), a transfer keeping its price
[warehouse_transfer](../inventory/warehouse_transfer.md), a return at the order's cost [order](../inventory/order.md#return).
Business: [context.md](../../business/product/context.md#unit-pricing-system) · rules: [guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="1" valign="top">1</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to accept a restock<br>(1 product · 10 units, line total Rp 100.000 · shipping Rp 20.000 · courier's charge at the door Rp 10.000)</td><td rowspan="1" valign="top">accept restock</td><td>batch unit price Rp 13.000: the shipping and the courier's charge spread over 10 units total</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to accept a restock<br>(product A 10 units, line total Rp 100.000 · product B 5 units, line total Rp 100.000 · shipping Rp 30.000)</td><td rowspan="1" valign="top">accept restock</td><td>the shipping spread over 15 units total: product A Rp 12.000, product B Rp 22.000</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to accept a restock<br>(product X already has a batch with price Rp 10.000 · the new restock brings a batch with price Rp 12.000)</td><td rowspan="1" valign="top">accept restock</td><td>the product list shows product X's cost range Rp 10.000 – Rp 12.000</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>selling:all</code> wants to create an order<br>(own product X · its oldest batch 3 left, with price Rp 10.000 · its next batch with price Rp 12.000 · 5 ordered)</td><td rowspan="1" valign="top">create order</td><td>order cost Rp 54.000: 3 from the oldest batch, 2 from the next</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:all</code> wants to create an order<br>(another team's product X · its batch with price Rp 10.000 · cross markup 10% <a href="#the-old-system-priced-cross-differently">📝</a> · 1 ordered)</td><td rowspan="1" valign="top">create order</td><td>order cost Rp 11.000, the 10% markup included</td><td>⬜ untested</td></tr>
</table>

<a id="the-old-system-priced-cross-differently"></a>

> 📝 **The old system priced a cross unit differently** (the owner, 2026-11-26): `cross price = round(100 × cost /
> (100 − markup %))` — the markup taken as a share of the cross price, not added on top of the cost. For a cost of
> Rp 10.000 at 10%: the old system Rp 11.111, this one Rp 11.000 — the cost plus 10% of it, exact and never rounded
> ([context.md](../../business/product/context.md#crossshared-fee-markup): `fee = UnitPrice × Fee Markup`; the same in
> the order's take and the screens). Given 5 follows this system's rule; the old formula is only recorded here.
