package liability_v1_test

import (
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// EVERY CREDITOR'S DEFAULT ROW, AND ONLY THOSE (the-flat-rate-is-dropped-last, step 2): the warehouse's 12.000, a
// warehouse charging nothing, and a selling team's default row with no fee — the caller filters by team type. A per-seller row is not
// read: one-rate-per-warehouse leaves it no equivalent.
func TestDefaultHandlingFees_ReadsTheDefaultRowsOnly(t *testing.T) {
	db := san_testdb.DB(t)

	const freeWarehouse uint64 = 901

	setTerms(t, db, warehouse, 0, 12000)
	setTerms(t, db, warehouse, selling, 9000) // the seller's own flat row
	setTerms(t, db, freeWarehouse, 0, 0)
	setTerms(t, db, productOwner, 0, 0) // a selling team's default row, no handling fee

	fees, err := liability_v1.DefaultHandlingFees(db)
	if err != nil {
		t.Fatalf("DefaultHandlingFees: %v", err)
	}

	want := map[uint64]int64{productOwner: 0, warehouse: 12000, freeWarehouse: 0}

	// Only this test's creditors, so a row another (committing) test left behind cannot fail it.
	var mine []liability_v1.DefaultHandlingFee

	for _, fee := range fees {
		if _, ok := want[fee.CreditorTeamID]; ok {
			mine = append(mine, fee)
		}
	}

	if len(mine) != len(want) {
		t.Fatalf("read %+v, want one row per creditor %v — never the seller's own 9000", mine, want)
	}

	for _, fee := range mine {
		if fee.HandlingFee != want[fee.CreditorTeamID] {
			t.Fatalf("creditor %d: %d, want %d — its default row", fee.CreditorTeamID, fee.HandlingFee,
				want[fee.CreditorTeamID])
		}
	}

	if mine[0].CreditorTeamID != productOwner || mine[2].CreditorTeamID != freeWarehouse {
		t.Fatalf("order = %+v, want oldest team first", mine)
	}
}
