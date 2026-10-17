// Package inventory_mutations holds one mutation per operation (one-mutation-per-operation): each writes the
// transaction, its items and both ledgers through inventory_ledgers, and nothing else does. An RPC calls a mutation; it
// never writes a ledger itself (the-layer-under-a-mutation-is-a-ledger).
//
// The caller opens the database transaction and passes it in (the-caller-opens-the-transaction). A mutation calls the
// batch ledger before the placement ledger, so every writer locks batches before racks (batches-lock-before-shelves-by-id).
package inventory_mutations
