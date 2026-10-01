//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ShipmentChannelByIds -v ./backend/services/shipment_service/shipment_v1/
package shipment_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
)

func TestPerf_ShipmentChannelByIds(t *testing.T) {
	db, probe, svc, rows := perfSetup(t, perfChannels)
	ctx := context.Background()

	for _, n := range []int{20, 200} {
		ids := make([]uint64, 0, n)
		for i := range n {
			ids = append(ids, rows[i].ID)
		}

		req := &shipmentv1.ShipmentChannelByIdsRequest{
			Filter: &shipmentv1.ShipmentChannelByIdsFilter{Ids: ids},
			DataRequest: []shipmentv1.ShipmentChannelByIdsDataType{
				shipmentv1.ShipmentChannelByIdsDataType_SHIPMENT_CHANNEL_BY_IDS_DATA_TYPE_GENERAL,
				shipmentv1.ShipmentChannelByIdsDataType_SHIPMENT_CHANNEL_BY_IDS_DATA_TYPE_CHANNEL,
			},
		}

		perfRun(t, probe, fmt.Sprintf("ShipmentChannelByIds/ids%d", n), func(int) error {
			_, err := svc.ShipmentChannelByIds(ctx, connect.NewRequest(req))
			return err
		})

		explainAll(t, db, probe)
	}
}
