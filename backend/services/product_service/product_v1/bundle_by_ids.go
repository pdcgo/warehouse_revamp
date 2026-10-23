package product_v1

import (
	"context"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// BundleByIds resolves bundle ids into the scoped team's bundles, lines included — the bundle's page. Unlike
// ProductByIds it never crosses teams: nothing outside a team ever holds one of its bundle ids. An id that is not the
// team's, or no longer exists, is simply ABSENT.
func (s *Service) BundleByIds(
	ctx context.Context,
	req *connect.Request[productv1.BundleByIdsRequest],
) (*connect.Response[productv1.BundleByIdsResponse], error) {
	db := s.db.WithContext(ctx)

	var bundles []product_service_models.Bundle

	err := db.
		Where("team_id = ? AND id IN ?", req.Msg.GetTeamId(), req.Msg.GetFilter().GetIds()).
		Find(&bundles).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	err = withLines(db, bundles)
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&productv1.BundleByIdsResponse{
		Items: bundleByIdsMap(bundles, req.Msg.GetDataRequest()),
	}), nil
}
