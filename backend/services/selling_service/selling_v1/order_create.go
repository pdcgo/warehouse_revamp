package selling_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// The draft was turned into an order between the page loading it and this one committing — two people pressed Promote
// at once. The second order rolls back, so a draft becomes exactly one order.
var errDraftAlreadyPlaced = errors.New("this draft has already been turned into an order")

// OrderCreate records a new order (status PLACED) and its lines in one transaction. The shop must
// belong to the scoped team.
//
// THE ONE DOOR INTO `orders` (a-draft-becomes-an-order-through-order-create). The create form calls it, and so does the
// draft page's Promote, with `order_draft_id`: the order is whatever the request says, and the draft is deleted in the
// order's own transaction. The work itself is placeOrder (order_place.go).
func (s *Service) OrderCreate(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderCreateRequest],
) (*connect.Response[sellingv1.OrderCreateResponse], error) {
	teamID := req.Msg.GetTeamId()

	finishesDraft, err := s.draftToFinish(ctx, teamID, req.Msg.GetOrderDraftId())
	if err != nil {
		return nil, err
	}

	order, err := s.placeOrder(ctx, &orderPlacement{
		teamID:        teamID,
		shopID:        req.Msg.GetShopId(),
		warehouseID:   req.Msg.GetWarehouseId(),
		customerName:  req.Msg.GetCustomerName(),
		customerPhone: req.Msg.GetCustomerPhone(),
		// Optional — placeOrder trims it and never refuses an empty one (the-buyers-username-is-optional).
		buyerUsername: req.Msg.GetBuyerUsername(),
		address:       req.Msg.GetAddress(),
		shippingCode:  req.Msg.GetShippingCode(),
		note:          req.Msg.GetNote(),
		receipt:       req.Msg.GetReceipt(),
		receiptCode:   req.Msg.GetReceiptCode(),
		// The platform's two dates (platform-created-at-is-required-at-finalize — placeOrder refuses a missing one).
		platformCreatedAt:        req.Msg.GetPlatformCreatedAtUnix(),
		platformShipmentDeadline: req.Msg.GetPlatformShipmentDeadlineUnix(),
		// What the buyer paid (platform-total-is-required-at-finalize — placeOrder refuses a 0). The order's own money
		// is not in the request: placeOrder freezes it from the take.
		platformTotal: req.Msg.GetPlatformTotal(),
		// The storefront's own id for this order — required by the request's validation
		// (an-order-ref-is-required-by-the-rpc). From the draft page it is the draft's external id, seeded on screen.
		orderExternalRefID: req.Msg.GetOrderExternalRefId(),
		items:              req.Msg.GetItems(),
		inTx:               finishesDraft,
	})
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&sellingv1.OrderCreateResponse{Order: orderToProto(order)}), nil
}

// draftToFinish checks the draft an order finishes and returns its deletion, to run inside the order's transaction —
// nil when the order finishes none.
//
// The draft must be the scoped team's AND the caller's, the lookup every draft RPC makes: a draft is its author's
// inbox, and a colleague's is NotFound, never Forbidden, so its existence is not disclosed.
func (s *Service) draftToFinish(
	ctx context.Context,
	teamID, draftID uint64,
) (func(tx *gorm.DB, _ *selling_service_models.Order) error, error) {
	if draftID == 0 {
		return nil, nil
	}

	authorID, err := draftAuthor(ctx)
	if err != nil {
		return nil, err
	}

	var found int64

	err = s.db.
		WithContext(ctx).
		Model(&selling_service_models.OrderDraft{}).
		Where("id = ? AND team_id = ? AND author_user_id = ?", draftID, teamID, authorID).
		Count(&found).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	if found == 0 {
		return nil, connect.NewError(connect.CodeNotFound, errDraftMissing)
	}

	// INSIDE the order's transaction: a refused order (no stock, no fee rate) rolls this back too, and the draft is
	// still there to fix and try again. ⚠ A delete that finds nothing means another Promote committed first — its
	// row lock made this one wait, then the row was gone — so this order rolls back rather than become the second.
	return func(tx *gorm.DB, _ *selling_service_models.Order) error {
		res := tx.
			Where("id = ?", draftID).
			Delete(&selling_service_models.OrderDraft{})
		if res.Error != nil {
			return dbError(res.Error)
		}

		if res.RowsAffected == 0 {
			return connect.NewError(connect.CodeAborted, errDraftAlreadyPlaced)
		}

		return nil
	}, nil
}
