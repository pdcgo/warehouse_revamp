//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ShipmentChannelUpdate -v ./backend/services/shipment_service/shipment_v1/
package shipment_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
)

func TestPerf_ShipmentChannelUpdate(t *testing.T) {
	db, probe, svc, rows := perfSetup(t, perfChannels)
	ctx := context.Background()
	target := rows[len(rows)/2].ID

	perfRun(t, probe, "ShipmentChannelUpdate", func(int) error {
		_, err := svc.ShipmentChannelUpdate(ctx, connect.NewRequest(&shipmentv1.ShipmentChannelUpdateRequest{
			ChannelId: target,
			Name:      "Renamed",
			Desc:      "perf",
		}))
		return err
	})

	explainAll(t, db, probe)
}
