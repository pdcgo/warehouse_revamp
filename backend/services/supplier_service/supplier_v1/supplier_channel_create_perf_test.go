//go:build perfaudit

// go test -tags perfaudit -run TestPerf_SupplierChannelCreate -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
)

func TestPerf_SupplierChannelCreate(t *testing.T) {
	b := perfSetup(t)

	perfRun(t, b, "SupplierChannelCreate", func(i int) error {
		_, err := b.svc.SupplierChannelCreate(context.Background(), connect.NewRequest(&supplierv1.SupplierChannelCreateRequest{
			TeamId:      b.team,
			SupplierId:  b.own[1],
			ChannelType: marketplacev1.Marketplace_MARKETPLACE_TOKOPEDIA,
			Name:        fmt.Sprintf("Perf Store %d", i),
			Uri:         "https://store.example/perf",
		}))

		return err
	})
}
