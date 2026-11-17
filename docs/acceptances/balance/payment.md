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
<tr><td rowspan="2" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to pay a debt<br>(owes 1 selling team · after overpayment · 1 proof · operational account)</td><td rowspan="2" valign="top">make payment</td><td>payment recorded as pending</td><td>⬜ untested</td></tr>
<tr><td>selling team sees pending payment with proof</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to pay a debt<br>(owes 1 cross team · product fee · 1 proof · operational account)</td><td rowspan="2" valign="top">make payment</td><td>payment recorded as pending</td><td>⬜ untested</td></tr>
<tr><td>cross team sees pending payment with proof</td><td>⬜ untested</td></tr>
<tr><td rowspan="6" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to accept a payment<br>(pending · amount equals debt · into operational account)</td><td rowspan="6" valign="top">confirm payment</td><td>payment accepted</td><td>⬜ untested</td></tr>
<tr><td>liability balance decreases by payment</td><td>⬜ untested</td></tr>
<tr><td>selling team's account decreases by payment</td><td>⬜ untested</td></tr>
<tr><td>warehouse's operational account increases by payment</td><td>⬜ untested</td></tr>
<tr><td>payment recorded in liability history</td><td>⬜ untested</td></tr>
<tr><td>payment recorded in both accounts' history</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to accept a payment<br>(pending · amount less than debt · into operational account)</td><td rowspan="2" valign="top">confirm payment</td><td>liability balance decreases by payment</td><td>⬜ untested</td></tr>
<tr><td>selling team still owes the rest</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to accept a payment<br>(pending · amount more than debt · into operational account)</td><td rowspan="2" valign="top">confirm payment</td><td>liability balance flips</td><td>⬜ untested</td></tr>
<tr><td>warehouse owes selling team</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to accept a payment<br>(pending · selling team at credit limit · into operational account)</td><td rowspan="1" valign="top">confirm payment</td><td>selling team can create orders again</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>warehouse:owner</code> · <code>warehouse:admin</code> wants to accept a payment<br>(pending · accepted by 2 people at once)</td><td rowspan="1" valign="top">confirm payment</td><td>payment accepted once</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to accept a payment<br>(pending · from warehouse · into operational account)</td><td rowspan="2" valign="top">confirm payment</td><td>payment accepted</td><td>⬜ untested</td></tr>
<tr><td>liability balance decreases by payment</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to accept a payment<br>(pending · from another selling team · into operational account)</td><td rowspan="2" valign="top">confirm payment</td><td>payment accepted</td><td>⬜ untested</td></tr>
<tr><td>liability balance decreases by payment</td><td>⬜ untested</td></tr>
</table>
