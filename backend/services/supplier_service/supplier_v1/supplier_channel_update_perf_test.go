//go:build perfaudit

// go test -tags perfaudit -run TestPerf_SupplierChannelUpdate -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
)

func TestPerf_SupplierChannelUpdate(t *testing.T) {
	b := perfSetup(t)

	perfRun(t, b, "SupplierChannelUpdate", func(i int) error {
		name := fmt.Sprintf("Perf Store Ubah %d", i)
		typ := marketplacev1.Marketplace_MARKETPLACE_LAZADA

		_, err := b.svc.SupplierChannelUpdate(context.Background(), connect.NewRequest(&supplierv1.SupplierChannelUpdateRequest{
			TeamId:      b.team,
			ChannelId:   b.ownStores[0],
			Name:        &name,
			ChannelType: &typ,
		}))

		return err
	})
}
