package shipment_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// a-code-never-changes: only name and desc move; updated_at moves with them.
func TestShipmentChannelUpdate_EditsNameAndDescOnly(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	// Backdate so NOW() inside the test transaction is measurably later.
	jne := seeded(t, db, "jne")

	err := db.Exec("UPDATE shipment_channels SET updated_at = ? WHERE id = ?", time.Now().Add(-time.Hour), jne.ID).Error
	if err != nil {
		t.Fatalf("backdate: %v", err)
	}

	resp, err := svc.ShipmentChannelUpdate(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelUpdateRequest{
		ChannelId: jne.ID,
		Name:      "JNE Express",
		Desc:      "pickup at 15:00",
	}))
	if err != nil {
		t.Fatalf("ShipmentChannelUpdate: %v", err)
	}

	got := resp.Msg.GetChannel()

	if got.GetName() != "JNE Express" || got.GetDesc() != "pickup at 15:00" || got.GetCode() != "jne" {
		t.Fatalf("updated = %+v", got)
	}

	if !got.GetUpdatedAt().AsTime().After(time.Now().Add(-30 * time.Minute)) {
		t.Fatalf("updated_at = %v, did not move", got.GetUpdatedAt().AsTime())
	}
}

// Re-sending identical values is not NotFound — Postgres counts matched rows.
func TestShipmentChannelUpdate_IdenticalValuesSucceed(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	jne := seeded(t, db, "jne")

	for range 2 {
		_, err := svc.ShipmentChannelUpdate(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelUpdateRequest{
			ChannelId: jne.ID,
			Name:      jne.Name,
			Desc:      jne.Desc,
		}))
		if err != nil {
			t.Fatalf("identical update: %v", err)
		}
	}
}

func TestShipmentChannelUpdate_UnknownIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.ShipmentChannelUpdate(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelUpdateRequest{
		ChannelId: 999_999,
		Name:      "ghost",
	}))

	if code := connectCode(t, err); code != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", code)
	}
}
