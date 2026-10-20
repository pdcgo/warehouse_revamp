// Package inventory_ledgers is the layer UNDER a mutation (the-layer-under-a-mutation-is-a-ledger): the batch ledger,
// the placement ledger, and the transaction they both name.
//
// The rules every function here keeps:
//
//   - The caller opens the database transaction and passes it in; nothing here begins, commits or rolls back
//     (the-caller-opens-the-transaction). A mutation — one per operation (one-mutation-per-operation) — calls these.
//   - Logs are append-only (ledger-logs-are-append-only): a function inserts log rows and updates state rows, never a
//     log row.
//   - Lock order is batches, then racks, each by id (batches-lock-before-shelves-by-id). A mutation calls the batch
//     ledger before the placement ledger, and each function locks its rows in id order.
//   - Every check that can refuse runs before the first write, so a refusal writes nothing even before the caller
//     rolls back.
//   - Money is float64 and compared through san_money, never with == (stock-money-is-float64-compared-at-4-digits).
package inventory_ledgers
