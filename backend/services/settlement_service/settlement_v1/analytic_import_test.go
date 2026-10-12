package settlement_v1_test

import (
	"testing"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// An imported shop row carries the person it counts for, and the fold reads it: the primary CS's report
// holds the row, and the uploader's does not (#settlement-asks-the-shop-for-its-primary-cs).
func TestFold_CountsAnImportedShopRowForItsUser(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	event := logPosted(21, "2026-01-06", shop, 0, 0, uploader,
		settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL, -300_000)
	event.GetSettlementLogPosted().UserId = shopPrimaryCS

	fold(t, svc, event)

	metrics, days := userDays(t, db, shopPrimaryCS)
	assertDays(t, metrics, days, []dayWant{{day: "2026-01-06", change: -300_000, open: 0, close: -300_000}})

	if metrics[0].Withdrawal != -300_000 {
		t.Fatalf("withdrawal = %d, want −300.000", metrics[0].Withdrawal)
	}

	if uploaded, _ := userDays(t, db, uploader); len(uploaded) != 0 {
		t.Fatalf("the uploader's report holds %d days — the row is the primary CS's", len(uploaded))
	}
}

// The five types of 2026-09-24 fold into their own columns — and into the position, withdrawal included
// (#withdrawal-counts-in-the-position).
func TestFold_FoldsTheFiveNewTypesIntoThePosition(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	fold(t, svc,
		logPosted(31, "2026-01-07", shop, 0, 0, 9, settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL, -1_000),
		logPosted(32, "2026-01-07", shop, 0, 0, 9, settlementv1.SettlementType_SETTLEMENT_TYPE_SHIPMENT_ADJUSTMENT, 20),
		logPosted(33, "2026-01-07", shop, 0, 0, 9, settlementv1.SettlementType_SETTLEMENT_TYPE_LOGISTIC_REIMBURSEMENT, 300),
		logPosted(34, "2026-01-07", shop, 0, 0, 9, settlementv1.SettlementType_SETTLEMENT_TYPE_PLATFORM_REIMBURSEMENT, 4_000),
		logPosted(35, "2026-01-07", shop, 0, 0, 9, settlementv1.SettlementType_SETTLEMENT_TYPE_MARKETPLACE_PROGRAM, 50_000),
	)

	metrics, days := shopDays(t, db, shop)
	assertDays(t, metrics, days, []dayWant{{day: "2026-01-07", change: 53_320, open: 0, close: 53_320}})

	day := metrics[0]
	if day.Withdrawal != -1_000 || day.ShipmentAdjustment != 20 || day.LogisticReimbursement != 300 ||
		day.PlatformReimbursement != 4_000 || day.MarketplaceProgram != 50_000 {
		t.Fatalf("columns = %+v", day)
	}
}
