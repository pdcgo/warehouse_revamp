package region_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"

	regionv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/region/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/region_service/region_service_models"
)

// levelDesa is the only level that carries a kode pos (the table's own CHECK says so).
const levelDesa = 4

// RegionSearchByKodePos is the address picker's fast path: five digits in, the addresses that
// postcode covers out — each with its full ancestry, so one pick fills provinsi through desa.
//
// PREFIX matching (`kode_pos LIKE '237%'`), so the list narrows as it is typed, served by the
// varchar_pattern_ops index added beside it. Same two-query shape as RegionSearch — one for the
// hits, one for every hit's ancestors — never N+1.
//
// The `level = 4` predicate is not redundant with "kode_pos IS NOT NULL": it says what this query
// means. A kode pos identifies a desa, and a hit at any other level would be a seed that broke the
// table's own constraint.
func (s *Service) RegionSearchByKodePos(
	ctx context.Context,
	req *connect.Request[regionv1.RegionSearchByKodePosRequest],
) (*connect.Response[regionv1.RegionSearchByKodePosResponse], error) {
	limit := int(req.Msg.GetLimit())
	if limit == 0 {
		limit = searchLimitDefault
	}

	prefix := escapeLike(strings.TrimSpace(req.Msg.GetKodePos()))

	var hits []region_service_models.Region

	err := s.db.
		WithContext(ctx).
		Model(&region_service_models.Region{}).
		Where("level = ?", levelDesa).
		Where("kode_pos LIKE ?", prefix+"%").
		// By code, not by name. The codes ARE the ordering the person is thinking in — they typed a
		// prefix, so the nearer matches sort first — and it groups the desa of one postcode together
		// instead of scattering them alphabetically across the twenty rows.
		Order("kode_pos ASC, name ASC, code ASC").
		Limit(limit).
		Find(&hits).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	codes := make([]string, 0, len(hits)*4)
	for _, hit := range hits {
		codes = append(codes, ancestorCodes(hit.Code)...)
	}

	byCode, err := s.loadByCodes(s.db.WithContext(ctx), codes)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	results := make([]*regionv1.RegionAncestry, 0, len(hits))
	for _, hit := range hits {
		results = append(results, buildAncestry(byCode, hit.Code))
	}

	return connect.NewResponse(&regionv1.RegionSearchByKodePosResponse{Results: results}), nil
}
