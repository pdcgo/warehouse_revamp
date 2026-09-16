package shipment_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// a-deleted-code-is-restored-not-recreated: same id, same code, live again.
func TestShipmentChannelRestore_KeepsIdAndCode(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	jnt := seeded(t, db, "jnt")

	_, err := svc.ShipmentChannelDelete(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelDeleteRequest{ChannelId: jnt.ID}))
	if err != nil {
		t.Fatalf("delete: %v", err)
	}

	resp, err := svc.ShipmentChannelRestore(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelRestoreRequest{ChannelId: jnt.ID}))
	if err != nil {
		t.Fatalf("ShipmentChannelRestore: %v", err)
	}

	got := resp.Msg.GetChannel()
	if got.GetId() != jnt.ID || got.GetCode() != "jnt" || got.GetIsDeleted() {
		t.Fatalf("restored = %+v, want live jnt with id %d", got, jnt.ID)
	}
}

func TestShipmentChannelRestore_LiveChannelIsIdempotent(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	jne := seeded(t, db, "jne")

	resp, err := svc.ShipmentChannelRestore(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelRestoreRequest{ChannelId: jne.ID}))
	if err != nil {
		t.Fatalf("ShipmentChannelRestore: %v", err)
	}

	if resp.Msg.GetChannel().GetIsDeleted() {
		t.Fatal("restoring a live channel deleted it")
	}
}

func TestShipmentChannelRestore_UnknownIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.ShipmentChannelRestore(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelRestoreRequest{ChannelId: 999_999}))

	if code := connectCode(t, err); code != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", code)
	}
}
