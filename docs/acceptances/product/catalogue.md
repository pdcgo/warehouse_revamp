# Acceptance — product / catalogue

A selling team's own products: its owner and admin create, edit, archive, restore and delete them; a warehouse owns no
product and a CS does not change the catalogue. A product's code is the team's code in front of the part typed
(`ABC-SHOE-42`), unique over every product, archived ones included. What a product is set to at create — its cross
markup, whether other teams may sell it, its reserved stock — is checked here; changing it later belongs to
[cross](context.md) and pricing. Business: [context.md](../../business/product/context.md) ·
[decisions](../../business/product/context_decision.md) · rules: [guide.md](../guide.md)

## create

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="4" valign="top">1</td><td rowspan="4" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to sell a new product<br>(team code ABC · code SHOE-42 · name · category · 2 images)</td><td rowspan="4" valign="top">create product</td><td>product created with code ABC-SHOE-42, the team's code put in front</td><td>⬜ untested</td></tr>
<tr><td>listed in the team's products, the first image as its cover</td><td>⬜ untested</td></tr>
<tr><td>offered when picking a product for a restock, an order and a bundle</td><td>⬜ untested</td></tr>
<tr><td>offered when mapping a borrowed product for returns</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to sell a new product<br>(team code ABC · code SHOE-42 · ABC-SHOE-42 already used by another product, archived ones included)</td><td rowspan="1" valign="top">create product</td><td>cannot create, says the code is taken</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to sell a new product<br>(no image)</td><td rowspan="1" valign="top">create product</td><td>listed without a cover image</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to sell a new product<br>(cross markup 12.5% · cross not locked)</td><td rowspan="1" valign="top">create product</td><td>other teams find it in Discover, with the 12.5% markup</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to sell a new product<br>(cross locked)</td><td rowspan="1" valign="top">create product</td><td>not offered to other teams in Discover</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to sell a new product<br>(reserved stock 2)</td><td rowspan="1" valign="top">create product</td><td>2 units never offered for sale: available is the stock less 2</td><td>⬜ untested</td></tr>
</table>
