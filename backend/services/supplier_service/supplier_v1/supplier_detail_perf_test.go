//go:build perfaudit

// go test -tags perfaudit -run TestPerf_SupplierDetail -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
)

func TestPerf_SupplierDetail(t *testing.T) {
	b := perfSetup(t)

	perfRun(t, b, "SupplierDetail", func(int) error {
		_, err := b.svc.SupplierDetail(context.Background(), connect.NewRequest(&supplierv1.SupplierDetailRequest{
			TeamId:     b.team + 1, // a reader from another team
			SupplierId: b.own[10],
		}))

		return err
	})
}
