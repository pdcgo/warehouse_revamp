package region_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	regionv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/region/v1"
)

// RegionResolve returns the full ancestry of one code — provinsi → … → the region itself, flattened
// into the shape a saved address snapshots.
//
// One query over at most four primary keys: the kode wilayah encodes its own ancestry, so the
// ancestors are computed from the string, not walked in the database.
func (s *Service) RegionResolve(
	ctx context.Context,
	req *connect.Request[regionv1.RegionResolveRequest],
) (*connect.Response[regionv1.RegionResolveResponse], error) {
	code := req.Msg.GetCode()

	byCode, err := s.loadByCodes(s.db.WithContext(ctx), ancestorCodes(code))
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// The code itself must exist. A missing ANCESTOR would be a broken seed (the loader forbids it);
	// a missing code is just a bad request.
	if _, ok := byCode[code]; !ok {
		return nil, connect.NewError(connect.CodeNotFound, gorm.ErrRecordNotFound)
	}

	return connect.NewResponse(&regionv1.RegionResolveResponse{
		Ancestry: buildAncestry(byCode, code),
	}), nil
}
