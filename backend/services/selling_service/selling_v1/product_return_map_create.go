package selling_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm/clause"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ProductReturnMapCreate maps a borrowed product to one of the scoped team's own products — the call the order form's
// Return Mapping card makes at the confirmed pick, separate from OrderCreate (the-map-is-written-when-it-is-picked).
//
// WRITTEN ONCE, AND NEVER OVERWRITTEN (a-return-map-is-written-once). One INSERT … ON CONFLICT (team_id,
// shared_product_id) DO NOTHING on the unique source index (the-map-is-unique-on-its-source): when the team already maps
// this product the row is left exactly as it was, and the pair that STANDS is read back and returned with
// `created = false` — so two people mapping the same product at the same second end with one row, and both are shown
// it. Nothing here ever UPDATEs a row.
//
// Two queries at most: the insert, and the read of the standing row only when the insert did nothing. Under READ
// COMMITTED that read is a fresh snapshot, so a racing insert this one waited on is already visible to it.
func (s *Service) ProductReturnMapCreate(
	ctx context.Context,
	req *connect.Request[sellingv1.ProductReturnMapCreateRequest],
) (*connect.Response[sellingv1.ProductReturnMapCreateResponse], error) {
	teamID := req.Msg.GetTeamId()
	sharedID := req.Msg.GetSharedProductId()
	ownID := req.Msg.GetOwnProductId()

	// Checked BEFORE the write: a pair written against the wrong owner could not be taken back.
	err := s.checkReturnMapOwners(ctx, teamID, sharedID, ownID)
	if err != nil {
		return nil, err
	}

	now := time.Now()

	row := selling_service_models.ProductReturnMap{
		TeamID:          teamID,
		SharedProductID: sharedID,
		OwnProductID:    ownID,
		CreatedAt:       now,
		// Mirrors created_at — the row is never updated.
		UpdatedAt: now,
	}

	insert := s.db.
		WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "team_id"}, {Name: "shared_product_id"}},
			DoNothing: true,
		}).
		Create(&row)
	if insert.Error != nil {
		return nil, connect.NewError(connect.CodeInternal, insert.Error)
	}

	if insert.RowsAffected == 1 {
		return connect.NewResponse(&sellingv1.ProductReturnMapCreateResponse{
			Map:     productReturnMapToProto(&row),
			Created: true,
		}), nil
	}

	// THE PAIR ALREADY STANDS. It may name a different own product from the one asked for — that is the answer, and
	// the card shows it locked rather than the pick that lost.
	var standing selling_service_models.ProductReturnMap

	err = s.db.
		WithContext(ctx).
		Where("team_id = ? AND shared_product_id = ?", teamID, sharedID).
		Take(&standing).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&sellingv1.ProductReturnMapCreateResponse{
		Map:     productReturnMapToProto(&standing),
		Created: false,
	}), nil
}
