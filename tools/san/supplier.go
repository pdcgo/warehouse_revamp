package main

import "github.com/urfave/cli/v3"

// supplierCommand is the supplier's operator actions: folding the restocks accepted before the figures existed
// (past-accepts-are-backfilled-once), linking every accepted line's product to its supplier and store
// (restock-accepted-links-the-product-to-its-channel), and re-folding both daily reports into the warehouse each figure
// came from (the-supplier-reports-carry-the-warehouse).
//
// `supplier move` — copying inventory_service's suppliers into supplier_service, ids kept
// (existing-suppliers-move-with-their-ids) — is retired: it had run on every database, and inventory_service's 00046
// drops the legacy tables it read (refusing, on a database never moved, with "run san supplier move first" — from a
// checkout before that migration).
func supplierCommand() *cli.Command {
	return &cli.Command{
		Name:  "supplier",
		Usage: "supplier_service operations",
		Commands: []*cli.Command{
			supplierBackfillCommand(),
			supplierBackfillLinksCommand(),
			supplierBackfillWarehousesCommand(),
		},
	}
}
