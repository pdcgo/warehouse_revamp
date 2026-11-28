# Acceptance — teams / warehouse_hours

A warehouse's **hours**: when it receives orders and when the building is open, each a weekly grid, plus its one-off
**closures** (a holiday) and its location. The warehouse's owner and admin set them in their own Settings, root and the
administrator on Teams → Edit warehouse. A selling team's order into a closed warehouse is still created, with a warning
naming the next opening; a warehouse with no hours set is not closed. Business:
[a-closed-day-warns-and-never-refuses](../../business/teams/warehouse/context_decision.md#a-closed-day-warns-and-never-refuses) ·
[a-warehouse-records-its-holidays](../../business/teams/warehouse/context_decision.md#a-warehouse-records-its-holidays) ·
[a-warehouse-with-no-hours-is-not-closed](../../business/teams/warehouse/context_decision.md#a-warehouse-with-no-hours-is-not-closed) ·
[the-warehouse-sets-its-own-hours-in-settings](../../business/teams/warehouse/context_decision.md#the-warehouse-sets-its-own-hours-in-settings) · rules:
[guide.md](../guide.md)

## set up

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="1" valign="top">1</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to set their hours<br>(no hours set)</td><td rowspan="1" valign="top">open settings</td><td>prompt to set hours</td><td>✅ ok</td></tr>
<tr><td rowspan="3" valign="top">2</td><td rowspan="3" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to set their hours<br>(receiving Mon–Sat 08:00–17:00)</td><td rowspan="3" valign="top">set receiving hours</td><td>Settings shows new hours</td><td>✅ ok</td></tr>
<tr><td>prompt gone</td><td>✅ ok</td></tr>
<tr><td>root's Edit warehouse shows same hours</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to set their hours<br>(operating Mon–Sun 07:00–20:00)</td><td rowspan="1" valign="top">set operating hours</td><td>warehouse profile shows new hours</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to record a holiday<br>(30 Mar – 6 Apr · "Idul Fitri")</td><td rowspan="1" valign="top">add closure</td><td>closure listed in Settings</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to record a holiday<br>(closure listed)</td><td rowspan="1" valign="top">delete closure</td><td>closure gone from Settings</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to set their location<br>(new address)</td><td rowspan="1" valign="top">set location</td><td>warehouse profile shows new location</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>warehouse:staff</code> wants to set their hours<br>(no hours set)</td><td rowspan="1" valign="top">open settings</td><td>no hours editor</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">8</td><td rowspan="1" valign="top"><code>root:administrator</code> wants to set a warehouse's hours<br>(receiving Mon–Sat 08:00–17:00)</td><td rowspan="1" valign="top">set receiving hours</td><td>warehouse's Settings shows same hours</td><td>✅ ok</td></tr>
</table>

## order warning

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">9</td><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(warehouse with no hours set)</td><td rowspan="2" valign="top">create order</td><td>no closed warning</td><td>✅ ok</td></tr>
<tr><td>picker shows no badge</td><td>✅ ok</td></tr>
<tr><td rowspan="3" valign="top">10</td><td rowspan="3" valign="top"><code>selling:all</code> wants to create an order<br>(warehouse closed now · opens Sat 08:00)</td><td rowspan="3" valign="top">create order</td><td>warning names next opening</td><td>✅ ok</td></tr>
<tr><td>picker badges warehouse</td><td>✅ ok</td></tr>
<tr><td>order created</td><td>✅ ok</td></tr>
<tr><td rowspan="2" valign="top">11</td><td rowspan="2" valign="top"><code>selling:all</code> wants to create an order<br>(warehouse in closure "Idul Fitri")</td><td rowspan="2" valign="top">create order</td><td>warning names Idul Fitri and the opening after it</td><td>✅ ok</td></tr>
<tr><td>order created</td><td>✅ ok</td></tr>
</table>
