package selling_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

var errDraftMissing = errors.New("draft not found")

// draftAuthor is the caller, and every draft RPC starts here.
//
// An error rather than a 0 fallback: a draft is personal, so a handler that could not say who is
// asking cannot answer at all. Falling back to 0 would silently return the set of drafts belonging
// to nobody, which reads as "you have none" — a wrong answer that looks like a right one.
func draftAuthor(ctx context.Context) (uint64, error) {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return 0, connect.NewError(connect.CodeUnauthenticated, errDraftNoAuthor)
	}

	authorID := identity.GetIdentityId()
	if authorID == 0 {
		return 0, connect.NewError(connect.CodeUnauthenticated, errDraftNoAuthor)
	}

	return authorID, nil
}

// OrderDraftDetail returns one of the caller's own drafts WITH its lines (#192).
//
// The lines are the point: each carries both the marketplace's text and the product it has been
// mapped to, so the mapping screen (#196) can show one beside the other. Nothing else returns them.
//
// Somebody else's draft reads as NOT FOUND rather than as a permission error — the caller has a
// perfectly good role in this team, and the draft is simply not theirs. "Exists but is not yours"
// would leak that a given external ref has been scraped by a colleague.
func (s *Service) OrderDraftDetail(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderDraftDetailRequest],
) (*connect.Response[sellingv1.OrderDraftDetailResponse], error) {
	authorID, err := draftAuthor(ctx)
	if err != nil {
		return nil, err
	}

	var draft selling_service_models.OrderDraft

	err = s.db.
		WithContext(ctx).
		Where("id = ? AND team_id = ? AND author_user_id = ?",
			req.Msg.GetDraftId(), req.Msg.GetTeamId(), authorID).
		Take(&draft).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, connect.NewError(connect.CodeNotFound, errDraftMissing)
	}

	if err != nil {
		return nil, dbError(err)
	}

	// Ordered by id, so the lines read in the order the app pushed them — which is the order they
	// appeared on the marketplace page somebody is comparing against.
	err = s.db.
		WithContext(ctx).
		Where("draft_id = ?", draft.ID).
		Order("id").
		Find(&draft.Items).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	out := draftToProto(&draft)
	out.ItemCount = uint32(len(draft.Items))

	for i := range draft.Items {
		if draft.Items[i].ProductID == 0 {
			out.UnmappedItemCount++
		}
	}

	return connect.NewResponse(&sellingv1.OrderDraftDetailResponse{Draft: out}), nil
}
