package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderDraftList returns the CALLER'S OWN drafts in the scoped team, newest first, paginated (#192).
//
// ⚠ Two narrowings, and they are not the same thing. `team_id` is the authorization SCOPE, checked by
// the interceptor; `author_user_id` is a filter this handler applies on top, because a draft is
// personal working state (§6.3). Dropping the scope to "make it personal" would leave a team-level
// role policy evaluated against the root team — a dead letter authorizing nobody.
//
// Paginated, and not as a formality: drafts never expire (§6.7), and an app pushing continuously
// fills this list far faster than a person ever would.
func (s *Service) OrderDraftList(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderDraftListRequest],
) (*connect.Response[sellingv1.OrderDraftListResponse], error) {
	authorID, err := draftAuthor(ctx)
	if err != nil {
		return nil, err
	}

	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&selling_service_models.OrderDraft{}).
		Where("team_id = ? AND author_user_id = ?", req.Msg.GetTeamId(), authorID)

	// One app's drafts, or all of them. Server-side because the list is paginated — filtering the
	// loaded page in the client would narrow one page and report the unfiltered total beside it.
	if source := req.Msg.GetSource(); source != "" {
		query = query.Where("source = ?", source)
	}

	var total int64

	err = query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var drafts []selling_service_models.OrderDraft

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = query.
		Order("id DESC").
		Offset(offset).
		Limit(int(page.GetLimit())).
		Find(&drafts).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	counts, err := s.draftItemCounts(ctx, drafts)
	if err != nil {
		return nil, dbError(err)
	}

	out := make([]*sellingv1.OrderDraft, 0, len(drafts))

	for i := range drafts {
		draft := draftToProto(&drafts[i])
		draft.ItemCount = counts[drafts[i].ID].total
		draft.UnmappedItemCount = counts[drafts[i].ID].unmapped

		out = append(out, draft)
	}

	return connect.NewResponse(&sellingv1.OrderDraftListResponse{
		Drafts: out,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}

type draftCounts struct {
	total    uint32
	unmapped uint32
}

// draftItemCounts answers "how much work is left on each of these" in ONE query.
//
// The list returns no lines, so this is the only thing on the list screen that says how far along a
// draft is — and it is aggregated in the database rather than by loading every draft's lines, which
// would be the slow query pagination exists to prevent. One query for the whole page, not one per
// draft: the N+1 here would be a query per row of every page anybody ever opens.
func (s *Service) draftItemCounts(
	ctx context.Context,
	drafts []selling_service_models.OrderDraft,
) (map[uint64]draftCounts, error) {
	counts := map[uint64]draftCounts{}

	if len(drafts) == 0 {
		return counts, nil
	}

	ids := make([]uint64, 0, len(drafts))
	for i := range drafts {
		ids = append(ids, drafts[i].ID)
	}

	var rows []struct {
		DraftID  uint64
		Total    uint32
		Unmapped uint32
	}

	err := s.db.
		WithContext(ctx).
		Model(&selling_service_models.OrderDraftItem{}).
		Select("draft_id, COUNT(*) AS total, "+
			"COUNT(*) FILTER (WHERE product_id = 0) AS unmapped").
		Where("draft_id IN ?", ids).
		Group("draft_id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		counts[row.DraftID] = draftCounts{total: row.Total, unmapped: row.Unmapped}
	}

	return counts, nil
}
