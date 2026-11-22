# Acceptance — inventory / placement

The **Rak** screens: the list (`/inventories/racks`) — the warehouse's racks by the code painted on each, with what they
hold — and one rack (`/inventories/racks/:id`) with its products, its history, and its two acts: moving goods to other
racks and recording a sample. An owner and an admin set racks up; every member of the warehouse, staff included, moves
goods and records a sample; a selling team never sees them. Goods put on a rack at an accept are the accept's, checked
in [restock](restock.md) and [order](order.md). Business: [placement_decision.md](../../business/inventory/placement_decision.md)
· rules: [guide.md](../guide.md)

## racks

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">1</td><td rowspan="2" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to set up the racks<br>(code "A-01-1" · no name)</td><td rowspan="2" valign="top">create rack</td><td>rack listed as "a-01-1"</td><td>✅ ok</td></tr>
<tr><td>"empty" on its row</td><td>✅ ok</td></tr>
<tr><td rowspan="2" valign="top">2</td><td rowspan="2" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to set up the racks<br>(code already used in this warehouse)</td><td rowspan="2" valign="top">create rack</td><td>cannot create rack</td><td>✅ ok</td></tr>
<tr><td>message says the code already exists</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to set up the racks<br>(rack a-01-1 · name changed)</td><td rowspan="1" valign="top">edit rack</td><td>rack shows the new name</td><td>✅ ok</td></tr>
<tr><td rowspan="2" valign="top">4</td><td rowspan="2" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to set up the racks<br>(empty rack)</td><td rowspan="2" valign="top">delete rack</td><td>rack gone from the list</td><td>✅ ok</td></tr>
<tr><td>its code can be used again</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to set up the racks<br>(rack holds 5 units)</td><td rowspan="1" valign="top">delete rack</td><td>delete refused, message says to move the stock off first</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to set up the racks<br>(rack in a running opname)</td><td rowspan="1" valign="top">delete rack</td><td>delete refused</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>warehouse:staff</code> wants to set up the racks<br>(code "A-01-2")</td><td rowspan="1" valign="top">create rack</td><td>cannot create rack</td><td>✅ ok</td></tr>
<tr><td rowspan="2" valign="top">8</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to see the racks<br>(3 racks · 1 empty · 12 units on 2)</td><td rowspan="2" valign="top">open racks</td><td>racks 3 · holding stock 2 · empty 1 · 12 pcs</td><td>✅ ok</td></tr>
<tr><td>only the empty rack marked "empty"</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">9</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to see the racks<br>(search "a-01")</td><td rowspan="1" valign="top">filter racks</td><td>only matching racks listed</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">10</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see the racks<br>(selling team with goods in the warehouse)</td><td rowspan="1" valign="top">open racks</td><td>cannot see racks</td><td>✅ ok</td></tr>
</table>

## rack

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="1" valign="top">11</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to see what is on a rack<br>(2 products · 5 and 3 units)</td><td rowspan="1" valign="top">open rack</td><td>each product with its units and value</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">12</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to see what is on a rack<br>(a restock accepted onto it · 1 move · 1 sample)</td><td rowspan="1" valign="top">open rack</td><td>each shown in its history with the change and what is on the shelf after</td><td>✅ ok</td></tr>
<tr><td rowspan="3" valign="top">13</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to tidy the racks<br>(rack A: 4 units · all to rack C)</td><td rowspan="3" valign="top">move goods in rack</td><td>A −4, C +4</td><td>✅ ok</td></tr>
<tr><td>batches and value unchanged</td><td>✅ ok</td></tr>
<tr><td>move in both racks' history with who moved it</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">14</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to tidy the racks<br>(rack A: 6 units · 4 to C, 2 to D)</td><td rowspan="1" valign="top">move goods in rack</td><td>C +4, D +2</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">15</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to tidy the racks<br>(product in a running opname)</td><td rowspan="1" valign="top">move goods in rack</td><td>move refused, message says it is being counted</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">16</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to tidy the racks<br>(moving 2 products · 1 of them taken by an order while the dialog is open)</td><td rowspan="1" valign="top">move goods in rack</td><td>nothing moved, both stay on the rack</td><td>✅ ok</td></tr>
<tr><td rowspan="3" valign="top">17</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to give a sample<br>(rack A: 5 units · 1 to Pak Budi)</td><td rowspan="3" valign="top">record sample</td><td>rack A 4</td><td>✅ ok</td></tr>
<tr><td>ready stock down by 1</td><td>✅ ok</td></tr>
<tr><td>sample in the rack's history with who received it</td><td>✅ ok</td></tr>
</table>
