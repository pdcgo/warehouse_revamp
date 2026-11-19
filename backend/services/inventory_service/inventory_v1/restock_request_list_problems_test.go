package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// EVERY ACCEPTED ROW ON BOTH RESTOCK LISTS CARRIES ITS MISSING AND BROKEN COUNTS (backlog #89,
// the-restock-tags-prototype-is-accepted: *on accepted rows kurang N · rusak N*; a-restock-problem-is-a-system-tag: *the
// problem list is the restock listed with missing and broken count*). Both lists draw `restock-missing-<id>` /
// `restock-broken-<id>` from each line's `problems` by kind and count, so the LIST RESPONSE must carry them — it used to
// preload the lines only (#154), and no row ever showed a count. What a row carries of them is the counts alone: no price
// or total (a-warehouse-sees-no-seller-money — the warehouse reads this list too), no note, no photo.
//
//	P      accepted  Kaos 7 in the box, 2 of them broken  → Kaos 3 missing · 2 broken; Celana none
//	clean  accepted  counted whole                         → none
//	road   ongoing                                         → none
//	other  ANOTHER selling team's, into the same warehouse, counted short and broken → never on the seller's list; on
//	       the warehouse's, on its own row only
//
// P and clean hold the SAME two products, so a count keyed by product alone would land P's units on clean's lines.

// lpKinds is one line's problems as a list row carries them: units by kind, and whether any money, note or photo rode
// along.
type lpKinds struct {
	missing, broken int64
	extra           bool
}

// lpLines is a list row's lines' problems, by product.
func lpLines(r *inventoryv1.RestockRequest) map[uint64]lpKinds {
	out := map[uint64]lpKinds{}

	for _, item := range r.GetItems() {
		k := lpKinds{}

		for _, p := range item.GetProblems() {
			switch p.GetType() {
			case inventoryv1.RestockProblemType_RESTOCK_PROBLEM_TYPE_MISSING:
				k.missing += p.GetCount()
			case inventoryv1.RestockProblemType_RESTOCK_PROBLEM_TYPE_BROKEN:
				k.broken += p.GetCount()
			}

			if p.GetPriceUnit() != 0 || p.GetTotal() != 0 || p.GetNote() != "" || p.GetPhotoFile() != "" {
				k.extra = true
			}
		}

		out[item.GetProductId()] = k
	}

	return out
}

// lpAccept counts a raised restock in: each line's (received, broken), the good units on the staging placement.
func lpAccept(t *testing.T, svc *inventory_v1.Service, place uint64, r *inventoryv1.RestockRequest, counts ...[2]int64) {
	t.Helper()

	_, err := svc.RestockRequestAccept(ctxUser(arrCounter), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: arrWarehouse, RequestId: r.GetId(),
		Lines: tgCount(t, r, place, counts...),
	}))
	if err != nil {
		t.Fatalf("accept restock %d: %v", r.GetId(), err)
	}
}

func TestRestockRequestList_EveryAcceptedRowCarriesItsMissingAndBroken(t *testing.T) {
	db := san_testdb.DB(t)
	svc := tgService(t, db)
	place := stagingPlacement(t, db, arrWarehouse)

	// Kaos (product 100) 10 ordered, Celana (200) 5 ordered.
	p := nsRaise(t, svc, "")
	lpAccept(t, svc, place, p, [2]int64{7, 2}, [2]int64{5, 0})

	clean := nsRaise(t, svc, "")
	lpAccept(t, svc, place, clean, [2]int64{10, 0}, [2]int64{5, 0})

	road := nsRaise(t, svc, "")

	// ANOTHER selling team's restock into the same warehouse — Topi (300) 6 ordered, Sepatu (400) 4 — counted short and
	// broken.
	const otherTeam uint64 = 3

	raised, err := svc.RestockRequestCreate(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: otherTeam, WarehouseId: arrWarehouse, FinanceAccountId: arrAccount,
		Receipt: "LP-OTHER", ShipmentCost: 20000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 300, ProductCode: "SKU-TOPI", Name: "Topi", Count: 6, Total: 60000},
			{ProductId: 400, ProductCode: "SKU-SEPATU", Name: "Sepatu", Count: 4, Total: 200000},
		},
	}))
	if err != nil {
		t.Fatalf("the other team raises: %v", err)
	}

	other := raised.Msg.GetRequest()
	lpAccept(t, svc, place, other, [2]int64{4, 1}, [2]int64{2, 0})

	none := map[uint64]lpKinds{100: {}, 200: {}}

	for _, side := range []struct {
		name string
		team uint64
		want map[uint64]map[uint64]lpKinds
	}{
		{"the seller", arrSellingTeam, map[uint64]map[uint64]lpKinds{
			p.GetId():     {100: {missing: 3, broken: 2}, 200: {}},
			clean.GetId(): none,
			road.GetId():  none,
		}},
		{"the warehouse", arrWarehouse, map[uint64]map[uint64]lpKinds{
			p.GetId():     {100: {missing: 3, broken: 2}, 200: {}},
			clean.GetId(): none,
			road.GetId():  none,
			other.GetId(): {300: {missing: 2, broken: 1}, 400: {missing: 2}},
		}},
	} {
		got := map[uint64]map[uint64]lpKinds{}
		for _, r := range listRows(t, svc, side.team, nil) {
			got[r.GetId()] = lpLines(r)
		}

		if len(got) != len(side.want) {
			t.Errorf("%s's list holds %d restocks %v, want %d", side.name, len(got), got, len(side.want))
		}

		for id, lines := range side.want {
			row, ok := got[id]
			if !ok {
				t.Fatalf("%s: restock %d is not on the list", side.name, id)
			}

			for product, w := range lines {
				if row[product] != w {
					t.Errorf("%s: restock %d's product %d reads %+v on the list, want %+v (missing, broken, money/note/photo)",
						side.name, id, product, row[product], w)
				}
			}
		}

		if _, leaked := got[other.GetId()]; leaked && side.team == arrSellingTeam {
			t.Errorf("the seller's list carries the other team's restock %d", other.GetId())
		}
	}

	// THE LIST'S COUNTS ARE THE DETAIL'S — the same rows, read whole there.
	for _, r := range []*inventoryv1.RestockRequest{p, clean, other} {
		detail, err := svc.RestockRequestDetail(ctxUser(arrCounter), connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
			TeamId: arrWarehouse, RequestId: r.GetId(),
		}))
		if err != nil {
			t.Fatalf("detail %d: %v", r.GetId(), err)
		}

		var row *inventoryv1.RestockRequest

		for _, l := range listRows(t, svc, arrWarehouse, nil) {
			if l.GetId() == r.GetId() {
				row = l
			}
		}

		fromDetail := lpLines(detail.Msg.GetRequest())
		fromList := lpLines(row)

		for product, d := range fromDetail {
			l := fromList[product]
			if l.missing != d.missing || l.broken != d.broken {
				t.Errorf("restock %d's product %d: the list reads %d missing · %d broken, the detail %d · %d",
					r.GetId(), product, l.missing, l.broken, d.missing, d.broken)
			}
		}
	}
}
