package inventory_v1_test

import (
	"strconv"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// THE RESTOCK RESOLUTIONS' FIXTURE (backlog #101 P1) — the custom shipments' (csStocked): Melati's restock to Gudang 5
// (A), received with 3 Widgets and 2 Gadgets broken (*Barang rusak* on), lines from suppliers 31 and 32; a second restock
// still on its way; Sinar's received restock. The service knows the restock tests' accounts (41 operational, 42 active,
// 43 archived; 44 is another team's).

const (
	rsRefundType     = inventoryv1.RestockResolutionType_RESTOCK_RESOLUTION_TYPE_REFUND
	rsReturnType     = inventoryv1.RestockResolutionType_RESTOCK_RESOLUTION_TYPE_RETURN
	rsReshippingType = inventoryv1.RestockResolutionType_RESTOCK_RESOLUTION_TYPE_RESHIPPING
)

func rsStocked(t *testing.T) *csFixture {
	t.Helper()

	f := csStocked(t)
	f.svc = newCustomShipmentServiceWithAccounts(f)

	return f
}

func (f *csFixture) resolve(req *inventoryv1.RestockResolutionCreateRequest) (*inventoryv1.RestockResolutionCreateResponse, error) {
	res, err := f.svc.RestockResolutionCreate(ctxUser(wtSeller), connect.NewRequest(req))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

func (f *csFixture) mustResolve(t *testing.T, req *inventoryv1.RestockResolutionCreateRequest) *inventoryv1.RestockResolutionCreateResponse {
	t.Helper()

	res, err := f.resolve(req)
	if err != nil {
		t.Fatalf("resolution: %v", err)
	}

	return res
}

func rsRefund(restock uint64, key string, amount float64, account uint64) *inventoryv1.RestockResolutionCreateRequest {
	return &inventoryv1.RestockResolutionCreateRequest{
		TeamId: otMelati, RestockId: restock, Type: rsRefundType, Note: "supplier transfer",
		RefundAmount: amount, FinanceAccountId: account, IdempotencyKey: key,
	}
}

func rsReturn(restock uint64, key string, parcel uint64) *inventoryv1.RestockResolutionCreateRequest {
	return &inventoryv1.RestockResolutionCreateRequest{
		TeamId: otMelati, RestockId: restock, Type: rsReturnType, CustomShipmentId: parcel, IdempotencyKey: key,
	}
}

func rsLine(product, count uint64, price float64) *inventoryv1.RestockReshippingLine {
	return &inventoryv1.RestockReshippingLine{ProductId: product, Count: count, PriceUnit: price}
}

func rsReshipping(restock uint64, key string, lines ...*inventoryv1.RestockReshippingLine) *inventoryv1.RestockResolutionCreateRequest {
	return &inventoryv1.RestockResolutionCreateRequest{
		TeamId: otMelati, RestockId: restock, Type: rsReshippingType, Note: "the supplier sends them again",
		Reshipping:     &inventoryv1.RestockReshippingParcel{ShipmentChannelId: csCourier, Resi: "JNE-1", Lines: lines},
		IdempotencyKey: key,
	}
}

// inbound is a reshipping's parcel on Melati's received restock: 3 Widgets at Rp 9.000 and 2 Kaos Hitam at Rp 5.000.
func (f *csFixture) inbound(t *testing.T, restock uint64, key string) *inventoryv1.CustomShipment {
	t.Helper()

	return f.mustResolve(t, rsReshipping(restock, key, rsLine(csWidget, 3, 9000), rsLine(wtKaosHitam, 2, 5000))).
		GetCustomShipment()
}

func (f *csFixture) restockAs(t *testing.T, team, user, id uint64) *inventoryv1.RestockRequest {
	t.Helper()

	res, err := f.svc.RestockRequestDetail(ctxUser(user), connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: team, RequestId: id,
	}))
	if err != nil {
		t.Fatalf("restock detail: %v", err)
	}

	return res.Msg.GetRequest()
}

func (f *csFixture) settle(team, id uint64) (*inventoryv1.RestockRequest, error) {
	res, err := f.svc.RestockRequestSettle(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.RestockRequestSettleRequest{
		TeamId: team, RequestId: id,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetRequest(), nil
}

// problemTagsOn is the app's problem tags a restock carries, by app task, sorted.
func problemTagsOn(t *testing.T, db *gorm.DB, restockID uint64) []string {
	t.Helper()

	var tasks []string

	err := db.Raw(`SELECT t.app_task FROM restock_tags rt JOIN tags t ON t.id = rt.tag_id
	               WHERE rt.restock_id = ? AND t.app_task <> '' ORDER BY t.app_task`, restockID).
		Scan(&tasks).Error
	if err != nil {
		t.Fatalf("read problem tags: %v", err)
	}

	return tasks
}

// lostRestock is a fresh restock of Melati's to A, given up on its way.
func (f *csFixture) lostRestock(t *testing.T) uint64 {
	t.Helper()

	id := csRestock(t, f.svc, otMelati,
		&inventoryv1.RestockRequestItem{ProductId: csWidget, ProductCode: "WG-1", Name: "Widget", Count: 6, Total: 60000, SupplierId: csSupplierA},
	).GetId()

	_, err := f.svc.RestockRequestMarkLost(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.RestockRequestMarkLostRequest{
		TeamId: otMelati, RequestId: id, Description: "courier lost it",
	}))
	if err != nil {
		t.Fatalf("mark lost: %v", err)
	}

	return id
}

// cleanRestock is a fresh restock of Melati's to A, received whole — no problem.
func (f *csFixture) cleanRestock(t *testing.T) uint64 {
	t.Helper()

	created := csRestock(t, f.svc, otMelati,
		&inventoryv1.RestockRequestItem{ProductId: csGizmo, ProductCode: "GZ-1", Name: "Gizmo", Count: 2, Total: 20000, SupplierId: csSupplierA},
	)

	_, err := f.svc.RestockRequestAccept(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: wtA, RequestId: created.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: created.GetItems()[0].GetId(), ReceivedCount: 2, Placements: placedOn(f.rakA, 2)},
		},
	}))
	if err != nil {
		t.Fatalf("accept the clean restock: %v", err)
	}

	return created.GetId()
}

// eventsOf is what was published of one variant, in order.
func eventsOf[T any](f *csFixture) []T {
	var out []T

	for _, e := range f.sent.events {
		if v, ok := e.GetMessage().(T); ok {
			out = append(out, v)
		}
	}

	return out
}

// codeOf asserts a refusal's Connect code.
func codeOf(t *testing.T, what string, err error, want connect.Code) {
	t.Helper()

	if connect.CodeOf(err) != want {
		t.Fatalf("%s: err = %v, want %s", what, err, want)
	}
}

// rsIDs is a list response's ids.
func rsIDs(rows []*inventoryv1.CustomShipment) []uint64 {
	out := make([]uint64, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.GetId())
	}

	return out
}

func itoaU(n uint64) string {
	return strconv.FormatUint(n, 10)
}

func rsPage() *commonv1.CommonPagination {
	return &commonv1.CommonPagination{Page: 1, Limit: 100}
}

// receivedEvents is every CustomShipmentReceived published.
func receivedEvents(f *csFixture) []*eventsv1.CustomShipmentReceived {
	var out []*eventsv1.CustomShipmentReceived

	for _, e := range eventsOf[*eventsv1.Event_CustomShipmentReceived](f) {
		out = append(out, e.CustomShipmentReceived)
	}

	return out
}
