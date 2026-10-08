//go:build perfaudit

// go test -tags perfaudit -run TestPerf_SupplierCreate -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
)

// The team_service ask is a fake here, so the measured cost is the INSERT alone.
func TestPerf_SupplierCreate(t *testing.T) {
	b := perfSetup(t)

	perfRun(t, b, "SupplierCreate", func(i int) error {
		_, err := b.svc.SupplierCreate(context.Background(), connect.NewRequest(&supplierv1.SupplierCreateRequest{
			TeamId:      b.team,
			Name:        fmt.Sprintf("PT Perf Baru %d", i),
			Contact:     "081234567890",
			Address:     "Jl. Perf No. 1, Bandung",
			Description: "created by the perf audit",
		}))

		return err
	})
}
