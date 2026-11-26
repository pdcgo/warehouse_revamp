# Acceptance — supplier / manage

**My Supplier**: a selling team's own suppliers — the vendors it buys from, each with its online stores — created,
changed and deleted by its owner and admin. A warehouse has no supplier. A supplier one team keeps is found by every
other selling team on **Discover Supplier** and can be named on any team's restock. Business:
[context.md](../../business/supplier/context.md) · [decisions](../../business/supplier/context_decision.md) · rules:
[guide.md](../guide.md)

## create

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top">1</td><td rowspan="3" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to buy from a new supplier<br>(name "PT Sumber Makmur" · contact · address)</td><td rowspan="3" valign="top">create supplier</td><td>shown in My Supplier</td><td>⬜ untested</td></tr>
<tr><td>other teams find it in Discover Supplier</td><td>⬜ untested</td></tr>
<tr><td>can be chosen for a restock by this team and by other teams, named with the team that keeps it</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to buy from a new supplier<br>(a name only · no contact, address or description)</td><td rowspan="1" valign="top">create supplier</td><td>created, shown in My Supplier with its name only</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to buy from a new supplier<br>(no store yet)</td><td rowspan="1" valign="top">create supplier</td><td>on a restock it can be chosen with "no store, bought offline" already picked</td><td>⬜ untested</td></tr>
</table>
