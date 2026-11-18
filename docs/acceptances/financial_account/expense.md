# Acceptance — financial_account / expense

What a team spent that no order caused — the **Pengeluaran** screen (`/expenses`), for the owner and admin of a selling
team. An expense names the operational account that paid it, is never edited, and is corrected by a signed row on its
own day. 🚧 rows are the coming types: Operasional broken into many types, and prive, outside debt and outside
receivable, which move money both ways and count in the month total. Business:
[decisions](../../business/financial_account/context_decision.md#an-expense-must-name-the-account-that-paid) · rules:
[guide.md](../guide.md)

## record

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to record a cost<br>(payroll · operational account)</td><td rowspan="3" valign="top">record expense</td><td>expense shown with who recorded it</td><td>⬜ untested</td></tr>
<tr><td>operational account decreases by the amount</td><td>⬜ untested</td></tr>
<tr><td>payroll and month total increase by the amount</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to record a cost<br>(October payroll recorded on 5 Nov · date 31 Oct)</td><td rowspan="2" valign="top">record expense</td><td>counted in October</td><td>⬜ untested</td></tr>
<tr><td>account history shows it on 31 Oct</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to record a cost<br>(ads · shop)</td><td rowspan="2" valign="top">record expense</td><td>shop shown under the kind</td><td>⬜ untested</td></tr>
<tr><td>account history shows it as ads expense</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to record a cost<br>(ads · no shop)</td><td rowspan="1" valign="top">record expense</td><td>cannot record expense</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to record a cost<br>(team with no operational account)</td><td rowspan="1" valign="top">record expense</td><td>cannot record expense</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to record a cost<br>(electricity)</td><td rowspan="2" valign="top">record expense</td><td>shown as electricity</td><td>🚧 unimplemented</td></tr>
<tr><td>electricity and month total increase by the amount</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to record the owner's capital<br>(prive · owner takes capital)</td><td rowspan="2" valign="top">record expense</td><td>operational account decreases by the amount</td><td>🚧 unimplemented</td></tr>
<tr><td>prive and month total increase by the amount</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to record the owner's capital<br>(prive · owner adds capital)</td><td rowspan="2" valign="top">record expense</td><td>operational account increases by the amount</td><td>🚧 unimplemented</td></tr>
<tr><td>prive and month total decrease by the amount</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to record an outside debt<br>(outside debt paid)</td><td rowspan="2" valign="top">record expense</td><td>operational account decreases by the amount</td><td>🚧 unimplemented</td></tr>
<tr><td>outside debt and month total increase by the amount</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to record an outside debt<br>(outside receivable received)</td><td rowspan="2" valign="top">record expense</td><td>operational account increases by the amount</td><td>🚧 unimplemented</td></tr>
<tr><td>outside receivable and month total decrease by the amount</td><td>🚧 unimplemented</td></tr>
</table>

## adjust and cancel

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to correct a cost<br>(expense Rp 500.000 · reduce Rp 100.000)</td><td rowspan="3" valign="top">adjust expense</td><td>adjustment row added on the expense's day</td><td>⬜ untested</td></tr>
<tr><td>expense shows now Rp 400.000</td><td>⬜ untested</td></tr>
<tr><td>paying account gets Rp 100.000 back</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to correct a cost<br>(expense Rp 500.000 · add Rp 50.000)</td><td rowspan="1" valign="top">adjust expense</td><td>paying account decreases by Rp 50.000</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to correct a cost<br>(expense Rp 400.000 · reduce Rp 450.000)</td><td rowspan="1" valign="top">adjust expense</td><td>cannot reduce below Rp 0</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to take back a cost<br>(expense Rp 500.000 · already reduced to Rp 400.000)</td><td rowspan="4" valign="top">cancel expense</td><td>expense counts for Rp 0</td><td>⬜ untested</td></tr>
<tr><td>paying account gets Rp 400.000 back</td><td>⬜ untested</td></tr>
<tr><td>month total decreases by Rp 400.000</td><td>⬜ untested</td></tr>
<tr><td>cannot cancel again</td><td>⬜ untested</td></tr>
</table>

## read

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to see what was spent in a month<br>(ads and payroll · payroll Rp 500.000 reduced to Rp 400.000)</td><td rowspan="3" valign="top">open expenses</td><td>totals shown per kind and for the month</td><td>⬜ untested</td></tr>
<tr><td>corrected expense shows Rp 500.000 and now Rp 400.000</td><td>⬜ untested</td></tr>
<tr><td>adjustment shown muted with no actions</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to see what was spent in a month<br>(electricity and internet)</td><td rowspan="1" valign="top">open expenses</td><td>each type's total shown</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to find a kind of cost<br>(month and kind chosen)</td><td rowspan="2" valign="top">filter expenses</td><td>only that kind shown</td><td>⬜ untested</td></tr>
<tr><td>filter kept after reload</td><td>⬜ untested</td></tr>
</table>

> ❓ **Open (2026-11-18):** whether the types sit under groups (Ads, Payroll, Operational, Other) or stand as one flat
> list. Once decided, the totals and the filter gain a group given or stay per type.
