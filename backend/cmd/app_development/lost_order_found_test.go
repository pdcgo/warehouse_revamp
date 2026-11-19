package main

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// lostOrderCatalog is product_service for inventory here: every product is the selling team's own.
type lostOrderCatalog struct {
	team uint64
}

func (c lostOrderCatalog) Facts(_ context.Context, _ uint64, ids []uint64) (map[uint64]inventory_v1.ProductFact, error) {
	out := make(map[uint64]inventory_v1.ProductFact, len(ids))
	for _, id := range ids {
		out[id] = inventory_v1.ProductFact{TeamID: c.team, ProductCode: "SKU", Name: "Kaos"}
	}

	return out, nil
}

func (lostOrderCatalog) Search(context.Context, uint64, inventory_v1.ProductSearch) (inventory_v1.ProductSearchPage, error) {
	return inventory_v1.ProductSearchPage{}, errors.New("no search here")
}

// asWarehousePerson is the warehouse's staff or Admin as the access interceptor leaves them: who, scoped to the warehouse.
func asWarehousePerson(id, warehouse uint64, role role_basev1.Role) context.Context {
	ctx := san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: id})
	ctx = san_auth.WithScope(ctx, warehouse)

	return san_auth.WithCallerRole(ctx, role)
}

// A FOUND FROM A LOST ORDER, THROUGH THE REAL WIRING (a-found-lost-parcel-is-a-found-stock-in). Melati's order of 3 Kaos
// (Rp 10.000 each on the shelf) ships from Gudang A and is lost. While it is still on its way the parcel cannot be named
// as found; once lost, Gudang A's staff report it found NAMING THE ORDER through inventory's FoundRequestCreate wired with
// the composition root's order seam over selling's own tables: the request names the order, the order's timeline names
// the request in a note from the warehouse, and the order STAYS LOST. Another warehouse cannot name it. The Admin approves:
// the 3 come back at the Rp 10.000 the order took them at — and the order is still lost.
func TestLostOrderFound_TheFoundNamesTheOrderWhichStaysLost(t *testing.T) {
	const (
		team      uint64 = 9_000_820
		warehouse uint64 = 9_000_821
		product   uint64 = 9_000_822
		elsewhere uint64 = 9_000_823
	)

	ctx := context.Background()
	db := san_testdb.DB(t)
	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, lostOrderCatalog{team: team}, nil, nil,
		NewInventoryReturnOrders(db), nil)
	svc := selling_v1.NewService(db, NewStockPicker(inventory), nil, returnOrdersCatalog{team: team}, nil, runsEveryShop{},
		nil, nil, nil, nil, nil)

	stockForPicker(t, inventory, team, warehouse, product, 5)
	shop := shopForOrders(t, db, team, warehouse)

	created, err := svc.OrderCreate(ctx, connect.NewRequest(twoLinesOf(team, shop, warehouse, product)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	order := created.Msg.GetOrder()

	move := func(as uint64, to sellingv1.OrderStatus) {
		t.Helper()

		res, moveErr := svc.OrderStatusChange(ctx, connect.NewRequest(&sellingv1.OrderStatusChangeRequest{
			TeamId: as, OrderIds: []uint64{order.GetId()}, To: to,
		}))
		if moveErr != nil || !res.Msg.GetResults()[0].GetMoved() {
			t.Fatalf("move to %v: %v %v", to, moveErr, res)
		}
	}

	var rack uint64

	err = db.Raw(`SELECT id FROM placements WHERE warehouse_id = ? AND code = 'rak-picker'`, warehouse).Scan(&rack).Error
	if err != nil {
		t.Fatalf("the rack: %v", err)
	}

	report := func(at uint64) (*inventoryv1.FoundRequest, error) {
		res, reportErr := inventory.FoundRequestCreate(asWarehousePerson(41, at, role_basev1.Role_ROLE_WAREHOUSE_STAFF),
			connect.NewRequest(&inventoryv1.FoundRequestCreateRequest{
				TeamId: at, ProductId: product, RackId: rack, Quantity: 3, OrderId: order.GetId(),
			}))
		if reportErr != nil {
			return nil, reportErr
		}

		return res.Msg.GetFoundRequest(), nil
	}

	move(warehouse, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED)
	move(warehouse, sellingv1.OrderStatus_ORDER_STATUS_PICKED)
	move(warehouse, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING)
	move(team, sellingv1.OrderStatus_ORDER_STATUS_SHIPPED)

	_, err = report(warehouse)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "not lost") {
		t.Fatalf("a found of an order still shipped: err = %v, want FailedPrecondition", err)
	}

	move(team, sellingv1.OrderStatus_ORDER_STATUS_LOST)

	_, err = report(elsewhere)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("another warehouse naming the order: err = %v, want NotFound", err)
	}

	found, err := report(warehouse)
	if err != nil {
		t.Fatalf("report the lost parcel found: %v", err)
	}

	if found.GetOrderId() != order.GetId() || len(found.GetLines()) != 1 ||
		found.GetLines()[0].GetType() != inventoryv1.FoundRequestPostType_FOUND_REQUEST_POST_TYPE_ORDER_MINT ||
		found.GetLines()[0].GetStockCount() != 3 || !san_money.Equal(found.GetLines()[0].GetPriceUnit(), 10000) {
		t.Fatalf("the found = %+v, want it naming order %d and minting 3 at Rp 10.000", found, order.GetId())
	}

	stillLost := func(when string) []*sellingv1.OrderTimelineLog {
		t.Helper()

		detail, detailErr := svc.OrderDetail(ctx, connect.NewRequest(&sellingv1.OrderDetailRequest{
			TeamId: team, OrderId: order.GetId(),
		}))
		if detailErr != nil {
			t.Fatalf("order detail %s: %v", when, detailErr)
		}

		if detail.Msg.GetOrder().GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_LOST {
			t.Fatalf("the order is %v %s, want LOST", detail.Msg.GetOrder().GetStatus(), when)
		}

		return detail.Msg.GetOrder().GetTimelineLogs()
	}

	// THE ORDER'S TIMELINE NAMES THE REQUEST — a note from the warehouse, by the reporter — and the order stays lost.
	logs := stillLost("after the report")
	naming := "found request #" + strconv.FormatUint(found.GetId(), 10)

	var notes []*sellingv1.OrderTimelineLog

	for _, l := range logs {
		if strings.Contains(l.GetNote(), naming) {
			notes = append(notes, l)
		}
	}

	if len(notes) != 1 || notes[0].GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED ||
		notes[0].GetFrom() != sellingv1.OrderTimelineFrom_ORDER_TIMELINE_FROM_WAREHOUSE || notes[0].GetActorId() != 41 {
		t.Fatalf("the notes naming %q = %v, want one warehouse note by 41 moving nothing", naming, notes)
	}

	approved, err := inventory.FoundRequestApprove(asWarehousePerson(43, warehouse, role_basev1.Role_ROLE_WAREHOUSE_ADMIN),
		connect.NewRequest(&inventoryv1.FoundRequestApproveRequest{TeamId: warehouse, FoundRequestId: found.GetId()}))
	if err != nil {
		t.Fatalf("approve: %v", err)
	}

	lines := approved.Msg.GetFoundRequest().GetLines()
	if len(lines) != 1 || lines[0].GetBatchId() == 0 || !san_money.Equal(lines[0].GetAmount(), 30000) {
		t.Fatalf("posted %v, want one batch of 3 worth Rp 30.000", lines)
	}

	var onRack int64

	db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM product_placements WHERE product_id = ? AND placement_id = ?`,
		product, rack).Scan(&onRack)

	if onRack != 5 {
		t.Fatalf("the rack holds %d, want 5 — the 2 left and the 3 back", onRack)
	}

	stillLost("after the approval")
}
