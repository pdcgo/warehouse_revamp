package inventory_v1_test

import (
	"testing"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// The review shows what finalize posts — per product, per batch — and why this person may not finalize: rows left, or
// their own count. It writes nothing. A row not yet counted reads as matching its book.
func TestOpnameFinalizePreview_ShowsThePostAndTheBlock(t *testing.T) {
	f := opnameStocked(t)
	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosHitam, 0)

	f.countRow(t, opAni, s.GetId(), otKaosHitam, f.rakA, 2, 0)

	early, err := f.preview(opAdmin(opBudi), s.GetId())
	if err != nil {
		t.Fatalf("preview: %v", err)
	}

	if early.GetBlock() != inventoryv1.OpnameFinalizeBlock_OPNAME_FINALIZE_BLOCK_ROWS_NOT_COUNTED {
		t.Fatalf("block %v, want rows not counted", early.GetBlock())
	}

	f.countRow(t, opAni, s.GetId(), otKaosHitam, f.rakB, 5, 0)

	mine, err := f.preview(opAdmin(opAni), s.GetId())
	if err != nil {
		t.Fatalf("preview: %v", err)
	}

	if mine.GetBlock() != inventoryv1.OpnameFinalizeBlock_OPNAME_FINALIZE_BLOCK_OWN_COUNT {
		t.Fatalf("Ani's block %v, want her own count", mine.GetBlock())
	}

	res, err := f.preview(opAdmin(opBudi), s.GetId())
	if err != nil {
		t.Fatalf("preview: %v", err)
	}

	if res.GetBlock() != inventoryv1.OpnameFinalizeBlock_OPNAME_FINALIZE_BLOCK_UNSPECIFIED || len(res.GetProducts()) != 1 {
		t.Fatalf("Budi's preview %+v, want no block and one product", res)
	}

	p := res.GetProducts()[0]
	if p.GetBookCount() != 10 || p.GetSellableCount() != 7 || p.GetRestCount() != -3 || p.GetProductName() != "Kaos Hitam" ||
		len(p.GetLines()) != 1 || p.GetLines()[0].GetType() != inventoryv1.OpnamePostType_OPNAME_POST_TYPE_LOST ||
		p.GetLines()[0].GetStockCount() != 3 || !san_money.Equal(res.GetOwedAmount(), 30000) {
		t.Fatalf("product %+v owed %v, want lost 3 off the oldest batch, Rp 30.000", p, res.GetOwedAmount())
	}

	if n := countTransactions(f.db, models.TxProblem); n != 0 {
		t.Fatalf("a preview wrote %d transactions", n)
	}
}
