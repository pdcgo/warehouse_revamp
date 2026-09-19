//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ShipmentChannelDelete -v ./backend/services/shipment_service/shipment_v1/
package shipment_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
)

func TestPerf_ShipmentChannelDelete(t *testing.T) {
	db, probe, svc, rows := perfSetup(t, perfChannels)
	ctx := context.Background()
	target := rows[len(rows)/2].ID

	perfRun(t, probe, "ShipmentChannelDelete", func(int) error {
		_, err := svc.ShipmentChannelDelete(ctx, connect.NewRequest(&shipmentv1.ShipmentChannelDeleteRequest{ChannelId: target}))
		return err
	})

	explainAll(t, db, probe)
}
