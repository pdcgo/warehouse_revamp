package cost_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	costv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/cost/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// #168 — a cost is recorded, and it keeps the date the person CHOSE.
//
// That date is the point: payroll is paid on the 5th for the month before, so filing it under the day
// it was typed would put it in the wrong month for every report that matters.
func TestCostCreate_RecordsTheChosenDate(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	got := record(t, svc, costv1.CostKind_COST_KIND_PAYROLL, 12_000_000, "2026-06-30")

	if got.GetAmount() != 12_000_000 {
		t.Fatalf("amount = %d, want 12000000", got.GetAmount())
	}
	if got.GetOccurredAt() != "2026-06-30" {
		t.Fatalf("occurred_at = %q, want the chosen 2026-06-30", got.GetOccurredAt())
	}
	if got.GetKind() != costv1.CostKind_COST_KIND_PAYROLL {
		t.Fatalf("kind = %v, want PAYROLL", got.GetKind())
	}
	// A new cost counts until somebody voids it (#169).
	if got.GetVoided() {
		t.Fatal("a newly recorded cost is already voided")
	}
}

// #168 — a date that MATCHES THE PATTERN but is not a day is refused.
//
// Proto validation checks the shape; "2026-02-31" has the right shape and does not exist. The handler
// re-checks because shape is not validity — and because unit tests bypass the validation interceptor,
// so a handler that trusted the pattern would be untested against exactly this.
func TestCostCreate_RefusesADateThatIsNotADay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	for _, bad := range []string{"2026-02-31", "2026-13-01", "not-a-date"} {
		_, err := svc.CostCreate(context.Background(), connect.NewRequest(&costv1.CostCreateRequest{
			TeamId: teamA, Kind: costv1.CostKind_COST_KIND_ADS, Amount: 1000, OccurredAt: bad,
		}))
		if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
			t.Fatalf("CostCreate(%q) = %v, want InvalidArgument", bad, code)
		}
	}
}

// #168 — a shop is optional on EVERY kind (owner, 2026-07-21), not only ads.
//
// A team running two shops may split its packing wages between them, and "only ads may name a shop"
// is a rule somebody would hit and ask to have relaxed.
func TestCostCreate_AnyKindMayNameAShop(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	const shop uint64 = 77

	res, err := svc.CostCreate(ctx, connect.NewRequest(&costv1.CostCreateRequest{
		TeamId: teamA, Kind: costv1.CostKind_COST_KIND_PAYROLL,
		Amount: 800_000, OccurredAt: "2026-07-05", ShopId: shop,
	}))
	if err != nil {
		t.Fatalf("payroll naming a shop was refused: %v", err)
	}
	if res.Msg.GetCost().GetShopId() != shop {
		t.Fatalf("shop_id = %d, want %d", res.Msg.GetCost().GetShopId(), shop)
	}

	// And naming none is equally fine — it is optional, not required.
	none := record(t, svc, costv1.CostKind_COST_KIND_OPERATIONAL, 500_000, "2026-07-01")
	if none.GetShopId() != 0 {
		t.Fatalf("shop_id = %d, want 0 when none was named", none.GetShopId())
	}
}
