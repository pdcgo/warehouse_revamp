package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderDraftDelete prunes drafts — SEVERAL AT ONCE (#193).
//
// Bulk is not a nicety here. Nothing expires (§6.7), so this is the only thing standing between the
// list and a graveyard, and an app pushing continuously fills that list far faster than a person
// deletes one at a time. A one-at-a-time delete would lose that race by design.
//
// A HARD delete, not a soft one. A draft is working state that was never an order — there is no
// history in it worth keeping, and a soft-deleted draft would be a row every future reader of this
// table has to remember to exclude, which is exactly the trap the separate table avoided in the
// first place. The lines go with it through ON DELETE CASCADE.
func (s *Service) OrderDraftDelete(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderDraftDeleteRequest],
) (*connect.Response[sellingv1.OrderDraftDeleteResponse], error) {
	authorID, err := draftAuthor(ctx)
	if err != nil {
		return nil, err
	}

	// The scope and the author are in the WHERE, not checked beforehand: a delete that first read the
	// rows and then deleted by id would have a window in which the ids stopped being the caller's.
	// Ids that are not theirs simply match nothing.
	result := s.db.
		WithContext(ctx).
		Where("id IN ? AND team_id = ? AND author_user_id = ?",
			req.Msg.GetDraftIds(), req.Msg.GetTeamId(), authorID).
		Delete(&selling_service_models.OrderDraft{})

	if result.Error != nil {
		return nil, dbError(result.Error)
	}

	// Fewer than asked for is a normal answer, not an error. An id already gone, or never the
	// caller's, is skipped — deleting is idempotent by nature, and failing the whole batch over one
	// stale id would make a bulk prune unusable exactly when the list is long enough to need one.
	return connect.NewResponse(&sellingv1.OrderDraftDeleteResponse{
		Deleted: uint32(result.RowsAffected),
	}), nil
}
