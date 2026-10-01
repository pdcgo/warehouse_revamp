package region_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"

	regionv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/region/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/region_service/region_service_models"
)

// searchLimitDefault is used when the caller sends 0. The proto caps it at 20 — a typeahead can
// never return "everything", which is what HARD RULE 9 protects against.
const searchLimitDefault = 10

// RegionSearch is the picker's "type your village" fast path: a capped typeahead over the name that
// returns each hit WITH its full ancestry, so choosing a result back-fills all four levels and the
// kode pos without a second round-trip.
//
// PREFIX matching (`LOWER(name) LIKE 'kebon%'`), which is what the LOWER(name) text_pattern_ops
// index serves. An infix "contains" search would need pg_trgm — worth adding only if the prefix
// proves too strict in the picker.
//
// Two queries, never N+1: one to find the hits, one to fetch every hit's ancestors at once.
func (s *Service) RegionSearch(
	ctx context.Context,
	req *connect.Request[regionv1.RegionSearchRequest],
) (*connect.Response[regionv1.RegionSearchResponse], error) {
	limit := int(req.Msg.GetLimit())
	if limit == 0 {
		limit = searchLimitDefault
	}

	query := s.db.
		WithContext(ctx).
		Model(&region_service_models.Region{}).
		Where("LOWER(name) LIKE ?", escapeLike(strings.ToLower(strings.TrimSpace(req.Msg.GetQ())))+"%")

	if level := req.Msg.GetLevel(); level != regionv1.RegionLevel_REGION_LEVEL_UNSPECIFIED {
		query = query.Where("level = ?", int(level))
	}

	var hits []region_service_models.Region

	err := query.
		Order("name ASC, code ASC").
		Limit(limit).
		Find(&hits).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Every hit's ancestors, in ONE query — at most 20 hits x 4 levels of primary keys.
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

	return connect.NewResponse(&regionv1.RegionSearchResponse{Results: results}), nil
}

// escapeLike neutralises LIKE wildcards so a search for "%" doesn't match everything.
func escapeLike(q string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
}
