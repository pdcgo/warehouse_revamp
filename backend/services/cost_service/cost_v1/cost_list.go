package cost_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	costv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/cost/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/cost_service/cost_service_models"
)

// CostList returns a team's costs for a PERIOD, newest first, with per-kind totals (#168).
//
// The team_id clause IS the scope check — one team can never read another's costs by id, which
// matters more here than on most lists: this is the money.
func (s *Service) CostList(
	ctx context.Context,
	req *connect.Request[costv1.CostListRequest],
) (*connect.Response[costv1.CostListResponse], error) {
	page := req.Msg.GetPage()

	filtered, err := s.filtered(ctx, req.Msg)
	if err != nil {
		return nil, err
	}

	var total int64

	err = filtered.Count(&total).Error
	if err != nil {
		return nil, costErr(err)
	}

	var rows []cost_service_models.CostRecord

	err = filtered.
		// By the date the cost BELONGS TO, not when it was typed. Somebody entering last month's
		// payroll today expects it to sort with last month, and id breaks the tie so two costs on one
		// day have a stable order.
		Order("occurred_at DESC, id DESC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&rows).
		Error
	if err != nil {
		return nil, costErr(err)
	}

	out := make([]*costv1.CostRecord, 0, len(rows))
	for i := range rows {
		out = append(out, costToProto(&rows[i]))
	}

	totals, err := s.totals(ctx, req.Msg)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&costv1.CostListResponse{
		Costs:    out,
		PageInfo: pageInfo(page, total),
		Totals:   totals,
	}), nil
}

// filtered builds the WHERE every read here shares.
//
// One place, because the LIST and the TOTALS must agree about what the period contains. Two copies of
// a date range is how a total starts describing a different set of rows than the table under it.
func (s *Service) filtered(ctx context.Context, msg *costv1.CostListRequest) (*gorm.DB, error) {
	query := s.db.
		WithContext(ctx).
		Model(&cost_service_models.CostRecord{}).
		// LIVE rows only. A voided cost was entered by mistake and earned its retraction; it is still
		// visible on the row list (#169 shows it struck through) but it never counts.
		Where("team_id = ? AND voided_at IS NULL", msg.GetTeamId())

	// THE PERIOD, inclusive at both ends. Server-side, because the list is paginated: a client-side
	// date filter narrows the loaded page only and leaves the totals beside it unfiltered.
	if raw := msg.GetFrom(); raw != "" {
		from, err := parseDate(raw)
		if err != nil {
			return nil, costErr(err)
		}

		query = query.Where("occurred_at >= ?", from)
	}

	if raw := msg.GetTo(); raw != "" {
		to, err := parseDate(raw)
		if err != nil {
			return nil, costErr(err)
		}

		// `occurred_at` is a DATE, so an inclusive upper bound needs no end-of-day arithmetic — the
		// comparison is date to date.
		query = query.Where("occurred_at <= ?", to)
	}

	if kind := msg.GetKind(); kind != costv1.CostKind_COST_KIND_UNSPECIFIED {
		query = query.Where("kind = ?", int32(kind))
	}

	if shop := msg.GetShopId(); shop != 0 {
		query = query.Where("shop_id = ?", shop)
	}

	return query, nil
}

type kindTotalRow struct {
	Kind  int32
	Total int64
}

// totals sums the WHOLE filtered period, never the page.
//
// A page total is a different number wearing the same label: it changes when somebody picks a
// different page size, and it is wrong in a way the reader cannot see. Same split RevenueTotals uses
// (#78), and the same test to prove it — ask for a page smaller than the data.
func (s *Service) totals(ctx context.Context, msg *costv1.CostListRequest) (*costv1.CostTotals, error) {
	query, err := s.filtered(ctx, msg)
	if err != nil {
		return nil, err
	}

	var rows []kindTotalRow

	err = query.
		Select("kind, COALESCE(SUM(amount), 0) AS total").
		Group("kind").
		Scan(&rows).
		Error
	if err != nil {
		return nil, costErr(err)
	}

	out := costv1.CostTotals{ByKind: make(map[int32]int64, len(rows))}

	for _, r := range rows {
		out.ByKind[r.Kind] = r.Total
		out.Total += r.Total
	}

	// A kind with nothing in the period is ABSENT rather than 0. Absent and zero read identically on a
	// summary card, and building the empty ones would mean this handler knowing the enum's members —
	// which would then need editing every time a kind is added.
	return &out, nil
}
