package selling_v1

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// A draft still carrying an unmapped line. Its own error because it is the ONE requirement that is
// specific to drafts — everything else promote checks is a rule an order has always had.
var errDraftUnmapped = errors.New("every line must be mapped to a product before this draft can be promoted")

// OrderDraftPromote turns a finished draft into a real order (#194).
//
// The three things this RPC is:
//
//  1. THE SAME VALIDATION OrderCreate RUNS. Not a copy of it — literally the same code path
//     (placeOrder), which is the payoff the separate drafts table was chosen for. A rule written
//     twice is a rule that eventually differs, and the difference would show up as a draft path
//     accepting an order the form would have refused.
//  2. ONE TRANSACTION. `orders` and `order_drafts` are both selling_service in one database, so the
//     order is written and the draft deleted together. The "gap between two writes" a cross-service
//     split would have created never exists, and there is no compensation path to build for it.
//  3. THE ONLY DOOR INTO REVENUE. Placement publishes OrderPlacedEvent (#153); everything upstream of
//     promote is invisible to the month's margin, deliberately.
func (s *Service) OrderDraftPromote(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderDraftPromoteRequest],
) (*connect.Response[sellingv1.OrderDraftPromoteResponse], error) {
	authorID, err := draftAuthor(ctx)
	if err != nil {
		return nil, err
	}

	teamID := req.Msg.GetTeamId()

	var draft selling_service_models.OrderDraft

	err = s.db.
		WithContext(ctx).
		Where("id = ? AND team_id = ? AND author_user_id = ?", req.Msg.GetDraftId(), teamID, authorID).
		Take(&draft).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, connect.NewError(connect.CodeNotFound, errDraftMissing)
	}

	if err != nil {
		return nil, dbError(err)
	}

	err = s.db.
		WithContext(ctx).
		Where("draft_id = ?", draft.ID).
		Order("id").
		Find(&draft.Items).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	// The draft-specific requirement, checked first and named for what it is. placeOrder would refuse
	// an unmapped line too (product_id 0 is not a valid line), but "every line must name a product"
	// tells somebody looking at an order form nothing about the screen they are actually on.
	if unmappedLines(draft.Items) > 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errDraftUnmapped)
	}

	items, err := s.draftOrderItems(ctx, teamID, draft.Items)
	if err != nil {
		return nil, err
	}

	var order *selling_service_models.Order

	order, err = s.placeOrder(ctx, &orderPlacement{
		teamID:        teamID,
		shopID:        draft.ShopID,
		warehouseID:   draft.WarehouseID,
		customerName:  draft.CustomerName,
		customerPhone: draft.CustomerPhone,
		address: &sellingv1.OrderAddress{
			ProvinsiCode:  draft.ProvinsiCode,
			ProvinsiName:  draft.ProvinsiName,
			KabupatenCode: draft.KabupatenCode,
			KabupatenName: draft.KabupatenName,
			KecamatanCode: draft.KecamatanCode,
			KecamatanName: draft.KecamatanName,
			DesaCode:      draft.DesaCode,
			DesaName:      draft.DesaName,
			KodePos:       draft.KodePos,
			AddressLine:   draft.AddressLine,
		},
		shippingCode: draft.ShippingCode,
		shippingCost: draft.ShippingCost,
		// The money is RECOMPUTED from the mapped lines rather than carried over. A draft's totals are
		// whatever the marketplace page said, and the lines a person actually mapped may not add up to
		// it — one line removed, a quantity corrected. An order's `subtotal` and `total` must agree
		// with its own lines, because everything downstream computes margin from them.
		subtotal: orderSubtotal(items),
		total:    orderSubtotal(items) + draft.ShippingCost,
		items:    items,
		// The draft's deletion, inside the order's transaction. If the order rolls back — no stock,
		// a bad shop — the draft is still there, and the person can fix what was wrong and try again.
		inTx: func(tx *gorm.DB, _ *selling_service_models.Order) error {
			return tx.
				Where("id = ?", draft.ID).
				Delete(&selling_service_models.OrderDraft{}).
				Error
		},
	})
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&sellingv1.OrderDraftPromoteResponse{
		Order: orderToProto(order),
	}), nil
}

func unmappedLines(items []selling_service_models.OrderDraftItem) int {
	count := 0

	for i := range items {
		if items[i].ProductID == 0 {
			count++
		}
	}

	return count
}

func orderSubtotal(items []*sellingv1.OrderItem) int64 {
	var subtotal int64

	for _, item := range items {
		subtotal += int64(item.GetQuantity()) * item.GetUnitPrice()
	}

	return subtotal
}

// draftOrderItems turns mapped draft lines into order lines, resolving each product's sku and name
// from the catalogue.
//
// This is also where the STALE REFERENCE check lands. A draft names products by id with no FK, so
// one can be deleted between the mapping and the promote — and the answer says WHICH product died,
// because the person has to go back to that line and pick something else. A bare "validation failed"
// would leave them hunting through a screen of lines that all look fine.
func (s *Service) draftOrderItems(
	ctx context.Context,
	teamID uint64,
	lines []selling_service_models.OrderDraftItem,
) ([]*sellingv1.OrderItem, error) {
	ids := make([]uint64, 0, len(lines))
	seen := map[uint64]bool{}

	for i := range lines {
		id := lines[i].ProductID
		if seen[id] {
			continue
		}

		seen[id] = true

		ids = append(ids, id)
	}

	snapshots, err := s.catalog.Snapshots(ctx, teamID, ids)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Every dead reference at once, not the first one. Somebody who has to re-map three lines should
	// learn that in one attempt rather than by promoting three times.
	var dead []string

	for _, id := range ids {
		_, alive := snapshots[id]
		if !alive {
			dead = append(dead, strconv.FormatUint(id, 10))
		}
	}

	if len(dead) > 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			errors.New("these products no longer exist and must be re-mapped: "+strings.Join(dead, ", ")))
	}

	items := make([]*sellingv1.OrderItem, 0, len(lines))

	for i := range lines {
		snapshot := snapshots[lines[i].ProductID]

		items = append(items, &sellingv1.OrderItem{
			ProductId: lines[i].ProductID,
			// The catalogue's label, frozen onto the order exactly as OrderCreate freezes the one the
			// person had on screen. NOT the scraped external text: that is the marketplace's name for
			// the thing, and an order's line must say what WE shipped.
			Sku:       snapshot.SKU,
			Name:      snapshot.Name,
			Quantity:  lines[i].Quantity,
			UnitPrice: lines[i].UnitPrice,
		})
	}

	return items, nil
}
