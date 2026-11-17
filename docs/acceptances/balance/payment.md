# Acceptance — balance / payment

The team that owes makes a payment with its proof; the team owed confirms or rejects it. Business:
[context.md](../../business/balance/context.md) · rules: [guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="5" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to pay a debt<br>(owes 1 warehouse · 1 proof · operational account)</td><td rowspan="5" valign="top">make payment</td><td>payment recorded as pending</td><td>⬜ untested</td></tr>
<tr><td>liability balance unchanged until confirmed</td><td>⬜ untested</td></tr>
<tr><td>operational account balance unchanged until confirmed</td><td>⬜ untested</td></tr>
<tr><td>warehouse sees pending payment with proof</td><td>⬜ untested</td></tr>
<tr><td>payment can be cancelled until accepted</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to pay a debt<br>(owes 1 warehouse · 1 proof · operational account · warehouse tell to make payment)</td><td rowspan="1" valign="top">make payment</td><td>tell to make payment cleared</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to pay a debt<br>(owes nothing to the warehouse)</td><td rowspan="2" valign="top">make payment</td><td>payment refused</td><td>⬜ untested</td></tr>
<tr><td>message says team owes nothing</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to pay a debt<br>(owes 1 warehouse · no proof)</td><td rowspan="1" valign="top">make payment</td><td>cannot make payment</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to pay a debt<br>(owes 1 warehouse · amount more than debt · 1 proof · operational account)</td><td rowspan="1" valign="top">make payment</td><td>payment recorded as pending</td><td>⬜ untested</td></tr>
</table>
