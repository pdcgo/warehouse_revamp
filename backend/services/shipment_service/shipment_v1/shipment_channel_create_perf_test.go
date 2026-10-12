//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ShipmentChannelCreate -v ./backend/services/shipment_service/shipment_v1/
package shipment_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
)

func TestPerf_ShipmentChannelCreate(t *testing.T) {
	db, probe, svc, _ := perfSetup(t, perfChannels)
	ctx := context.Background()

	perfRun(t, probe, "ShipmentChannelCreate", func(i int) error {
		_, err := svc.ShipmentChannelCreate(ctx, connect.NewRequest(&shipmentv1.ShipmentChannelCreateRequest{
			Code: fmt.Sprintf("perf_new_%d", i+1),
			Name: "Perf New",
		}))
		return err
	})

	// Only the pre-check read — EXPLAIN ANALYZE of the INSERT would insert a duplicate code.
	san_perf.Explain(t, db, probe.Queries()[0].SQL)
}
