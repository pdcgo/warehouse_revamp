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
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to check the shelves against the system<br>(plan: one rack · rack A holds product X · product X also on rack B)</td><td rowspan="1" valign="top">create opname</td><td>product X counted on rack B too</td><td>⬜ untested</td></tr>
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
<tr><td rowspan="2" valign="top">15</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to count a rack<br>(rack A · product Y not in rack A's list · product Y on rack B in system)</td><td rowspan="2" valign="top">add found product</td><td>product Y added on rack A at 0 in system</td><td>⬜ untested</td></tr>
<tr><td>product Y on rack B joins the count</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">16</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to count a rack<br>(rack A · product Z · its team never had it in this warehouse)</td><td rowspan="1" valign="top">add found product</td><td>product Z not offered to pick, only products this warehouse has held</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">17</td><td rowspan="3" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants a row counted again<br>(rack A · product X counted · drafts written)</td><td rowspan="3" valign="top">send back row</td><td>row back to not counted</td><td>⬜ untested</td></tr>
<tr><td>its count and drafts cleared</td><td>⬜ untested</td></tr>
<tr><td>product X needs to be counted again</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">18</td><td rowspan="2" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants a row counted again<br>(rack A · product X counted 3 · recounted 4 · no third count left · marked counted)</td><td rowspan="2" valign="top">send back row</td><td>row back to not counted</td><td>⬜ untested</td></tr>
<tr><td>product X needs to be counted again, with one recount</td><td>⬜ untested</td></tr>
</table>

## finalize

An owner or admin who counted nothing in the count settles it: broken and lost are recorded at their batch price and the
warehouse owes the selling team for them, a surplus first claims an old loss back, a −1 and a +1 of one product is a move.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top">19</td><td rowspan="3" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to settle a count<br>(every row counted · all match the system)</td><td rowspan="3" valign="top">finalize opname</td><td>count finalized, status finished</td><td>⬜ untested</td></tr>
<tr><td>says it only releases the racks, no stock or debt changes</td><td>⬜ untested</td></tr>
<tr><td>the counted products can be ordered again</td><td>⬜ untested</td></tr>
<tr><td rowspan="6" valign="top">20</td><td rowspan="6" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to settle a count<br>(product X 5 in system · counted 3 · 1 broken · 1 lost · reasons written)</td><td rowspan="6" valign="top">finalize opname</td><td>preview shows what posts and what the warehouse owes, before confirming</td><td>⬜ untested</td></tr>
<tr><td>ready stock of product X decreases by 2</td><td>⬜ untested</td></tr>
<tr><td>broken 1 and lost 1 recorded at their batch price</td><td>⬜ untested</td></tr>
<tr><td>the warehouse owes the selling team for broken and lost</td><td>⬜ untested</td></tr>
<tr><td>stock loss on the warehouse's daily statement</td><td>⬜ untested</td></tr>
<tr><td>recorded in lost stock analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">21</td><td rowspan="3" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to settle a count<br>(product X · rack A 1 under · rack B 1 over)</td><td rowspan="3" valign="top">finalize opname</td><td>recorded as a move between racks, no debt changes</td><td>⬜ untested</td></tr>
<tr><td>ready stock of product X unchanged</td><td>⬜ untested</td></tr>
<tr><td>rack A and rack B corrected</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">22</td><td rowspan="2" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to settle a count<br>(product X 1 over · an old lost of product X not found yet · the warehouse owes the selling team)</td><td rowspan="2" valign="top">finalize opname</td><td>the surplus claims the old loss, back into its batch at its price</td><td>⬜ untested</td></tr>
<tr><td>the warehouse's debt to the selling team decreases</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">23</td><td rowspan="3" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to settle a count<br>(product X 1 over · no old loss · product X's newest batch here at Rp 10.000)</td><td rowspan="3" valign="top">finalize opname</td><td>a new batch at Rp 10.000</td><td>⬜ untested</td></tr>
<tr><td>ready stock of product X increases by 1</td><td>⬜ untested</td></tr>
<tr><td>no debt between the warehouse and the selling team changes</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">24</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to settle a count<br>(a row not counted yet)</td><td rowspan="1" valign="top">finalize opname</td><td>finalize not offered, says how many rows are left</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">25</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to settle a count<br>(this owner or admin counted a row in this count)</td><td rowspan="1" valign="top">finalize opname</td><td>cannot finalize, says another owner or admin finalizes</td><td>⬜ untested</td></tr>
</table>

> 📝 **An order created but not yet picked** — its units left the system when the order was created, but they are still
> on the rack until they are picked. A count that runs before the pick finds them as a **surplus**, and finalizing would
> post it. Nothing in the system checks for this: the rule is to start a count once order processing is done
> ([a-count-starts-when-order-processing-is-done](../../business/inventory/opname_decision.md#a-count-starts-when-order-processing-is-done)).
> Orders already created keep being confirmed, picked and handed over during a count; only a new order and a cancel are
> refused.

## cancel

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top">26</td><td rowspan="3" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to call a count off<br>(count active · some rows counted)</td><td rowspan="3" valign="top">cancel opname</td><td>status cancelled</td><td>⬜ untested</td></tr>
<tr><td>no stock or debt changes, the counts dropped</td><td>⬜ untested</td></tr>
<tr><td>the counted products can be ordered again</td><td>⬜ untested</td></tr>
</table>

## found

Units found on a rack outside a count are reported — from the rack page, or by an owner or admin through Adjust — and
wait until another owner or admin approves them. Approved, they first claim an old loss back, else they become a new
batch. A count that counts the same product on the same rack closes the waiting report. A lost order's parcel that comes
back is [order's report found](order.md#problem-and-lost).

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top">27</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to put found units back in stock<br>(rack A · product X · 2 found · note)</td><td rowspan="3" valign="top">report found</td><td>found report waiting, with its note</td><td>⬜ untested</td></tr>
<tr><td>ready stock of product X unchanged until approved</td><td>⬜ untested</td></tr>
<tr><td>shows on Found Stock for the owner and admin to decide</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">28</td><td rowspan="2" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to put found units back in stock<br>(product X · rack A · 2 found · note)</td><td rowspan="2" valign="top">adjust found</td><td>the found units are sent for approval, and ready stock of product X stays the same until they are approved</td><td>⬜ untested</td></tr>
<tr><td>waits to be approved by another owner or admin, not the one who sent it</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top">29</td><td rowspan="4" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to decide on a found report<br>(2 of product X found on rack A · an old lost of 2 product X not found yet · the warehouse owes the selling team)</td><td rowspan="4" valign="top">approve found</td><td>status approved</td><td>⬜ untested</td></tr>
<tr><td>ready stock of product X on rack A increases by 2</td><td>⬜ untested</td></tr>
<tr><td>the units claim the old loss, back into its batch at its price</td><td>⬜ untested</td></tr>
<tr><td>the warehouse's debt to the selling team decreases</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">30</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to decide on a found report<br>(2 of product X found on rack A · an old lost of 2 product X not found yet · the warehouse's debt for the 2 lost product X already paid)</td><td rowspan="1" valign="top">approve found</td><td>the selling team owes the warehouse the value of the 2 units</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">31</td><td rowspan="3" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to decide on a found report<br>(2 of product X found on rack A · no old loss · product X's newest batch here at Rp 10.000)</td><td rowspan="3" valign="top">approve found</td><td>a new batch at Rp 10.000</td><td>⬜ untested</td></tr>
<tr><td>ready stock of product X increases by 2</td><td>⬜ untested</td></tr>
<tr><td>no debt between the warehouse and the selling team changes</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">32</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to decide on a found report<br>(this owner or admin reported it)</td><td rowspan="1" valign="top">approve found</td><td>cannot approve their own report</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">33</td><td rowspan="2" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to decide on a found report<br>(found report waiting · reason)</td><td rowspan="2" valign="top">reject found</td><td>status rejected, the reason shown to the reporter</td><td>⬜ untested</td></tr>
<tr><td>no stock or debt changes</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">34</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to take back a found report<br>(own found report waiting · reason)</td><td rowspan="2" valign="top">cancel own found report</td><td>status withdrawn, cancelled by the reporter</td><td>⬜ untested</td></tr>
<tr><td>no stock or debt changes</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">35</td><td rowspan="2" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to settle a count<br>(found report of 2 product X on rack A waiting · the count found product X on rack A 2 over)</td><td rowspan="2" valign="top">finalize opname</td><td>found report closed, settled by the count</td><td>⬜ untested</td></tr>
<tr><td>ready stock of product X rises by 2 once, through the count, not again through the report</td><td>⬜ untested</td></tr>
</table>
