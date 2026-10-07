//go:build perfaudit

// go test -tags perfaudit -run TestPerf_SupplierChannelDelete -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
)

// A delete is one-shot, so each of the 6 calls (warm-up + 5) deletes its own live store of the big supplier.
func TestPerf_SupplierChannelDelete(t *testing.T) {
	b := perfSetup(t)

	perfRun(t, b, "SupplierChannelDelete", func(i int) error {
		_, err := b.svc.SupplierChannelDelete(context.Background(), connect.NewRequest(&supplierv1.SupplierChannelDeleteRequest{
			TeamId:    b.team,
			ChannelId: b.bigStores[i+1],
		}))

		return err
	})
}
