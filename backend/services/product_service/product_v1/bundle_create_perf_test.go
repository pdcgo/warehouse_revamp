//go:build perfaudit

package product_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
)

// A create at the contract's ceiling — 50 lines — beside a typical 3: the line check must stay ONE query however many
// lines there are.
func TestPerf_BundleCreate(t *testing.T) {
	svc, db, probe, seed := perfService(t)
	ctx := perfCtx()
	own := seed.products[perfBundleTeam]

	for _, n := range []int{3, 50} {
		ls := make([]*productv1.BundleLine, 0, n)
		for i := range n {
			ls = append(ls, &productv1.BundleLine{ProductId: own[i], Quantity: 1})
		}

		measure(t, probe, fmt.Sprintf("BundleCreate lines=%d", n), func() error {
			_, err := svc.BundleCreate(ctx, connect.NewRequest(&productv1.BundleCreateRequest{
				TeamId: perfBundleTeam, Name: "Perf", Lines: ls,
			}))
			return err
		})
	}

	explainReads(t, db, probe)
}
