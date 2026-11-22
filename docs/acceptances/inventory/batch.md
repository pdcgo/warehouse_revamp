# Acceptance — inventory / batch

A batch is one product's units that came in together at one price — one per product in each accepted restock, and
made by a return or a transfer too. The **Batch** screens (`/inventories/batches`, `/inventories/batches/:id`) are the
warehouse's, staff included: the list with what is left, its value and when it expires, and one batch with its
lifecycle, where it was put away and its history. A batch with nothing left keeps its row, marked *depleted* (*Habis* on
the Indonesian screen). The selling team sees its own batches on the product page, and its
owner and admin correct a batch's price there with a reason. *Adjust* on a batch is Stock Adjust —
[adjustment](adjustment.md). Business: [batch.md](../../business/inventory/batch.md) · rules: [guide.md](../guide.md)

## batches

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top">1</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to find a batch<br>(restock accepted today: 10 units at Rp 10.000 · expires 27 Nov)</td><td rowspan="3" valign="top">open batches</td><td>batch listed with the restock it came from</td><td>⬜ untested</td></tr>
<tr><td>ready 10 · Rp 10.000 a pc · ready value Rp 100.000</td><td>⬜ untested</td></tr>
<tr><td>expires 27 Nov, with the days left</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to find a batch<br>(a batch with nothing left)</td><td rowspan="1" valign="top">open batches</td><td>"depleted" on its row</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to find a batch<br>(2 batches expire within 30 days)</td><td rowspan="1" valign="top">open batches</td><td>2 batches counted as expiring within 30 days</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to find a batch<br>(its product on rack A and rack B)</td><td rowspan="1" valign="top">open batches</td><td>both racks on its row</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to find a batch<br>(batches of 2 teams · team Melati)</td><td rowspan="1" valign="top">filter batches</td><td>only Melati's batches</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to find a batch<br>(expiring soon)</td><td rowspan="1" valign="top">filter batches</td><td>only batches expiring within 30 days</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to find a batch<br>(arrived 1–7 Nov)</td><td rowspan="1" valign="top">filter batches</td><td>only batches arrived that week</td><td>⬜ untested</td></tr>
</table>

## batch

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="1" valign="top">8</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to see a batch<br>(arrived 10 · 2 broken · 1 lost · 7 ready)</td><td rowspan="1" valign="top">open batch</td><td>arrived 10 = broken 2 + lost 1 + used 0 + ready 7</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">9</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to see a batch<br>(put away 6 on rack A and 4 on rack B when accepted · later all moved to rack C)</td><td rowspan="1" valign="top">open batch</td><td>put away at accept still shows rack A 6 and rack B 4, not rack C</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">10</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to see a batch<br>(from restock #503 · accepted by Rudi)</td><td rowspan="1" valign="top">open batch</td><td>from restock #503, accepted by Rudi</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">11</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to see a batch<br>(3 sold · 1 lost at an opname)</td><td rowspan="1" valign="top">open batch</td><td>each in its history with the change and ready after</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">12</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to see a batch<br>(made by a return)</td><td rowspan="1" valign="top">open batch</td><td>from a return</td><td>⬜ untested</td></tr>
</table>

## correct price

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top">13</td><td rowspan="3" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to correct a batch's price<br>(7 ready at Rp 10.000 · new price Rp 11.000 · reason)</td><td rowspan="3" valign="top">correct batch price</td><td>unit cost Rp 11.000</td><td>⬜ untested</td></tr>
<tr><td>ready value up by Rp 7.000</td><td>⬜ untested</td></tr>
<tr><td>correction in the batch's history with its reason</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">14</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to correct a batch's price<br>(7 ready at Rp 10.000 · new price Rp 11.000 · no reason)</td><td rowspan="1" valign="top">correct batch price</td><td>cannot correct</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">15</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to correct a batch's price<br>(batch with nothing left)</td><td rowspan="1" valign="top">correct batch price</td><td>cannot correct</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">16</td><td rowspan="1" valign="top"><code>selling:cs</code> · <code>warehouse:all</code> wants to correct a batch's price<br>(7 ready at Rp 10.000)</td><td rowspan="1" valign="top">correct batch price</td><td>cannot correct price</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">17</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see its batches<br>(product stocked in 2 warehouses)</td><td rowspan="1" valign="top">open product</td><td>each batch with its warehouse, ready and cost</td><td>⬜ untested</td></tr>
</table>
