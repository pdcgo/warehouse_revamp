package shipment_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// a-deleted-channel-still-resolves-by-id: a deleted channel comes back flagged; an unknown id is absent.
func TestShipmentChannelByIds_ReturnsDeletedAndOmitsUnknown(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	jne := seeded(t, db, "jne")
	jnt := seeded(t, db, "jnt")

	_, err := svc.ShipmentChannelDelete(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelDeleteRequest{ChannelId: jnt.ID}))
	if err != nil {
		t.Fatalf("delete: %v", err)
	}

	const unknown = uint64(999_999)

	resp, err := svc.ShipmentChannelByIds(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelByIdsRequest{
		Filter: &shipmentv1.ShipmentChannelByIdsFilter{Ids: []uint64{jne.ID, jnt.ID, unknown}},
	}))
	if err != nil {
		t.Fatalf("ShipmentChannelByIds: %v", err)
	}

	items := resp.Msg.GetItems()

	if _, ok := items[unknown]; ok {
		t.Error("an unknown id was returned")
	}

	channelOf := func(id uint64) *shipmentv1.ShipmentChannel {
		list, ok := items[id]
		if !ok {
			t.Fatalf("id %d missing from the response", id)
		}

		for _, it := range list.GetItems() {
			if c := it.GetChannel(); c != nil {
				return c.GetMapData()[id]
			}
		}

		t.Fatalf("id %d has no CHANNEL slice — the empty data_request did not default", id)

		return nil
	}

	if got := channelOf(jne.ID); got.GetIsDeleted() || got.GetCode() != "jne" {
		t.Errorf("jne = %+v, want live jne", got)
	}

	if got := channelOf(jnt.ID); !got.GetIsDeleted() || got.GetName() != jnt.Name {
		t.Errorf("jnt = %+v, want deleted and still named %q", got, jnt.Name)
	}
}
