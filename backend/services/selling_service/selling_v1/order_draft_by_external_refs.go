package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// draftSourceManual is the source of a draft saved from the order form (the frontend's DRAFT_SOURCE): its
// external_id is a minted form id, never a marketplace ref.
const draftSourceManual = "manual"

// OrderDraftByExternalRefs is the duplicate-ref warning's draft half (the-duplicate-warning-reads-drafts-too, settled
// in the-duplicate-ref-warning-is-accepted): the TEAM's drafts in one shop whose marketplace ref is one of those asked.
//
// ⚠ TEAM-WIDE, NOT THE CALLER'S OWN. The drafts list and detail narrow to the author (a draft is personal working
// state), but a colleague's scrape of the same ref is exactly the double this warning exists to name — the owner chose
// a read shaped like OrderByExternalRefs, and the drafts list keeps its own-drafts rule.
//
// A draft's marketplace ref is its `external_id` — except a `manual` draft's, which is a minted form id (the form
// saved it; its ref is still to be typed), so manual drafts are never answered. The draft being finalized is the
// caller's to exclude: it is answered like any other.
func (s *Service) OrderDraftByExternalRefs(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderDraftByExternalRefsRequest],
) (*connect.Response[sellingv1.OrderDraftByExternalRefsResponse], error) {
	var drafts []selling_service_models.OrderDraft

	filter := req.Msg.GetFilter()

	// order_drafts_team_shop_external_idx — (team_id, shop_id, external_id), the lookup's own key (selling 00037): one
	// index seek per ref, whatever the team's backlog of drafts (perf probe in the _perf_test).
	err := s.db.
		WithContext(ctx).
		Select("id", "shop_id", "author_user_id", "external_id", "created_at").
		Where("team_id = ?", req.Msg.GetTeamId()).
		Where("source <> ?", draftSourceManual).
		Where("external_id IN ?", filter.GetRefs()).
		Where("shop_id = ?", filter.GetShopId()).
		Find(&drafts).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	byRef := make(map[string]map[uint64]*sellingv1.OrderDraftRefItem)

	for i := range drafts {
		draft := &drafts[i]

		found, ok := byRef[draft.ExternalID]
		if !ok {
			found = make(map[uint64]*sellingv1.OrderDraftRefItem)
			byRef[draft.ExternalID] = found
		}

		found[draft.ID] = &sellingv1.OrderDraftRefItem{
			DraftId:       draft.ID,
			ShopId:        draft.ShopID,
			AuthorUserId:  draft.AuthorUserID,
			CreatedAtUnix: draft.CreatedAt.Unix(),
		}
	}

	// DRAFT_REF is the only slice, and the default.
	items := make(map[string]*sellingv1.OrderDraftByExternalRefsResponseList, len(byRef))

	for ref, found := range byRef {
		items[ref] = &sellingv1.OrderDraftByExternalRefsResponseList{
			Items: []*sellingv1.OrderDraftByExternalRefsResponseItem{{
				D: &sellingv1.OrderDraftByExternalRefsResponseItem_DraftRef{
					DraftRef: &sellingv1.OrderDraftRefMapItem{MapData: found},
				},
			}},
		}
	}

	return connect.NewResponse(&sellingv1.OrderDraftByExternalRefsResponse{Items: items}), nil
}
