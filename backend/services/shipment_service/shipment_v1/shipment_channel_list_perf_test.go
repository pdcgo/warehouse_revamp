//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ShipmentChannelList -v ./backend/services/shipment_service/shipment_v1/
package shipment_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
)

func TestPerf_ShipmentChannelList(t *testing.T) {
	db, probe, svc, _ := perfSetup(t, perfChannels)
	ctx := context.Background()

	both := []shipmentv1.ShipmentChannelListDataType{
		shipmentv1.ShipmentChannelListDataType_SHIPMENT_CHANNEL_LIST_DATA_TYPE_GENERAL,
		shipmentv1.ShipmentChannelListDataType_SHIPMENT_CHANNEL_LIST_DATA_TYPE_CHANNEL,
	}

	cases := []struct {
		name string
		req  *shipmentv1.ShipmentChannelListRequest
	}{
		{"limit20", &shipmentv1.ShipmentChannelListRequest{Page: &commonv1.CommonPagination{Page: 1, Limit: 20}}},
		{"limit200", &shipmentv1.ShipmentChannelListRequest{Page: &commonv1.CommonPagination{Page: 1, Limit: 200}}},
		{"q_include_deleted", &shipmentv1.ShipmentChannelListRequest{
			Filter:      &shipmentv1.ShipmentChannelListFilter{Q: "0012", IncludeDeleted: true},
			Page:        &commonv1.CommonPagination{Page: 1, Limit: 20},
			DataRequest: both,
		}},
	}

	for _, c := range cases {
		perfRun(t, probe, "ShipmentChannelList/"+c.name, func(int) error {
			_, err := svc.ShipmentChannelList(ctx, connect.NewRequest(c.req))
			return err
		})

		explainAll(t, db, probe)
	}
}
