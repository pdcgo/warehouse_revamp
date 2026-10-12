//go:build perfaudit

// go test -tags perfaudit -run TestPerf_SupplierByIds -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
)

// Ids across teams, deleted ones included (a restock naming its vendor), at 20 and at the 200 max_items.
func TestPerf_SupplierByIds(t *testing.T) {
	b := perfSetup(t)

	pool := append(append(append([]uint64{}, b.ownDeleted...), b.own...), b.others...)

	for _, size := range []int{20, 200} {
		ids := make([]uint64, 0, size)
		for i := 0; len(ids) < size; i++ {
			ids = append(ids, pool[(i*37)%len(pool)])
		}

		perfRun(t, b, fmt.Sprintf("SupplierByIds/ids=%d", size), func(int) error {
			_, err := b.svc.SupplierByIds(context.Background(), connect.NewRequest(&supplierv1.SupplierByIdsRequest{
				TeamId: b.team,
				Filter: &supplierv1.SupplierByIdsFilter{Ids: ids},
				DataRequest: []supplierv1.SupplierByIdsDataType{
					supplierv1.SupplierByIdsDataType_SUPPLIER_BY_IDS_DATA_TYPE_GENERAL,
					supplierv1.SupplierByIdsDataType_SUPPLIER_BY_IDS_DATA_TYPE_SUPPLIER,
				},
			}))

			return err
		})
	}
}
