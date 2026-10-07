package shipment_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_service_models"
	shipment_v1 "github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_v1"
)

func newService(t *testing.T, db *gorm.DB) *shipment_v1.Service {
	t.Helper()

	return shipment_v1.NewService(db)
}

// seeded returns a channel the migration seeded, by code.
func seeded(t *testing.T, db *gorm.DB, code string) shipment_service_models.ShipmentChannel {
	t.Helper()

	var c shipment_service_models.ShipmentChannel

	err := db.Where("code = ?", code).First(&c).Error
	if err != nil {
		t.Fatalf("seeded channel %q: %v", code, err)
	}

	return c
}

func connectCode(t *testing.T, err error) connect.Code {
	t.Helper()

	if err == nil {
		t.Fatal("expected an error, got nil")
	}

	return connect.CodeOf(err)
}

func mustCreate(t *testing.T, svc *shipment_v1.Service, code, name string) *shipmentv1.ShipmentChannel {
	t.Helper()

	resp, err := svc.ShipmentChannelCreate(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelCreateRequest{
		Code: code,
		Name: name,
	}))
	if err != nil {
		t.Fatalf("create %q: %v", code, err)
	}

	return resp.Msg.GetChannel()
}
