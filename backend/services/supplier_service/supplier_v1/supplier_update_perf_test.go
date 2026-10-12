//go:build perfaudit

// go test -tags perfaudit -run TestPerf_SupplierUpdate -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
)

func TestPerf_SupplierUpdate(t *testing.T) {
	b := perfSetup(t)

	perfRun(t, b, "SupplierUpdate", func(i int) error {
		name := fmt.Sprintf("PT Perf Ubah %d", i)
		contact := "089999999999"

		_, err := b.svc.SupplierUpdate(context.Background(), connect.NewRequest(&supplierv1.SupplierUpdateRequest{
			TeamId:     b.team,
			SupplierId: b.own[0],
			Name:       &name,
			Contact:    &contact,
		}))

		return err
	})
}
