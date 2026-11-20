# Acceptance progress

Every action, under the day it was discussed. The counts are the statuses today of the thens of all its givens. Rules:
[progress-is-by-day](guide.md#progress-is-by-day).

## 2026-11-11

- `selling:all` wants to restock · [create restock](inventory/restock.md#create) (18 thens: ✅ 15, 🚧 3)
- `warehouse:all` wants to receive a restock · [mark arrived restock](inventory/restock.md#receive) (8 thens: ✅ 4, 🚧 1, ⬜ 3)
- `warehouse:all` wants to accept a restock · [accept restock](inventory/restock.md#receive) (37 thens: ✅ 23, 🚧 2, ⬜ 12)
- `selling:all` wants to edit a restock · [edit restock](inventory/restock.md#create) (66 thens: ✅ 15, 🚧 7, ⬜ 44)

## 2026-11-14

- `selling:all` wants to cancel a restock · [cancel restock](inventory/restock.md#cancel-and-lost) (14 thens: ⬜ 14)
- `selling:all` wants to report a lost restock · [mark lost restock](inventory/restock.md#cancel-and-lost) (8 thens: 🚧 1, ⬜ 7)
- `warehouse:owner` · `warehouse:admin` wants to correct a received count · [correct received count restock](inventory/restock.md#receive) (18 thens: ⬜ 18)
- `selling:all` wants to create an order · [create order](inventory/order.md#create) (56 thens: ⬜ 56)
- `warehouse:all` wants to confirm an order · [confirm order](inventory/order.md#process-confirm) (8 thens: ⬜ 8)
- `warehouse:all` wants to validate an order's package · [validate package order](inventory/order.md#process-pick-and-pack) (22 thens: ⬜ 22)
- `warehouse:all` wants to hand an order to the courier · [hand over order](inventory/order.md#process-hand-over) (22 thens: 🚧 1, ⬜ 21)

## 2026-11-16

- `selling:all` wants to mark an order shipped · [mark shipped order](inventory/order.md#process-delivery) (6 thens: 🚧 1, ⬜ 5)
- `selling:all` wants to complete an order · [complete order](inventory/order.md#process-delivery) (4 thens: ⬜ 4)
- `selling:all` wants to cancel an order · [cancel order](inventory/order.md#create) (16 thens: ⬜ 16)
- `selling:all` · `warehouse:all` wants to return an order · [return order](inventory/order.md#return) (13 thens: ⬜ 13)
- `warehouse:all` wants to accept a return · [accept return](inventory/order.md#return) (20 thens: 🚧 1, ⬜ 19)
- `selling:all` wants to mark an order lost · [mark lost order](inventory/order.md#problem-and-lost) (7 thens: ⬜ 7)
- `warehouse:all` wants to put a found parcel back in stock · [report found](inventory/order.md#problem-and-lost) (2 thens: 🚧 1, ⬜ 1)
- `selling:all` wants to mark an order as problem · [mark problem order](inventory/order.md#problem-and-lost) (5 thens: ⬜ 5)
- `selling:all` wants to resolve a dispute · [resolve dispute order](inventory/order.md#problem-and-lost) (4 thens: ⬜ 4)
- `selling:all` wants to follow up restock problems · [list problem restock](inventory/restock.md#resolve) (1 then: 🚧 1)
- `selling:all` wants to follow up lost restocks · [list lost restock](inventory/restock.md#resolve) (1 then: ⬜ 1)
- `selling:all` wants to record the supplier's solution · [resolve restock problem](inventory/restock.md#resolve) (10 thens: 🚧 10)
- `selling:all` wants to record the platform's solution · [resolve lost restock](inventory/restock.md#resolve) (5 thens: 🚧 5)
- `warehouse:all` wants to hand an order back to pending · [back to pending order](inventory/order.md#process-confirm) (7 thens: ⬜ 7)
- `selling:all` wants to fix an order's resi · [edit resi order](inventory/order.md#edit) (10 thens: 🚧 1, ⬜ 9)
- `selling:all` wants to fix an order's shop · [edit shop order](inventory/order.md#edit) (3 thens: 🚧 3)

## 2026-11-17

- `selling:all` · `warehouse:all` wants to leave a note on an order · [add order note](inventory/order.md#edit) (6 thens: ⬜ 6)
- `warehouse:all` wants to find a parcel in a pile · [find parcel](inventory/order.md#process-hand-over) (6 thens: ⬜ 6)
- `warehouse:all` wants to print receipts · [print receipt order](inventory/order.md#process-confirm) (10 thens: 🚧 10)
- `warehouse:all` wants to pick goods for many orders · [bulk pick order](inventory/order.md#process-pick-and-pack) (3 thens: 🚧 3)
- `selling:all` wants to see their drafts · [list draft order](inventory/order.md#draft) (1 then: ⬜ 1)
- `selling:all` wants to finish a draft · [open draft order](inventory/order.md#draft) (1 then: ⬜ 1)
- `selling:all` wants to clear drafts · [delete draft order](inventory/order.md#draft) (2 thens: ⬜ 2)
- `selling:all` · `warehouse:all` wants to take orders to a spreadsheet · [export order](inventory/order.md#export) (5 thens: ⬜ 5)
- `selling:owner` · `selling:admin` · `warehouse:owner` · `warehouse:admin` wants to pay a debt · [make payment](balance/payment.md) (15 thens: 🚧 1, ⬜ 14)
- `warehouse:owner` · `warehouse:admin` · `selling:owner` · `selling:admin` wants to accept a payment · [confirm payment](balance/payment.md) (17 thens: ⬜ 17)
- `warehouse:owner` · `warehouse:admin` · `selling:owner` · `selling:admin` wants a team to pay its debt · [tell to make payment](balance/payment.md) (7 thens: ⬜ 7)
- `warehouse:owner` · `warehouse:admin` · `selling:owner` · `selling:admin` wants to refuse a wrong payment · [reject payment](balance/payment.md) (7 thens: ⬜ 7)
- `selling:owner` · `selling:admin` wants to take back a wrong payment · [cancel payment](balance/payment.md) (5 thens: 🚧 5)
- `warehouse:owner` · `selling:owner` · `selling:admin` wants to cap a team's debt · [set credit limit](balance/credit_limit.md) (10 thens: ⬜ 10)
- `warehouse:owner` wants to lift a team's own limit · [remove credit limit](balance/credit_limit.md) (3 thens: ⬜ 3)
- `selling:all` wants to create an order · [create order at the credit limit](balance/credit_limit.md) (1 then: ⬜ 1)
- `selling:all` wants to record the platform's payouts · [import settlement](settlement/settlement_importer.md) (17 thens: ⬜ 17)
- `selling:all` wants to check what an import did · [open import detail](settlement/settlement_importer.md) (1 then: ⬜ 1)
- `selling:all` wants to see what an order earned · [open order settlement](settlement/order_settlement.md) (5 thens: ⬜ 5)
- `selling:all` wants to see how the margin adds up · [open margin breakdown](settlement/order_settlement.md) (4 thens: ⬜ 4)
- `selling:all` wants to record money on an order · [add settlement entry](settlement/order_settlement.md) (10 thens: ⬜ 10)
- `selling:all` wants to undo a wrong entry · [reverse settlement entry](settlement/order_settlement.md) (6 thens: ⬜ 6)

## 2026-11-18

- `selling:owner` · `selling:admin` wants to see money not tied to an order · [open shop entries](settlement/shop_entry.md) (6 thens: ⬜ 6)
- `selling:owner` · `selling:admin` wants to find a shop's entries · [filter shop entries](settlement/shop_entry.md) (2 thens: ⬜ 2)
- `selling:owner` · `selling:admin` wants to undo a wrong shop entry · [reverse shop entry](settlement/shop_entry.md) (6 thens: ⬜ 6)
- `selling:owner` · `selling:admin` wants to record a cost · [record expense](financial_account/expense.md#record) (62 thens: 🚧 51, ⬜ 11)
- `selling:owner` · `selling:admin` wants to correct a cost · [adjust expense](financial_account/expense.md#adjust-and-cancel) (6 thens: ⬜ 6)
- `selling:owner` · `selling:admin` wants to take back a cost · [cancel expense](financial_account/expense.md#adjust-and-cancel) (5 thens: ⬜ 5)
- `selling:owner` · `selling:admin` wants to see what was spent in a month · [open expenses](financial_account/expense.md#read) (4 thens: 🚧 1, ⬜ 3)
- `selling:owner` · `selling:admin` wants to find a kind of cost · [filter expenses](financial_account/expense.md#read) (2 thens: ⬜ 2)

## 2026-11-19

- `selling:owner` · `selling:admin` wants to see how much of the sales reached us · [open settlement report](settlement/report.md) (6 thens: ⬜ 6)
- `selling:owner` · `selling:admin` wants to compare periods · [change report period](settlement/report.md) (2 thens: ⬜ 2)
- `selling:owner` · `selling:admin` wants to know who carries the gap · [group report by person](settlement/report.md) (3 thens: ⬜ 3)
- `selling:owner` · `selling:admin` wants to check a shop's entries · [open shop entries from report](settlement/report.md) (1 then: ⬜ 1)
- `selling:all` · `warehouse:all` wants to see statistics · [open analytic](analytic/report.md) (2 thens: ⬜ 2)
- `selling:all` · `warehouse:all` wants to see statistics · [add analytic metric](analytic/report.md) (6 thens: ⬜ 6)
- `selling:all` wants to see statistics · [change analytic group](analytic/report.md) (2 thens: ⬜ 2)
- `selling:all` wants to see statistics · [sort analytic report](analytic/report.md) (1 then: ⬜ 1)
- `selling:all` wants to see statistics · [view analytic as graph](analytic/report.md) (1 then: ⬜ 1)
- `selling:all` wants to see statistics · [open analytic link](analytic/report.md) (1 then: ⬜ 1)
- `selling:all` wants to see statistics · [change analytic period](analytic/report.md) (1 then: ⬜ 1)
- `selling:all` · `warehouse:all` wants to see statistics · [add analytic metric](analytic/order_metric.md) (17 thens: ⬜ 17)
- `selling:all` wants to see statistics · [add analytic metric](analytic/settlement_metric.md) (4 thens: ⬜ 4)
- `selling:all` · `warehouse:all` wants to see statistics · [add analytic metric](analytic/inventory_metric.md) (17 thens: 🚧 6, ⬜ 11)
- `selling:all` · `warehouse:all` wants to see statistics · [add analytic metric](analytic/expense_metric.md) (40 thens: 🚧 34, ⬜ 6)

## 2026-11-20

- `selling:all` · `warehouse:all` wants to see statistics · [add analytic metric](analytic/finance_metric.md) (17 thens: ⬜ 17)
- `selling:owner` · `selling:admin` · `warehouse:owner` · `warehouse:admin` wants to see what is owed · [open liability](balance/position.md#list) (8 thens: ⬜ 8)
- `selling:cs` · `warehouse:staff` wants to see what is owed · [open liability](balance/position.md#list) (1 then: ⬜ 1)
- `selling:owner` · `selling:admin` · `warehouse:owner` · `warehouse:admin` wants to see what is owed · [filter liability](balance/position.md#list) (4 thens: ⬜ 4)
- `selling:owner` · `selling:admin` · `warehouse:owner` · `warehouse:admin` wants to see what is owed · [open liability pair](balance/position.md#pair) (5 thens: ⬜ 5)
- `selling:owner` · `selling:admin` · `warehouse:owner` · `warehouse:admin` wants to see what is owed · [filter liability history](balance/position.md#pair) (3 thens: ⬜ 3)
