//go:build perfaudit

package product_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
)

// An update that ADDS lines (so the product check runs) at 3 and at the 50-line ceiling. Every call rewrites the same
// bundle, so each run replaces what the run before it wrote — the steady state of somebody saving a form.
func TestPerf_BundleUpdate(t *testing.T) {
	svc, db, probe, seed := perfService(t)
	ctx := perfCtx()
	own := seed.products[perfBundleTeam]
	target := seed.team[0]

	for _, n := range []int{3, 50} {
		run := 0
		measure(t, probe, fmt.Sprintf("BundleUpdate lines=%d", n), func() error {
			// Shift the window each run, so the save always ADDS products and the check is not skipped.
			run++
			ls := make([]*productv1.BundleLine, 0, n)
			for i := range n {
				ls = append(ls, &productv1.BundleLine{ProductId: own[(run*n+i)%len(own)], Quantity: 2})
			}

			_, err := svc.BundleUpdate(ctx, connect.NewRequest(&productv1.BundleUpdateRequest{
				TeamId: perfBundleTeam, BundleId: target, Name: "Perf", Lines: ls,
			}))
			return err
		})
	}

	explainReads(t, db, probe)
}
