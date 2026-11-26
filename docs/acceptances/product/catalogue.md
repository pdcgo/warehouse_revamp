# Acceptance — product / catalogue

A selling team's own products: its owner and admin create, edit, archive, restore and delete them; a warehouse owns no
product and a CS does not change the catalogue. A product's code is the team's code in front of the part typed
(`ABC-SHOE-42`), unique over every product, archived ones included. Its cross markup and its **lock** — *open*, *under a
minimum stock* (other teams stop ordering while the stock in every warehouse is under it; the team's own orders never
stop), or *always locked* — are set at create and changed by edit, both checked here; a lock stops only new orders. How
another team finds and sells it belongs to cross. Business: [context.md](../../business/product/context.md) ·
[decisions](../../business/product/context_decision.md) · rules: [guide.md](../guide.md)

## create

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="5" valign="top">1</td><td rowspan="5" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to sell a new product<br>(team code ABC · code SHOE-42 · name · category · 2 images)</td><td rowspan="5" valign="top">create product</td><td>product created with code ABC-SHOE-42, the team's code put in front</td><td>⬜ untested</td></tr>
<tr><td>shown in the product list, the first photo as its main photo</td><td>⬜ untested</td></tr>
<tr><td>can be chosen for a restock or a bundle</td><td>⬜ untested</td></tr>
<tr><td>can be chosen for an order, shown with stock 0</td><td>⬜ untested</td></tr>
<tr><td>can be chosen when mapping a borrowed product for returns</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to sell a new product<br>(team code ABC · code SHOE-42 · ABC-SHOE-42 already used by another product, archived ones included)</td><td rowspan="1" valign="top">create product</td><td>cannot create, says the code is taken</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to sell a new product<br>(no image)</td><td rowspan="1" valign="top">create product</td><td>shown in the product list without a main photo</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to sell a new product<br>(lock: open · cross markup 12.5%)</td><td rowspan="1" valign="top">create product</td><td>other teams find it in Discover with the 12.5% markup, and can order it</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to sell a new product<br>(lock: always locked)</td><td rowspan="1" valign="top">create product</td><td>other teams cannot find it in Discover</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">6</td><td rowspan="3" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to sell a new product<br>(lock: under minimum stock 10 · stock 0, as every new product)</td><td rowspan="3" valign="top">create product</td><td>marked Terkunci</td><td>⬜ untested</td></tr>
<tr><td>other teams cannot order it</td><td>⬜ untested</td></tr>
<tr><td>other teams can order it later, once its stock in all warehouses reaches 10</td><td>⬜ untested</td></tr>
</table>

## edit

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to fix a product's details<br>(name changed · main photo changed)</td><td rowspan="1" valign="top">edit product</td><td>the new name and main photo shown in the product list and when choosing a product for a restock, an order or a bundle</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">8</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to fix a product's details<br>(category changed from A to B)</td><td rowspan="1" valign="top">edit product</td><td>listed under category B</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">9</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to fix a product's details<br>(team code ABC · code changed to SHOE-43 · the product never used)</td><td rowspan="1" valign="top">edit product</td><td>code becomes ABC-SHOE-43</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">10</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to fix a product's details<br>(code changed · the product already in a restock, an order or stock)</td><td rowspan="1" valign="top">edit product</td><td>cannot change the code, says it is fixed once used</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">11</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to fix a product's details<br>(the product already in a restock, an order or stock · only the name changed)</td><td rowspan="1" valign="top">edit product</td><td>saved, code unchanged</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">12</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to fix a product's details<br>(cross markup changed from 12.5% to 15% · orders already made by other teams)</td><td rowspan="2" valign="top">edit product</td><td>other teams see 15% in Discover</td><td>⬜ untested</td></tr>
<tr><td>orders already made keep 12.5%</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">13</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to fix a product's details<br>(lock: open → always locked · orders already made by other teams)</td><td rowspan="2" valign="top">edit product</td><td>other teams cannot find it in Discover</td><td>⬜ untested</td></tr>
<tr><td>their orders already made go on</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">14</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to fix a product's details<br>(lock: always locked → open)</td><td rowspan="1" valign="top">edit product</td><td>other teams find it in Discover again</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">15</td><td rowspan="3" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to fix a product's details<br>(lock: minimum stock 5 → 10 · total stock in all warehouses 8)</td><td rowspan="3" valign="top">edit product</td><td>marked Terkunci</td><td>⬜ untested</td></tr>
<tr><td>other teams cannot order it</td><td>⬜ untested</td></tr>
<tr><td>the team's own orders still go through</td><td>⬜ untested</td></tr>
</table>
