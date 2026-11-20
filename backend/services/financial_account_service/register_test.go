package financial_account_service_test

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
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

const (
	registerTeam  uint64 = 9_201
	registerActor uint64 = 62
)

// THE CUSTOM SHIPMENT'S COURIER IS MOUNTED: `san pubsub ensure` declares financial-account-custom-shipment-created,
// -cost-updated and -cancelled, so the service must serve /event/<sub>/push for each — an unmounted route passes every
// handler test while the running app dead-letters every push. Through the REAL mux, as the emulator calls it: a *Kami
// bayar* parcel's cost leaves the account, an edit takes the difference, the cancel gives it all back.
func TestRegister_TheCustomShipmentCourierReachesTheAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := financial_account_v1.NewService(db, nil, nil)
	mux := http.NewServeMux()
	financial_account_service.NewRegister(mux, svc, connect.WithInterceptors())()

	ctx := san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: registerActor})

	created, err := svc.FinancialAccountCreate(ctx, connect.NewRequest(&financial_accountv1.FinancialAccountCreateRequest{
		TeamId:         registerTeam,
		Type:           financial_accountv1.FinancialAccountType_FINANCIAL_ACCOUNT_TYPE_CASH,
		Provider:       financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_CASH,
		Name:           "Kas Toko",
		HolderName:     "PT Uji",
		OpeningBalance: 100_000,
		OpeningOn:      time.Now().AddDate(0, 0, -10).Format("2006-01-02"),
	}))
	if err != nil {
		t.Fatalf("create account: %v", err)
	}

	account := created.Msg.GetAccount().GetId()
	payer := inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_TEAM

	deliver(t, mux, financial_account_service.CustomShipmentCreatedSubscription, &eventsv1.Event{
		EventId:    "custom-shipment-created:9301",
		OccurredAt: timestamppb.Now(),
		Message: &eventsv1.Event_CustomShipmentCreated{CustomShipmentCreated: &eventsv1.CustomShipmentCreated{
			CustomShipmentId: 9301, TeamId: registerTeam, WarehouseId: 9_202, Payer: payer,
			FinanceAccountId: account, Amount: 12_000, ActorId: registerActor,
		}},
	})
	deliver(t, mux, financial_account_service.CustomShipmentCostUpdatedSubscription, &eventsv1.Event{
		EventId:    "custom-shipment-cost-updated:9301:1",
		OccurredAt: timestamppb.Now(),
		Message: &eventsv1.Event_CustomShipmentCostUpdated{CustomShipmentCostUpdated: &eventsv1.CustomShipmentCostUpdated{
			CustomShipmentId: 9301, TeamId: registerTeam, OldFinanceAccountId: account, NewFinanceAccountId: account,
			OldAmount: 12_000, NewAmount: 15_000, ActorId: registerActor,
		}},
	})

	if got := accountBalance(t, db, account); got != 85_000 {
		t.Fatalf("balance = %v after the create and the edit, want 85000", got)
	}

	deliver(t, mux, financial_account_service.CustomShipmentCancelledSubscription, &eventsv1.Event{
		EventId:    "custom-shipment-cancelled:9301",
		OccurredAt: timestamppb.Now(),
		Message: &eventsv1.Event_CustomShipmentCancelled{CustomShipmentCancelled: &eventsv1.CustomShipmentCancelled{
			CustomShipmentId: 9301, TeamId: registerTeam, WarehouseId: 9_202, Payer: payer,
			FinanceAccountId: account, Amount: 15_000, ActorId: registerActor,
		}},
	})

	if got := accountBalance(t, db, account); got != 100_000 {
		t.Fatalf("balance = %v after the cancel, want 100000 — everything posted came back", got)
	}
}

func accountBalance(t *testing.T, db *gorm.DB, id uint64) float64 {
	t.Helper()

	var account m.FinancialAccount

	err := db.Where("id = ?", id).
		Take(&account).
		Error
	if err != nil {
		t.Fatalf("read account %d: %v", id, err)
	}

	return account.Balance
}

// deliver POSTs one event to /event/<sub>/push the way Pub/Sub's push does, and requires a 2xx (an ACK).
func deliver(t *testing.T, mux *http.ServeMux, subscription string, event *eventsv1.Event) {
	t.Helper()

	// The envelope as the publisher writes it — the push route validates it (an aggregate id is required).
	event.AggregateId = event.GetEventId()

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
