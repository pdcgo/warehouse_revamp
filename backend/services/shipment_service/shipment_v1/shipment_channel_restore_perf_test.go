//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ShipmentChannelRestore -v ./backend/services/shipment_service/shipment_v1/
package shipment_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
)

func TestPerf_ShipmentChannelRestore(t *testing.T) {
	db, probe, svc, rows := perfSetup(t, perfChannels)
	ctx := context.Background()
	target := rows[0].ID // seeded deleted

	perfRun(t, probe, "ShipmentChannelRestore", func(int) error {
		_, err := svc.ShipmentChannelRestore(ctx, connect.NewRequest(&shipmentv1.ShipmentChannelRestoreRequest{ChannelId: target}))
		return err
	})

	explainAll(t, db, probe)
}
