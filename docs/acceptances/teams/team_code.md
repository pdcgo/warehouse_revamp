# Acceptance — teams / team_code

A team's **code** — the prefix in front of every product code it owns (`ABC-SHOE-42`). Its owner and admin change it in
Settings, and the root team's administrator on the Teams page; the team's products then take the new code and are tagged `need_reprint_code`, since their printed stickers no
longer match, until each warehouse holding their stock reprints the labels. Business: [a-team-code-change-recomposes-its-product-codes](../../business/product/context_decision.md#a-team-code-change-recomposes-its-product-codes) ·
[products-have-their-own-tag-list](../../business/product/context_decision.md#products-have-their-own-tag-list) · rules:
[guide.md](../guide.md)

## edit

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="9" valign="top">1</td><td rowspan="9" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to change their team's code<br>(team code ABC · changed to XYZ · 2 products · past orders and restocks · 1 warehouse holding stock)</td><td rowspan="9" valign="top">edit team code</td><td>team code becomes XYZ</td><td>✅ ok</td></tr>
<tr><td>codes of 2 products start with XYZ</td><td>✅ ok</td></tr>
<tr><td>2 products tagged <code>need_reprint_code</code></td><td>✅ ok</td></tr>
<tr><td>Products list filtered by <code>need_reprint_code</code> shows 2 products</td><td>✅ ok</td></tr>
<tr><td>product history shows old code and new code</td><td>✅ ok</td></tr>
<tr><td>Teams list shows XYZ</td><td>✅ ok</td></tr>
<tr><td>other teams see new codes on Discover Product</td><td>✅ ok</td></tr>
<tr><td>past orders and restocks keep old code</td><td>✅ ok</td></tr>
<tr><td>warehouse holding stock sees <code>need_reprint_code</code></td><td>✅ ok</td></tr>
<tr><td rowspan="9" valign="top">2</td><td rowspan="9" valign="top"><code>root:administrator</code> wants to change a selling team's code<br>(team code ABC · changed to XYZ · 2 products · past orders and restocks · 1 warehouse holding stock)</td><td rowspan="9" valign="top">edit team code</td><td>team code becomes XYZ</td><td>✅ ok</td></tr>
<tr><td>codes of 2 products start with XYZ</td><td>✅ ok</td></tr>
<tr><td>2 products tagged <code>need_reprint_code</code></td><td>✅ ok</td></tr>
<tr><td>Products list filtered by <code>need_reprint_code</code> shows 2 products</td><td>✅ ok</td></tr>
<tr><td>product history shows old code and new code</td><td>✅ ok</td></tr>
<tr><td>team's Settings shows XYZ</td><td>✅ ok</td></tr>
<tr><td>other teams see new codes on Discover Product</td><td>✅ ok</td></tr>
<tr><td>past orders and restocks keep old code</td><td>✅ ok</td></tr>
<tr><td>warehouse holding stock sees <code>need_reprint_code</code></td><td>✅ ok</td></tr>
</table>

## reprint

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="4" valign="top">3</td><td rowspan="4" valign="top"><code>warehouse:all</code> wants to reprint changed product codes<br>(2 products tagged <code>need_reprint_code</code> · stock on 3 shelf spots)</td><td rowspan="4" valign="top">reprint product code</td><td>3 labels printed, each with its new XYZ code, shelf spot and quantity</td><td>✅ ok</td></tr>
<tr><td>2 products no longer tagged <code>need_reprint_code</code></td><td>✅ ok</td></tr>
<tr><td>owning team's Products list filtered by <code>need_reprint_code</code> shows none</td><td>✅ ok</td></tr>
<tr><td>reprint shows only tagged products</td><td>✅ ok</td></tr>
<tr><td rowspan="2" valign="top">4</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to reprint changed product codes<br>(1 product tagged <code>need_reprint_code</code> · stock in 2 warehouses · only 1 has printed)</td><td rowspan="2" valign="top">reprint product code</td><td>product still tagged <code>need_reprint_code</code></td><td>✅ ok</td></tr>
<tr><td>other warehouse still sees it in its reprint</td><td>✅ ok</td></tr>
</table>
