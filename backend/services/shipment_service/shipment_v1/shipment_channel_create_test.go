package shipment_v1_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestShipmentChannelCreate_CreatesALiveChannel(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	got := mustCreate(t, svc, "anteraja", "AnterAja")

	if got.GetId() == 0 || got.GetCode() != "anteraja" || got.GetIsDeleted() {
		t.Fatalf("created = %+v", got)
	}

	if got.GetCreatedAt() == nil || got.GetUpdatedAt() == nil {
		t.Fatal("timestamps were not returned")
	}
}

func TestShipmentChannelCreate_RefusesALiveCode(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.ShipmentChannelCreate(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelCreateRequest{
		Code: "jne",
		Name: "JNE again",
	}))

	if code := connectCode(t, err); code != connect.CodeAlreadyExists {
		t.Fatalf("code = %v, want AlreadyExists", code)
	}
}

// a-deleted-code-is-restored-not-recreated: refused, and the message points at restore.
func TestShipmentChannelCreate_RefusesADeletedCodeAndSaysRestore(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	jnt := seeded(t, db, "jnt")

	_, err := svc.ShipmentChannelDelete(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelDeleteRequest{ChannelId: jnt.ID}))
	if err != nil {
		t.Fatalf("delete: %v", err)
	}

	_, err = svc.ShipmentChannelCreate(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelCreateRequest{
		Code: "jnt",
		Name: "J&T",
	}))

	if code := connectCode(t, err); code != connect.CodeAlreadyExists {
		t.Fatalf("code = %v, want AlreadyExists", code)
	}

	if !strings.Contains(err.Error(), "restore") {
		t.Fatalf("message %q does not point at restore", err.Error())
	}
}
