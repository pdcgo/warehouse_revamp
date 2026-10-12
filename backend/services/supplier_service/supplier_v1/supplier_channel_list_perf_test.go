//go:build perfaudit

// go test -tags perfaudit -run TestPerf_SupplierChannelList -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
)

// The Channels tab of the supplier with 300 stores, with and without q and channel_type, at two page sizes.
func TestPerf_SupplierChannelList(t *testing.T) {
	b := perfSetup(t)

	cases := []struct {
		name     string
		supplier uint64
		q        string
		typ      marketplacev1.Marketplace
	}{
		{"big", b.big, "", marketplacev1.Marketplace_MARKETPLACE_UNSPECIFIED},
		{"big/q", b.big, perfQ, marketplacev1.Marketplace_MARKETPLACE_UNSPECIFIED},
		{"big/type=shopee", b.big, "", marketplacev1.Marketplace_MARKETPLACE_SHOPEE},
		{"big/q+type=shopee", b.big, perfQ, marketplacev1.Marketplace_MARKETPLACE_SHOPEE},
		{"typical-3-stores", b.own[0], "", marketplacev1.Marketplace_MARKETPLACE_UNSPECIFIED},
	}

	for _, c := range cases {
		for _, size := range []uint32{20, 200} {
			perfRun(t, b, fmt.Sprintf("SupplierChannelList/%s/limit=%d", c.name, size), func(int) error {
				_, err := b.svc.SupplierChannelList(context.Background(), connect.NewRequest(&supplierv1.SupplierChannelListRequest{
					TeamId: b.team + 1, // a reader from another team: reads cross teams
					Filter: &supplierv1.SupplierChannelListFilter{SupplierId: c.supplier, Q: c.q, ChannelType: c.typ},
					DataRequest: []supplierv1.SupplierChannelListDataType{
						supplierv1.SupplierChannelListDataType_SUPPLIER_CHANNEL_LIST_DATA_TYPE_SUPPLIER_CHANNEL,
					},
					Page: perfPage(1, size),
				}))

				return err
			})
		}
	}
}
