# Acceptance — inventory / restock

Business: [restock.md](../../business/inventory/restock.md) · rules: [guide.md](../guide.md)

## create

The selling team orders goods for a warehouse, and changes the restock while it can.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="6" valign="top">1</td><td rowspan="6" valign="top"><code>selling:all</code> wants to restock<br>(1 product · 1 warehouse · operational account · no shipping cost)</td><td rowspan="6" valign="top">create restock</td><td>restock created with 1 product</td><td>✅ ok</td></tr>
<tr><td>1 product recorded at warehouse</td><td>✅ ok</td></tr>
<tr><td>ongoing stock of 1 product increases</td><td>✅ ok</td></tr>
<tr><td>operational account balance decreases by product total</td><td>✅ ok</td></tr>
<tr><td>recorded in operational account history</td><td>✅ ok</td></tr>
<tr><td>restock recorded in analytic metric</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="6" valign="top">2</td><td rowspan="6" valign="top"><code>selling:all</code> wants to restock<br>(2 products · 1 warehouse · operational account · no shipping cost)</td><td rowspan="6" valign="top">create restock</td><td>restock created with 2 products</td><td>✅ ok</td></tr>
<tr><td>2 products recorded at warehouse</td><td>✅ ok</td></tr>
<tr><td>ongoing stock of 2 products increases</td><td>✅ ok</td></tr>
<tr><td>operational account balance decreases by product total</td><td>✅ ok</td></tr>
<tr><td>recorded in operational account history</td><td>✅ ok</td></tr>
<tr><td>restock recorded in analytic metric</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="6" valign="top">3</td><td rowspan="6" valign="top"><code>selling:all</code> wants to restock<br>(1 product · 1 warehouse · operational account · shipping cost)</td><td rowspan="6" valign="top">create restock</td><td>restock created with 1 product and shipping cost</td><td>✅ ok</td></tr>
<tr><td>1 product recorded at warehouse</td><td>✅ ok</td></tr>
<tr><td>ongoing stock of 1 product increases</td><td>✅ ok</td></tr>
<tr><td>operational account balance decreases by product total + shipping cost</td><td>✅ ok</td></tr>
<tr><td>recorded in operational account history</td><td>✅ ok</td></tr>
<tr><td>restock recorded in analytic metric</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="8" valign="top">4</td><td rowspan="8" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 1 product · add product · 1 warehouse · operational account)</td><td rowspan="8" valign="top">edit restock</td><td>new product added</td><td>✅ ok</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>ongoing total adjusted</td><td>✅ ok</td></tr>
<tr><td>total warehouse receive changes</td><td>✅ ok</td></tr>
<tr><td>paying account balance adjusted (decrease)</td><td>✅ ok</td></tr>
<tr><td>edit recorded in account history</td><td>✅ ok</td></tr>
<tr><td>edit recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td>restock analytic metric adjusted</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="8" valign="top">5</td><td rowspan="8" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 1 product · change product · 1 warehouse · operational account)</td><td rowspan="8" valign="top">edit restock</td><td>restock shows new count, total and note</td><td>✅ ok</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>ongoing total adjusted</td><td>✅ ok</td></tr>
<tr><td>total warehouse receive changes</td><td>✅ ok</td></tr>
<tr><td>paying account balance adjusted (decrease/increase)</td><td>✅ ok</td></tr>
<tr><td>edit recorded in account history</td><td>✅ ok</td></tr>
<tr><td>edit recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td>restock analytic metric adjusted</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="8" valign="top">6</td><td rowspan="8" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 2 products · remove product · 1 warehouse · operational account)</td><td rowspan="8" valign="top">edit restock</td><td>product removed</td><td>✅ ok</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>ongoing total adjusted</td><td>✅ ok</td></tr>
<tr><td>total warehouse receive changes</td><td>✅ ok</td></tr>
<tr><td>paying account balance adjusted (increase)</td><td>✅ ok</td></tr>
<tr><td>edit recorded in account history</td><td>✅ ok</td></tr>
<tr><td>edit recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td>restock analytic metric adjusted</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">7</td><td rowspan="2" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 1 product · change supplier and store · 1 warehouse · operational account)</td><td rowspan="2" valign="top">edit restock</td><td>restock shows new supplier and store</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td rowspan="5" valign="top">8</td><td rowspan="5" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 1 product · change warehouse · 2 warehouses · operational account)</td><td rowspan="5" valign="top">edit restock</td><td>restock shows new warehouse</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>recorded at new warehouse</td><td>⬜ untested</td></tr>
<tr><td>removed from old warehouse</td><td>⬜ untested</td></tr>
<tr><td>restock analytic metric adjusted</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="7" valign="top">9</td><td rowspan="7" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 1 product · change account · 1 warehouse · 2 operational accounts)</td><td rowspan="7" valign="top">edit restock</td><td>restock shows new account</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>old account balance back up</td><td>⬜ untested</td></tr>
<tr><td>new account balance decreases</td><td>⬜ untested</td></tr>
<tr><td>move recorded in old account history</td><td>⬜ untested</td></tr>
<tr><td>move recorded in new account history</td><td>⬜ untested</td></tr>
<tr><td>move recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">10</td><td rowspan="3" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 1 product · change order ID, courier, tracking and receipt photo · 1 warehouse · operational account)</td><td rowspan="3" valign="top">edit restock</td><td>restock shows new order ID, courier, tracking and photo</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>target warehouse sees new courier and tracking</td><td>⬜ untested</td></tr>
<tr><td rowspan="6" valign="top">11</td><td rowspan="6" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 1 product · change shipping cost · 1 warehouse · operational account)</td><td rowspan="6" valign="top">edit restock</td><td>restock shows new shipping cost</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>paying account balance follows difference</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in account history</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td>restock analytic metric adjusted</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="3" valign="top">12</td><td rowspan="3" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 1 product · change restock note · 1 warehouse · operational account)</td><td rowspan="3" valign="top">edit restock</td><td>restock shows new note</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>target warehouse sees new note</td><td>⬜ untested</td></tr>
<tr><td rowspan="8" valign="top">13</td><td rowspan="8" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: arrived · 1 product · add product · 1 warehouse · operational account)</td><td rowspan="8" valign="top">edit restock</td><td>new product added</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>ongoing total adjusted</td><td>⬜ untested</td></tr>
<tr><td>total warehouse receive changes</td><td>⬜ untested</td></tr>
<tr><td>paying account balance adjusted (decrease)</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in account history</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td>restock analytic metric adjusted</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="8" valign="top">14</td><td rowspan="8" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: arrived · 1 product · change product · 1 warehouse · operational account)</td><td rowspan="8" valign="top">edit restock</td><td>restock shows new count, total and note</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>ongoing total adjusted</td><td>⬜ untested</td></tr>
<tr><td>total warehouse receive changes</td><td>⬜ untested</td></tr>
<tr><td>paying account balance adjusted (decrease/increase)</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in account history</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td>restock analytic metric adjusted</td><td>🚧 unimplemented</td></tr>
</table>

## receive

The warehouse signs for the box, counts it in, and corrects a count found wrong afterwards.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top">15</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to receive a restock<br>(status: ongoing · no COD)</td><td rowspan="3" valign="top">mark arrived restock</td><td>status changed from ongoing to arrived</td><td>✅ ok</td></tr>
<tr><td>receiver and time recorded</td><td>✅ ok</td></tr>
<tr><td>can print barcode</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">16</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to receive a restock<br>(status: lost · no COD)</td><td rowspan="3" valign="top">mark arrived restock</td><td>status changed from lost to arrived</td><td>✅ ok</td></tr>
<tr><td>receiver and time recorded</td><td>✅ ok</td></tr>
<tr><td>can print barcode</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">17</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to receive a restock<br>(status: ongoing · COD)</td><td rowspan="2" valign="top">mark arrived restock</td><td>COD recorded on restock</td><td>🚧 unimplemented</td></tr>
<tr><td>can print barcode</td><td>⬜ untested</td></tr>
<tr><td rowspan="10" valign="top">18</td><td rowspan="10" valign="top"><code>warehouse:all</code> wants to accept a restock<br>(status: arrived · all received · new product · no COD · 1 supplier)</td><td rowspan="10" valign="top">accept restock</td><td>status changed from arrived to accepted</td><td>✅ ok</td></tr>
<tr><td>ready stock increases by all received</td><td>✅ ok</td></tr>
<tr><td>ongoing stock decreases by all received</td><td>✅ ok</td></tr>
<tr><td>all received on rack</td><td>✅ ok</td></tr>
<tr><td>price set on batch</td><td>✅ ok</td></tr>
<tr><td>recorded in product history</td><td>⬜ untested</td></tr>
<tr><td>new product listed in warehouse</td><td>⬜ untested</td></tr>
<tr><td>recorded at 1 supplier</td><td>⬜ untested</td></tr>
<tr><td>can print barcode</td><td>⬜ untested</td></tr>
<tr><td>all received recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="11" valign="top">19</td><td rowspan="11" valign="top"><code>warehouse:all</code> wants to accept a restock<br>(status: ongoing · all received · new product · no COD · 1 supplier)</td><td rowspan="11" valign="top">accept restock</td><td>status changed from ongoing to accepted</td><td>✅ ok</td></tr>
<tr><td>ready stock increases by all received</td><td>✅ ok</td></tr>
<tr><td>ongoing stock decreases by all received</td><td>✅ ok</td></tr>
<tr><td>all received on rack</td><td>✅ ok</td></tr>
<tr><td>price set on batch</td><td>✅ ok</td></tr>
<tr><td>receiver and time recorded</td><td>✅ ok</td></tr>
<tr><td>recorded in product history</td><td>⬜ untested</td></tr>
<tr><td>new product listed in warehouse</td><td>✅ ok</td></tr>
<tr><td>recorded at 1 supplier</td><td>✅ ok</td></tr>
<tr><td>can print barcode</td><td>⬜ untested</td></tr>
<tr><td>all received recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top">20</td><td rowspan="4" valign="top"><code>warehouse:all</code> wants to accept a restock<br>(status: ongoing · brokens thrown away · new product · no COD · 1 supplier)</td><td rowspan="4" valign="top">accept restock</td><td>status changed from ongoing to accepted</td><td>✅ ok</td></tr>
<tr><td>ready stock increases, brokens excluded</td><td>✅ ok</td></tr>
<tr><td>brokens thrown away recorded</td><td>✅ ok</td></tr>
<tr><td>brokens recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">21</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to accept a restock<br>(status: ongoing · brokens on rack · new product · no COD · 1 supplier)</td><td rowspan="2" valign="top">accept restock</td><td>brokens on rack</td><td>🚧 unimplemented</td></tr>
<tr><td>brokens recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top">22</td><td rowspan="4" valign="top"><code>warehouse:all</code> wants to accept a restock<br>(status: ongoing · missing items · new product · no COD · 1 supplier)</td><td rowspan="4" valign="top">accept restock</td><td>status changed from ongoing to accepted</td><td>✅ ok</td></tr>
<tr><td>ready stock increases, missing items excluded</td><td>✅ ok</td></tr>
<tr><td>missing items recorded</td><td>✅ ok</td></tr>
<tr><td>missing items recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">23</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to accept a restock<br>(status: ongoing · all received · listed product · no COD · 1 supplier)</td><td rowspan="2" valign="top">accept restock</td><td>listed product not listed again</td><td>✅ ok</td></tr>
<tr><td>all received recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">24</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to accept a restock<br>(status: ongoing · all received · new product · COD · 1 supplier)</td><td rowspan="3" valign="top">accept restock</td><td>COD recorded on restock</td><td>✅ ok</td></tr>
<tr><td>COD recorded in liability</td><td>✅ ok</td></tr>
<tr><td>COD recorded in analytic metric</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">25</td><td><code>warehouse:all</code> wants to accept a restock<br>(status: ongoing · all received · new product · no COD · multi suppliers)</td><td>accept restock</td><td>recorded at each supplier</td><td>✅ ok</td></tr>
<tr><td rowspan="9" valign="top">26</td><td rowspan="9" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to correct a received count<br>(status: accepted · all received · received count too high · 1 product · 1 rack · 1 supplier)</td><td rowspan="9" valign="top">correct received count restock</td><td>restock shows corrected received count</td><td>⬜ untested</td></tr>
<tr><td>correction recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>ready stock decreases</td><td>⬜ untested</td></tr>
<tr><td>stock on 1 rack decreases</td><td>⬜ untested</td></tr>
<tr><td>missing items increase</td><td>⬜ untested</td></tr>
<tr><td>selling team sees correction value</td><td>⬜ untested</td></tr>
<tr><td>correction recorded in product history</td><td>⬜ untested</td></tr>
<tr><td>missing items recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td>recorded at 1 supplier</td><td>⬜ untested</td></tr>
<tr><td rowspan="9" valign="top">27</td><td rowspan="9" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to correct a received count<br>(status: accepted · missing items · received count too low · 1 product · 1 rack · 1 supplier)</td><td rowspan="9" valign="top">correct received count restock</td><td>restock shows corrected received count</td><td>⬜ untested</td></tr>
<tr><td>correction recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>ready stock increases</td><td>⬜ untested</td></tr>
<tr><td>stock on 1 rack increases</td><td>⬜ untested</td></tr>
<tr><td>missing items decrease</td><td>⬜ untested</td></tr>
<tr><td>selling team sees correction value</td><td>⬜ untested</td></tr>
<tr><td>correction recorded in product history</td><td>⬜ untested</td></tr>
<tr><td>missing items recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td>recorded at 1 supplier</td><td>⬜ untested</td></tr>
</table>

## cancel and lost

The selling team ends a restock before the box arrives: it is called off, or given up as lost.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="8" valign="top">28</td><td rowspan="8" valign="top"><code>selling:all</code> wants to cancel a restock<br>(status: ongoing · money returned · 1 product · shipping cost · 1 warehouse · operational account)</td><td rowspan="8" valign="top">cancel restock<br><a href="#cancel-restock-is-still-to-be-checked">⚠ still to be checked</a></td><td>status changed from ongoing to cancelled</td><td>⬜ untested</td></tr>
<tr><td>cancel recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>ongoing stock of 1 product decreases</td><td>⬜ untested</td></tr>
<tr><td>target warehouse sees restock cancelled</td><td>⬜ untested</td></tr>
<tr><td>total warehouse receive decreases</td><td>⬜ untested</td></tr>
<tr><td>operational account balance increases by product total + shipping cost</td><td>⬜ untested</td></tr>
<tr><td>cancel recorded in operational account history</td><td>⬜ untested</td></tr>
<tr><td>cancel recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="6" valign="top">29</td><td rowspan="6" valign="top"><code>selling:all</code> wants to cancel a restock<br>(status: ongoing · money not returned · 1 product · shipping cost · 1 warehouse · operational account)</td><td rowspan="6" valign="top">cancel restock<br><a href="#cancel-restock-is-still-to-be-checked">⚠ still to be checked</a></td><td>status changed from ongoing to cancelled</td><td>⬜ untested</td></tr>
<tr><td>cancel recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>ongoing stock of 1 product decreases</td><td>⬜ untested</td></tr>
<tr><td>target warehouse sees restock cancelled</td><td>⬜ untested</td></tr>
<tr><td>total warehouse receive decreases</td><td>⬜ untested</td></tr>
<tr><td>operational account balance unchanged</td><td>⬜ untested</td></tr>
<tr><td rowspan="8" valign="top">30</td><td rowspan="8" valign="top"><code>selling:all</code> wants to report a lost restock<br>(status: ongoing · reason given · 1 product · 1 warehouse · operational account)</td><td rowspan="8" valign="top">mark lost restock</td><td>status changed from ongoing to lost</td><td>⬜ untested</td></tr>
<tr><td>lost recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>reason shown in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>ongoing stock of 1 product decreases</td><td>⬜ untested</td></tr>
<tr><td>target warehouse sees restock lost</td><td>⬜ untested</td></tr>
<tr><td>total warehouse receive decreases</td><td>⬜ untested</td></tr>
<tr><td>operational account balance unchanged</td><td>⬜ untested</td></tr>
<tr><td>lost recorded in analytic metric</td><td>🚧 unimplemented</td></tr>
</table>

## resolve

What happens after a problem: missing and broken units are settled with the supplier, a lost restock with the platform.

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="1" valign="top">31</td><td rowspan="1" valign="top"><code>selling:all</code> wants to follow up restock problems<br>(status: accepted · missing items · broken items)</td><td rowspan="1" valign="top">list problem restock</td><td>restock listed with missing and broken count</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">32</td><td rowspan="1" valign="top"><code>selling:all</code> wants to follow up lost restocks<br>(status: lost)</td><td rowspan="1" valign="top">list lost restock</td><td>restock listed in lost tab</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top">33</td><td rowspan="4" valign="top"><code>selling:all</code> wants to record the supplier's solution<br>(status: accepted · missing items · money refunded · operational account)</td><td rowspan="4" valign="top">resolve restock problem</td><td>solution recorded on restock</td><td>🚧 unimplemented</td></tr>
<tr><td>solution shown in restock timeline</td><td>🚧 unimplemented</td></tr>
<tr><td>operational account balance increases by refund</td><td>🚧 unimplemented</td></tr>
<tr><td>refund recorded in operational account history</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">34</td><td rowspan="2" valign="top"><code>selling:all</code> wants to record the supplier's solution<br>(status: accepted · broken items · goods resent)</td><td rowspan="2" valign="top">resolve restock problem</td><td>solution recorded on restock</td><td>🚧 unimplemented</td></tr>
<tr><td>resent goods arrive as new restock</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">35</td><td rowspan="2" valign="top"><code>selling:all</code> wants to record the platform's solution<br>(status: lost · money refunded · operational account)</td><td rowspan="2" valign="top">resolve lost restock</td><td>solution recorded on restock</td><td>🚧 unimplemented</td></tr>
<tr><td>operational account balance increases by refund</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="3" valign="top">36</td><td rowspan="3" valign="top"><code>selling:all</code> wants to record the supplier's solution<br>(status: accepted · 5 missing items · 3 resent · 2 refunded · operational account)</td><td rowspan="3" valign="top">resolve restock problem</td><td>both solutions recorded on restock</td><td>🚧 unimplemented</td></tr>
<tr><td>resent goods arrive as new restock</td><td>🚧 unimplemented</td></tr>
<tr><td>operational account balance increases by refund</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">37</td><td rowspan="1" valign="top"><code>selling:all</code> wants to record the supplier's solution<br>(status: accepted · 5 missing items · 3 resent · 2 not settled yet)</td><td rowspan="1" valign="top">resolve restock problem</td><td>restock stays listed with 2 missing left</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="3" valign="top">38</td><td rowspan="3" valign="top"><code>selling:all</code> wants to record the platform's solution<br>(status: lost · part refunded · rest resent · operational account)</td><td rowspan="3" valign="top">resolve lost restock</td><td>both solutions recorded on restock</td><td>🚧 unimplemented</td></tr>
<tr><td>operational account balance increases by refund</td><td>🚧 unimplemented</td></tr>
<tr><td>resent goods arrive as new restock</td><td>🚧 unimplemented</td></tr>
</table>

> 📝 **A note from a discussion (2026-11-16), not a decision.** Missing and broken units at the door are settled with
> the supplier, and a lost restock with the platform — by goods sent again, money back, or another way. The system
> should record it: the restocks with missing or broken units, the lost restocks, the solution, and its money in an
> account when there is any. Only the Lost tab exists today; nothing in the business docs asks for the rest yet, so
> these givens record the discussion as it stood. Goods sent again are proposed as a **new restock** that names the one
> it settles, so they are counted at the door like any other. One problem can be settled by **more than one solution**
> (part resent, part refunded), and a restock leaves the problem list only once every unit is covered.

## Warnings

### cancel-restock-is-still-to-be-checked

⚠ The cancel asks one question, *did the money come back?* Yes puts the whole amount, product total + shipping cost,
back into the operational account; no posts nothing. But money can come back in part, or more than was paid, and the
dialog warns *"Pembatalan restok akan diperiksa"* while nothing checks a cancel yet. Neither is decided here, so neither
has a given: cancel is expected to be reviewed, and perhaps changed, later. Until then the two cancel givens above check
the system as it is.
