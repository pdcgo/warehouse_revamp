//go:build perfaudit

// go test -tags perfaudit -run TestPerf_SupplierDelete -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
)

// A delete is one-shot, so each of the 6 calls (warm-up + 5) deletes its own live supplier.
func TestPerf_SupplierDelete(t *testing.T) {
	b := perfSetup(t)

	perfRun(t, b, "SupplierDelete", func(i int) error {
		_, err := b.svc.SupplierDelete(context.Background(), connect.NewRequest(&supplierv1.SupplierDeleteRequest{
			TeamId:     b.team,
			SupplierId: b.own[i+11],
		}))

		return err
	})
}
