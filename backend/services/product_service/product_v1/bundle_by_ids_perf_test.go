//go:build perfaudit

package product_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
)

func TestPerf_BundleByIds(t *testing.T) {
	svc, db, probe, seed := perfService(t)
	ctx := perfCtx()

	for _, n := range []int{1, 200} {
		ids := seed.team[:n]
		measure(t, probe, fmt.Sprintf("BundleByIds ids=%d", n), func() error {
			_, err := svc.BundleByIds(ctx, connect.NewRequest(&productv1.BundleByIdsRequest{
				TeamId: perfBundleTeam,
				Filter: &productv1.BundleByIdsFilter{Ids: ids},
			}))
			return err
		})
	}

	explainReads(t, db, probe)
}
