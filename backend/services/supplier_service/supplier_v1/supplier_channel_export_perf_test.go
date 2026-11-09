//go:build perfaudit

// go test -tags perfaudit -run TestPerf_SupplierChannelExport -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"testing"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// The Toko tab's export of the supplier with 300 stores (two steps of the file), and of a typical 3-store one — the
// list's count, then its pages of 200, over the same index the list reads. The figures are one in-process read
// (inventory's SupplierGoods.md audits it); here a fake answers it.
func TestPerf_SupplierChannelExport(t *testing.T) {
	b := perfSetup(t)
	store := &fakeExports{}
	svc := supplier_v1.NewService(b.db, perfSellingTeams{}, nil, &fakeGoods{}, store)

	for _, c := range []struct {
		name     string
		supplier uint64
		q        string
	}{
		{"big", b.big, ""},
		{"big/q", b.big, perfQ},
		{"typical-3-stores", b.own[0], ""},
	} {
		perfRun(t, b, "SupplierChannelExport/"+c.name, func(int) error {
			_, err := runChannelExport(t, svc, store, &supplierv1.SupplierChannelExportRequest{
				TeamId: b.team + 1,
				Filter: &supplierv1.SupplierChannelListFilter{SupplierId: c.supplier, Q: c.q},
			})

			return err
		})
	}
}
