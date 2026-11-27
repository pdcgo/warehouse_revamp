# Acceptance — financial_account / account

The **Akun** screens: the list (`/financial-accounts`) — what the team holds, by type, with its totals and the accounts
below zero — and one account (`/financial-accounts/:id`) with its rows. Every member sees them; an owner and an admin set
an account up: create, edit, archive at zero, restore, mark it operational, set an unknown account and point a shop at
it. Transfer, Match Balance, capital and the report are their own small features. Business:
[context_decision.md](../../business/financial_account/context_decision.md) · rules: [guide.md](../guide.md)

## accounts

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">1</td><td rowspan="2" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to know where the money is<br>(3 active accounts: bank BCA Rp 1.000.000 · wallet ShopeePay Rp 200.000 · cash Rp 50.000)</td><td rowspan="2" valign="top">open accounts</td><td>total balance Rp 1.250.000</td><td>✅ ok</td></tr>
<tr><td>bank, wallet and cash each with its own total</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to know where the money is<br>(active bank BCA · balance −Rp 50.000)</td><td rowspan="1" valign="top">open accounts</td><td>"below zero" on its row, saying to check it against the bank</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to know where the money is<br>(unknown account · Rp 300.000 withdrawn by shop Melati · Melati names no account)</td><td rowspan="1" valign="top">open accounts</td><td>it says the withdrawal came before its bank was named</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to know where the money is<br>(active bank BCA and wallet ShopeePay · search "BCA")</td><td rowspan="1" valign="top">filter accounts</td><td>only matching accounts listed</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to know where the money is<br>(active bank BCA, wallet ShopeePay and cash · type: digital wallet)</td><td rowspan="1" valign="top">filter accounts</td><td>only wallets listed</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to know where the money is<br>(1 active and 1 archived account · archive opened)</td><td rowspan="1" valign="top">filter accounts</td><td>only archived accounts listed</td><td>✅ ok</td></tr>
</table>

## set up

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">7</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to add an account<br>(type bank · provider BCA · name "BCA Operasional" · number 1234567890 · holder PT Melati · opening Rp 500.000)</td><td rowspan="2" valign="top">create account</td><td>account listed with Rp 500.000</td><td>✅ ok</td></tr>
<tr><td>its first row: opening balance Rp 500.000</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">8</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to add an account<br>(type bank · provider BCA · number 1234567890 already in another team)</td><td rowspan="1" valign="top">create account</td><td>cannot create, message says one real account is recorded once</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">9</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to add an account<br>(name "BCA Operasional" already used in this team)</td><td rowspan="1" valign="top">create account</td><td>cannot create</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">10</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to add an account<br>(type other · provider other · no number · opening Rp 0)</td><td rowspan="1" valign="top">create account</td><td>account created with provider other</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">11</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to fix an account's details<br>(active bank BCA · holder changed from PT Melati to PT Melati Jaya)</td><td rowspan="1" valign="top">edit account</td><td>PT Melati Jaya under the account's name, in the list and on its page</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">12</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to close an account<br>(active bank BCA · balance Rp 0)</td><td rowspan="1" valign="top">archive account</td><td>gone from the list and every account picker, its history kept</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">13</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to close an account<br>(active bank BCA · balance Rp 100.000)</td><td rowspan="1" valign="top">archive account</td><td>not offered, says only at zero</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">14</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to use a closed account again<br>(archived bank BCA · balance Rp 0)</td><td rowspan="1" valign="top">restore account</td><td>back in the list and the pickers</td><td>✅ ok</td></tr>
<tr><td rowspan="2" valign="top">15</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to choose which accounts pay<br>(active bank BCA · not operational)</td><td rowspan="2" valign="top">mark operational</td><td>asks first</td><td>✅ ok</td></tr>
<tr><td>offered as <i>Paid from</i> on a restock and an expense</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">16</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to name where a withdrawal landed<br>(unknown account Rp 300.000 from Melati · Melati's bank not registered · details filled as BCA TikTok)</td><td rowspan="1" valign="top">set account</td><td>it becomes BCA TikTok, its Rp 300.000 row kept</td><td>✅ ok</td></tr>
<tr><td rowspan="3" valign="top">17</td><td rowspan="3" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to name where a withdrawal landed<br>(unknown account Rp 300.000 from Melati · BCA TikTok already registered · moved into it)</td><td rowspan="3" valign="top">set account</td><td>Rp 300.000 moves into BCA TikTok</td><td>✅ ok</td></tr>
<tr><td>the shop withdraws there from now on</td><td>✅ ok</td></tr>
<tr><td>the unknown account archived</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">18</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to a shop's withdrawals to land in an account<br>(active bank BCA · Melati names no account yet · Melati pointed here)</td><td rowspan="1" valign="top">point a shop here</td><td>Melati's withdrawals land in this account</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">19</td><td rowspan="2" valign="top"><code>selling:cs</code> · <code>warehouse:staff</code> wants to add an account<br>(team with 2 active accounts)</td><td rowspan="2" valign="top">create account</td><td>cannot add, <i>New Account</i> not offered</td><td>✅ ok</td></tr>
<tr><td>the 2 accounts still shown with their balances, with no actions</td><td>✅ ok</td></tr>
</table>

## account

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="1" valign="top">20</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to read an account's rows<br>(bank BCA · opening Rp 500.000 · expense Rp 100.000 · withdrawal Rp 1.000.000)</td><td rowspan="1" valign="top">open account</td><td>each row with its type, amount and balance after: Rp 500.000, Rp 400.000, Rp 1.400.000</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">21</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to read an account's rows<br>(bank BCA · opening, 2 expenses, 1 withdrawal · type: expense)</td><td rowspan="1" valign="top">filter account rows</td><td>only the 2 expense rows</td><td>✅ ok</td></tr>
</table>
