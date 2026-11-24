# Acceptance — inventory / opname

A **Stock Opname** checks the shelves against the system: the warehouse owner or admin starts a count over all racks, one
team, one product or one rack; the rows it takes are locked — goods do not move on them — until the count is finalized
or cancelled. One count runs per warehouse at a time. Business: [opname.md](../../business/inventory/opname.md) ·
[decisions](../../business/inventory/opname_decision.md) · rules: [guide.md](../guide.md)

## create

The owner or admin plans a count; its rows are taken from what the system records and locked.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="6" valign="top">1</td><td rowspan="6" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to check the shelves against the system<br>(plan: all racks · 3 racks, 1 of them empty · 1 product at 0 in system on its rack)</td><td rowspan="6" valign="top">create opname</td><td>count started, status active</td><td>⬜ untested</td></tr>
<tr><td>every rack listed, the empty one too</td><td>⬜ untested</td></tr>
<tr><td>a row per product on each rack, those at 0 in system included</td><td>⬜ untested</td></tr>
<tr><td>staff see its racks to count</td><td>⬜ untested</td></tr>
<tr><td>a product on a counted rack cannot be ordered, the refusal names the count</td><td>⬜ untested</td></tr>
<tr><td>nothing else can be done to it there: no transfer, move, sample, adjustment, put-away, found report or cancel</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">2</td><td rowspan="2" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to check the shelves against the system<br>(plan: one team · selling team Melati · another team's product on the same rack)</td><td rowspan="2" valign="top">create opname</td><td>only team Melati's products in the rows</td><td>⬜ untested</td></tr>
<tr><td>the other team's product not locked</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to check the shelves against the system<br>(plan: one product · on 2 racks)</td><td rowspan="1" valign="top">create opname</td><td>both racks listed with the product</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to check the shelves against the system<br>(plan: one rack · rack A holds product X · X also on rack B)</td><td rowspan="1" valign="top">create opname</td><td>X counted on rack B too</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to check the shelves against the system<br>(plan: one rack · the rack is empty)</td><td rowspan="1" valign="top">create opname</td><td>cannot start, nothing to count</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to check the shelves against the system<br>(an earlier count in this warehouse not yet finalized or cancelled)</td><td rowspan="1" valign="top">create opname</td><td>cannot start, names the earlier count</td><td>⬜ untested</td></tr>
</table>

## count

Anyone in the warehouse counts rack by rack, blind: the system figure shows only once a count is in, a difference
becomes a draft that needs its reason, and the owner or admin can send a counted row back.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">7</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to count a rack<br>(rack A · product X 5 in system · counted 5)</td><td rowspan="2" valign="top">count row</td><td>system figure shown only after the count is in</td><td>⬜ untested</td></tr>
<tr><td>says it matches the system, nothing to explain</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">8</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to count a rack<br>(rack A · product X 5 in system · counted 3)</td><td rowspan="3" valign="top">count row</td><td>system figure and difference −2 shown</td><td>⬜ untested</td></tr>
<tr><td>a lost draft of 2 from the system, waiting for its reason</td><td>⬜ untested</td></tr>
<tr><td>can count again one more time (recount once)</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">9</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to count a rack<br>(rack A · product X 5 in system · counted 7)</td><td rowspan="1" valign="top">count row</td><td>a surplus draft of 2, waiting for its reason</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">10</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to count a rack<br>(rack A · product X 5 in system · counted 3 · recounted 4)</td><td rowspan="2" valign="top">recount row</td><td>the recount replaces the count, difference −1</td><td>⬜ untested</td></tr>
<tr><td>cannot count a third time, recount once no longer shown</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top">11</td><td rowspan="4" valign="top"><code>warehouse:all</code> wants to count a rack<br>(rack A · product X 5 in system · counted 3 · 1 broken · reasons for broken and lost)</td><td rowspan="4" valign="top">mark row counted</td><td>row counted</td><td>⬜ untested</td></tr>
<tr><td>drafts broken 1 and lost 1, each with its reason</td><td>⬜ untested</td></tr>
<tr><td>read-only to the counter</td><td>⬜ untested</td></tr>
<tr><td>the admin sees it counted, with who counted it</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">12</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to count a rack<br>(rack A · product X 5 in system · counted 3 · no reason for lost)</td><td rowspan="1" valign="top">mark row counted</td><td>cannot mark counted, says every draft needs a reason</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">13</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to count a rack<br>(rack A · product X 5 in system · counted 7 · reason for surplus)</td><td rowspan="1" valign="top">mark row counted</td><td>surplus draft 2 with its reason</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">14</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to count a rack<br>(rack A · product X 5 in system · counted 5)</td><td rowspan="1" valign="top">mark row counted</td><td>row counted, no drafts</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">15</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to count a rack<br>(rack A · product Y not in rack A's list · Y on rack B in system)</td><td rowspan="2" valign="top">add found product</td><td>Y added on rack A at 0 in system</td><td>⬜ untested</td></tr>
<tr><td>Y on rack B joins the count</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">16</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to count a rack<br>(rack A · product Z · its team never had it in this warehouse)</td><td rowspan="1" valign="top">add found product</td><td>Z not offered to pick, only products this warehouse has held</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">17</td><td rowspan="3" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants a row counted again<br>(rack A · product X counted · drafts written)</td><td rowspan="3" valign="top">send back row</td><td>row back to not counted</td><td>⬜ untested</td></tr>
<tr><td>its count and drafts cleared</td><td>⬜ untested</td></tr>
<tr><td>product X needs to be counted again</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">18</td><td rowspan="2" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants a row counted again<br>(rack A · product X counted 3 · recounted 4 · no third count left · marked counted)</td><td rowspan="2" valign="top">send back row</td><td>row back to not counted</td><td>⬜ untested</td></tr>
<tr><td>product X needs to be counted again, with one recount</td><td>⬜ untested</td></tr>
</table>
