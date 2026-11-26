# Acceptance — product / bundle

A **bundle** is a recipe — "Paket Hemat = product A × 1 + product B × 2" — used only while an order is filled in: picked,
it puts its products on the order, and the order keeps the products, never the bundle. Any selling role creates one,
the CS included; the owner and admin change or delete any bundle, a CS only the ones it created. Another team's product
can be added while it is open to other teams. Business: [product_bundle.md](../../business/product/product_bundle.md) ·
[decisions](../../business/product/product_bundle_decision.md) · rules: [guide.md](../guide.md)

## set up

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">1</td><td rowspan="2" valign="top"><code>selling:all</code> wants to sell products as a package<br>(name "Paket Hemat" · product A × 1 · product B × 2)</td><td rowspan="2" valign="top">create bundle</td><td>the bundle shown on Bundles with its 2 products: A × 1, B × 2</td><td>⬜ untested</td></tr>
<tr><td>can be chosen when making an order</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>selling:all</code> wants to sell products as a package<br>(another team's product, open to other teams)</td><td rowspan="1" valign="top">create bundle</td><td>it can be added to the bundle</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:all</code> wants to sell products as a package<br>(another team's product, locked by its owner)</td><td rowspan="1" valign="top">create bundle</td><td>it cannot be added to the bundle</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>selling:all</code> wants to sell products as a package<br>(name "Paket Hemat" already used by another bundle)</td><td rowspan="1" valign="top">create bundle</td><td>a second Paket Hemat shown on Bundles</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">5</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to fix a bundle<br>(Paket Hemat · product B changed from × 2 to × 3 · orders already made with it)</td><td rowspan="2" valign="top">edit bundle</td><td>the bundle shows product B × 3</td><td>⬜ untested</td></tr>
<tr><td>orders made before keep their products</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>selling:cs</code> wants to fix a bundle<br>(bundle made by the same CS who edits it · a product's quantity changed)</td><td rowspan="1" valign="top">edit bundle</td><td>the bundle shows the CS's change</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>selling:cs</code> wants to fix a bundle<br>(bundle made by another person)</td><td rowspan="1" valign="top">edit bundle</td><td>cannot edit, the bundle read-only with "only the person who created it, or an admin, can change this bundle"</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">8</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to fix a bundle<br>(a product in the bundle locked by its owner since it was added · another product changed)</td><td rowspan="1" valign="top">edit bundle</td><td>the locked product stays in the bundle when saving</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">9</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to remove a bundle<br>(Paket Hemat · orders already made with it)</td><td rowspan="2" valign="top">delete bundle</td><td>bundle deleted, gone from Bundles and cannot be chosen when making an order</td><td>⬜ untested</td></tr>
<tr><td>orders made with it keep their products</td><td>⬜ untested</td></tr>
</table>

## order

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">10</td><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(bundle Paket Hemat: product A × 1, product B × 2 · 3 bundles ordered)</td><td rowspan="2" valign="top">add bundle to order</td><td>the order gets 3 of product A and 6 of product B</td><td>⬜ untested</td></tr>
<tr><td>the order keeps the products, not the bundle</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">11</td><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(bundle Paket Hemat · product B another team's, locked by its owner now · 1 bundle ordered)</td><td rowspan="2" valign="top">add bundle to order</td><td>product B's slot shown unavailable</td><td>⬜ untested</td></tr>
<tr><td>the slot can be filled with another product, up to its quantity × the bundles ordered</td><td>⬜ untested</td></tr></table>
