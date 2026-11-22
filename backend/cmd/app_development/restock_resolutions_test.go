package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/encoding/protojson"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service"
	fam "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// A RESTOCK'S RESOLUTIONS, THROUGH THE REAL WIRING (backlog #101 — a-restock-problem-is-settled-by-resolution-rows,
// a-suppliers-reshipping-comes-in-as-a-custom-shipment, each 🔄). Melati's restock to Gudang E is lost. Inventory is
// wired with the composition root's paying-accounts seam over financial_account's own tables; what it publishes is
// pushed through the REAL routes of financial_account and liability, as the emulator pushes them:
//
//   - a REFUND of Rp 50.000 into Kas Toko (an active account — not operational) RAISES it, a `restock` row naming the
//     restock — once, though delivered twice;
//   - the seller marks the restock settled; a RESHIPPING's inbound parcel is signed for at Gudang E (the courier's charge
//     Rp 8.000 noted) and counted in short at Terima (charge final Rp 6.000): its good units are stock at the seller's
//     price, the restock is REOPENED (the settled mark lifted), and the door charge reaches Team Balance — the selling
//     team owes Gudang E Rp 6.000.
func TestRestockResolutions_ThroughTheRealWiring(t *testing.T) {
	const (
		team      uint64 = 9_001_010
		warehouse uint64 = 9_001_011
		product   uint64 = 9_001_012
		seller    uint64 = 71
		staff     uint64 = 72
		courier   uint64 = 5
	)

	db := san_testdb.DB(t)

	accounts := financial_account_v1.NewService(db, nil, nil, nil)
	accountsMux := http.NewServeMux()
	financial_account_service.NewRegister(accountsMux, accounts, connect.WithInterceptors())()

	liabilityMux := http.NewServeMux()
	liability_service.NewRegister(liabilityMux, liability_v1.NewService(db, nil, nil, nil), connect.WithInterceptors())()

	var published []*eventsv1.Event

	send := func(_ context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
		published = append(published, event)

		return nil
	}

	inventory := inventory_v1.NewService(db, nil, nil, nil, send, lostOrderCatalog{team: team}, nil,
		NewRestockPayingAccounts(accounts), nil, nil)

	asSeller := san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: seller})
	asStaff := asWarehousePerson(staff, warehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF)

	box, err := accounts.FinancialAccountCreate(asSeller, connect.NewRequest(&financial_accountv1.FinancialAccountCreateRequest{
		TeamId:         team,
		Type:           financial_accountv1.FinancialAccountType_FINANCIAL_ACCOUNT_TYPE_CASH,
		Provider:       financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_CASH,
		Name:           "Kas Toko",
		HolderName:     "PT Melati",
		OpeningBalance: 100_000,
		OpeningOn:      time.Now().AddDate(0, 0, -10).Format("2006-01-02"),
	}))
	if err != nil {
		t.Fatalf("create account: %v", err)
	}

	account := box.Msg.GetAccount().GetId()

	created, err := inventory.RestockRequestCreate(asSeller, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: team, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: product, ProductCode: "SKU", Name: "Kaos", Count: 6, Total: 60_000}},
	}))
	if err != nil {
		t.Fatalf("restock: %v", err)
	}

	restock := created.Msg.GetRequest().GetId()

	_, err = inventory.RestockRequestMarkLost(asSeller, connect.NewRequest(&inventoryv1.RestockRequestMarkLostRequest{
		TeamId: team, RequestId: restock, Description: "the courier lost it",
	}))
	if err != nil {
		t.Fatalf("mark lost: %v", err)
	}

	// THE REFUND — raises the account it names, once.
	_, err = inventory.RestockResolutionCreate(asSeller, connect.NewRequest(&inventoryv1.RestockResolutionCreateRequest{
		TeamId: team, RestockId: restock, Type: inventoryv1.RestockResolutionType_RESTOCK_RESOLUTION_TYPE_REFUND,
		RefundAmount: 50_000, FinanceAccountId: account, Note: "the supplier transferred it back", IdempotencyKey: "refund-1",
	}))
	if err != nil {
		t.Fatalf("refund: %v", err)
	}

	refund := lastOf[*eventsv1.Event_RestockRefunded](t, published)
	pushEvent(t, accountsMux, financial_account_service.RestockRefundedSubscription, refund)
	pushEvent(t, accountsMux, financial_account_service.RestockRefundedSubscription, refund)

	var raised fam.FinancialAccount

	err = db.Where("id = ?", account).
		Take(&raised).
		Error
	if err != nil {
		t.Fatalf("read the account: %v", err)
	}

	if raised.Balance != 150_000 {
		t.Fatalf("Kas Toko = %v, want 150000 — raised by the refund, once", raised.Balance)
	}

	var rows []fam.FinancialAccountLog

	err = db.Where("account_id = ? AND change_type = ?", account, fam.ChangeRestock).
		Find(&rows).
		Error
	if err != nil {
		t.Fatalf("read the history: %v", err)
	}

	if len(rows) != 1 || rows[0].Change != 50_000 || !strings.Contains(rows[0].Description, "Restock #") ||
		rows[0].ActorID != seller {
		t.Fatalf("history = %+v, want one `restock` row of +50000 naming the restock", rows)
	}

	// SETTLED, then a reshipping arrives short — the restock reopens; the door charge reaches Team Balance.
	_, err = inventory.RestockRequestSettle(asSeller, connect.NewRequest(&inventoryv1.RestockRequestSettleRequest{
		TeamId: team, RequestId: restock,
	}))
	if err != nil {
		t.Fatalf("settle: %v", err)
	}

	reshipped, err := inventory.RestockResolutionCreate(asSeller, connect.NewRequest(&inventoryv1.RestockResolutionCreateRequest{
		TeamId: team, RestockId: restock, Type: inventoryv1.RestockResolutionType_RESTOCK_RESOLUTION_TYPE_RESHIPPING,
		Reshipping: &inventoryv1.RestockReshippingParcel{
			ShipmentChannelId: courier,
			Lines:             []*inventoryv1.RestockReshippingLine{{ProductId: product, Count: 6, PriceUnit: 9_500}},
		},
		IdempotencyKey: "reship-1",
	}))
	if err != nil {
		t.Fatalf("reshipping: %v", err)
	}

	parcel := reshipped.Msg.GetCustomShipment()

	rack, err := inventory.RackCreate(asStaff, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "rak-e"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}

	_, err = inventory.CustomShipmentArrive(asStaff, connect.NewRequest(&inventoryv1.CustomShipmentArriveRequest{
		TeamId: warehouse, Id: parcel.GetId(), DoorCharge: 8_000, DoorChargeNote: "COD",
	}))
	if err != nil {
		t.Fatalf("arrive: %v", err)
	}

	received, err := inventory.CustomShipmentReceive(asStaff, connect.NewRequest(&inventoryv1.CustomShipmentReceiveRequest{
		TeamId: warehouse, Id: parcel.GetId(), DoorCharge: 6_000, DoorChargeNote: "the courier's final ask",
		Lines: []*inventoryv1.CustomShipmentReceivedLine{
			{ItemId: parcel.GetItems()[0].GetId(), Received: 5, RackId: rack.Msg.GetRack().GetId()},
		},
	}))
	if err != nil {
		t.Fatalf("receive: %v", err)
	}

	var price float64

	err = db.Raw(`SELECT price_unit FROM batches WHERE transaction_id = ?`, received.Msg.GetCustomShipment().GetTransactionId()).
		Scan(&price).
		Error
	if err != nil || price != 9_500 {
		t.Fatalf("the stock-in's batch price = %v (%v), want the seller's 9500", price, err)
	}

	detail, err := inventory.RestockRequestDetail(asSeller, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: team, RequestId: restock,
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if r := detail.Msg.GetRequest(); r.GetSettledAtUnix() != 0 || r.GetResolutionCount() != 2 {
		t.Fatalf("after a short Terima: settled %d, rows %d — want reopened, 2 rows", r.GetSettledAtUnix(), r.GetResolutionCount())
	}

	charge := lastOf[*eventsv1.Event_CustomShipmentReceived](t, published)
	pushEvent(t, liabilityMux, liability_service.CustomShipmentReceivedSubscription, charge)
	pushEvent(t, liabilityMux, liability_service.CustomShipmentReceivedSubscription, charge)

	var owed liability_service_models.LiabilityBalance

	err = db.Where("team_id = ? AND counterparty_id = ?", warehouse, team).
		Take(&owed).
		Error
	if err != nil {
		t.Fatalf("read Team Balance: %v", err)
	}

	if owed.Balance != 6_000 {
		t.Fatalf("Gudang E is owed %v by the selling team, want Terima's final 6000 — once", owed.Balance)
	}
}

// lastOf is the last published event of one variant, whole.
func lastOf[T any](t *testing.T, published []*eventsv1.Event) *eventsv1.Event {
	t.Helper()

	for i := len(published) - 1; i >= 0; i-- {
		if _, ok := published[i].GetMessage().(T); ok {
			return published[i]
		}
	}

	t.Fatalf("no %T was published", *new(T))

	return nil
}

// pushEvent POSTs one event to /event/<sub>/push as Pub/Sub's push does, and requires a 2xx (an ACK).
func pushEvent(t *testing.T, mux *http.ServeMux, subscription string, event *eventsv1.Event) {
	t.Helper()

	data, err := protojson.Marshal(event)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	body, err := json.Marshal(event_source.PushRequest{
		Subscription: "projects/p/subscriptions/" + subscription,
		Message:      event_source.PushMessage{Data: data, MessageID: subscription},
	})
	if err != nil {
		t.Fatalf("marshal push: %v", err)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/event/"+subscription+"/push", strings.NewReader(string(body))))

	if rec.Code/100 != 2 {
		t.Fatalf("push to %s = %d %q, want an ACK", subscription, rec.Code, rec.Body.String())
	}
}
