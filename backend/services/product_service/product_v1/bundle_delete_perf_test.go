//go:build perfaudit

package product_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
)

// A delete removes a bundle and, by the cascade, its lines — measured on six different bundles (one warm-up, five
// measured), since a deleted bundle cannot be deleted twice.
func TestPerf_BundleDelete(t *testing.T) {
	svc, _, probe, seed := perfService(t)
	ctx := perfCtx()

	next := 0
	measure(t, probe, "BundleDelete", func() error {
		id := seed.team[next]
		next++

		_, err := svc.BundleDelete(ctx, connect.NewRequest(&productv1.BundleDeleteRequest{TeamId: perfBundleTeam, BundleId: id}))
		return err
	})
}
