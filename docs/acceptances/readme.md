# Acceptances

Every big feature with an acceptance, and its small features. The statuses are counted in each big feature's
`context.md`, and by day in [progress.md](progress.md). How a file is written: [guide.md](guide.md).

| big feature | small features |
| --- | --- |
| [inventory](inventory/context.md) | [restock](inventory/restock.md) · [placement](inventory/placement.md) · [batch](inventory/batch.md) · [transaction](inventory/transaction.md) · [opname](inventory/opname.md) · [warehouse_transfer](inventory/warehouse_transfer.md) · [order](inventory/order.md) · [adjustment](inventory/adjustment.md) · [return](inventory/return.md) |
| [balance](balance/context.md) | [payment](balance/payment.md) · [credit_limit](balance/credit_limit.md) · [position](balance/position.md) |
| [settlement](settlement/context.md) | [settlement_importer](settlement/settlement_importer.md) · [order_settlement](settlement/order_settlement.md) · [shop_entry](settlement/shop_entry.md) · [report](settlement/report.md) |
| [financial_account](financial_account/context.md) | [account](financial_account/account.md) · [expense](financial_account/expense.md) · [reconcile](financial_account/reconcile.md) · [transfer](financial_account/transfer.md) |
| [analytic](analytic/context.md) | [report](analytic/report.md) · [order_metric](analytic/order_metric.md) · [settlement_metric](analytic/settlement_metric.md) · [inventory_metric](analytic/inventory_metric.md) · [expense_metric](analytic/expense_metric.md) · [finance_metric](analytic/finance_metric.md) |
| [product](product/context.md) | — not split yet |

A new big feature or small feature gets its row here in the same change that creates its file.
