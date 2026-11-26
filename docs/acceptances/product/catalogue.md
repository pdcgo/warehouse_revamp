# Acceptance — product / catalogue

A selling team's own products: its owner and admin create, edit, archive, restore and delete them; a warehouse owns no
product and a CS does not change the catalogue. A product's code is the team's code in front of the part typed
(`ABC-SHOE-42`), unique over every product, archived ones included. Its cross markup and its **lock** — *open*, *under a
minimum stock* (other teams stop ordering while the stock in every warehouse is under it; the team's own orders never
stop), or *always locked* — are set at create and changed by edit, both checked here; a lock stops only new orders, and a
locked product still shows on other teams' Discover Product, marked Locked, but cannot be chosen for their orders. How
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
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to sell a new product<br>(lock: open · cross markup 12.5%)</td><td rowspan="1" valign="top">create product</td><td>other teams find it in Discover Product with the 12.5% markup, and can order it</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">5</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to sell a new product<br>(lock: always locked)</td><td rowspan="2" valign="top">create product</td><td>other teams see it on Discover Product marked Locked</td><td>⬜ untested</td></tr>
<tr><td>other teams cannot choose it when making an order</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">6</td><td rowspan="3" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to sell a new product<br>(lock: under minimum stock 10 · stock 0, as every new product)</td><td rowspan="3" valign="top">create product</td><td>marked Locked</td><td>⬜ untested</td></tr>
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
<tr><td rowspan="2" valign="top">12</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to fix a product's details<br>(cross markup changed from 12.5% to 15% · orders already made by other teams)</td><td rowspan="2" valign="top">edit product</td><td>other teams see 15% in Discover Product</td><td>⬜ untested</td></tr>
<tr><td>orders already made keep 12.5%</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">13</td><td rowspan="3" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to fix a product's details<br>(lock: open → always locked · orders already made by other teams)</td><td rowspan="3" valign="top">edit product</td><td>other teams see it on Discover Product marked Locked</td><td>⬜ untested</td></tr>
<tr><td>other teams cannot choose it when making an order</td><td>⬜ untested</td></tr>
<tr><td>their orders already made go on</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">14</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to fix a product's details<br>(lock: always locked → open)</td><td rowspan="2" valign="top">edit product</td><td>the Locked mark gone on Discover Product</td><td>⬜ untested</td></tr>
<tr><td>other teams can choose it again when making an order</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">15</td><td rowspan="3" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to fix a product's details<br>(lock: minimum stock 5 → 10 · total stock in all warehouses 8)</td><td rowspan="3" valign="top">edit product</td><td>marked Locked</td><td>⬜ untested</td></tr>
<tr><td>other teams cannot order it</td><td>⬜ untested</td></tr>
<tr><td>the team's own orders still go through</td><td>⬜ untested</td></tr>
</table>

## archive and delete

A product in use is archived, never deleted: it leaves the list and the pickers and can come back. Only a product never
used is deleted, and its code is free again.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top">16</td><td rowspan="3" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to stop using a product<br>(the product still has stock on a rack)</td><td rowspan="3" valign="top">archive product</td><td>gone from the product list, and cannot be chosen for a restock, an order or a bundle</td><td>⬜ untested</td></tr>
<tr><td>its stock on the rack and its history stay as they are</td><td>⬜ untested</td></tr>
<tr><td>a warehouse holding it still sees it, labelled archived</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">17</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to use a product again<br>(an archived product)</td><td rowspan="1" valign="top">restore product</td><td>back in the product list and can be chosen again, with the same code</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">18</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to remove a product made by mistake<br>(the product never used)</td><td rowspan="2" valign="top">delete product</td><td>product deleted</td><td>⬜ untested</td></tr>
<tr><td>its code can be used again</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">19</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to remove a product made by mistake<br>(the product already in a restock, an order or stock)</td><td rowspan="1" valign="top">delete product</td><td>cannot delete, says to archive it instead</td><td>⬜ untested</td></tr>
</table>
