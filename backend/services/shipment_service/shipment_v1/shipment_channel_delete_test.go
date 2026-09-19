package shipment_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_service_models"
)

// a-channel-is-soft-deleted: the row stays, flagged. Deleting twice is fine.
func TestShipmentChannelDelete_SoftDeletesAndIsIdempotent(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	jne := seeded(t, db, "jne")

	for range 2 {
		resp, err := svc.ShipmentChannelDelete(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelDeleteRequest{ChannelId: jne.ID}))
		if err != nil {
			t.Fatalf("ShipmentChannelDelete: %v", err)
		}

		if !resp.Msg.GetChannel().GetIsDeleted() {
			t.Fatal("channel not flagged deleted")
		}
	}

	var count int64

	err := db.Model(&shipment_service_models.ShipmentChannel{}).Where("id = ?", jne.ID).Count(&count).Error
	if err != nil || count != 1 {
		t.Fatalf("row count = %d (err %v) — the row must stay", count, err)
	}
}

func TestShipmentChannelDelete_UnknownIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.ShipmentChannelDelete(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelDeleteRequest{ChannelId: 999_999}))

	if code := connectCode(t, err); code != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", code)
	}
}
