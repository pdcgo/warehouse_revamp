package inventory_v1

import (
	"context"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// FoundRequestCreate reports units found on a rack, outside a stock count: ONE waiting request and nothing posted — no
// stock, no batch, no money — until the warehouse Owner or Admin approves it (an-adjust-found-waits-for-the-owner-or-admin).
// It is the ONE door for a found: the Adjust dialog's Found and the rack page's Report Found call it, staff too
// (staff-may-report-a-found); StockAdjust refuses FOUND.
//
// Refused, all inside one database transaction:
//   - a rack not of this warehouse (or deleted) — NotFound;
//   - a product a stock count holds on that rack — FailedPrecondition naming the count
//     (a-lock-stops-sales-and-cancels-too). Read plainly: the report posts nothing, so it takes no shelf lock; a report
//     that slips past a count planned at the same second waits, and that count's finalize settles it
//     (a-count-settles-the-found-it-counted);
//   - a product its owner team never had a batch of in this warehouse — FailedPrecondition: there is no price to mint it
//     at, so it comes in by the team's restock (a-found-never-stocked-here-is-refused-at-the-report), read by the very
//     test last-price-is-the-teams-newest-batch-here uses. A product once stocked here and at 0 now is accepted.
//
// NAMING A LOST ORDER (a-found-lost-parcel-is-a-found-stock-in) — `order_id`, optional. The parcel of an order gone
// `lost` came back to the warehouse it shipped from. Refused: an order this warehouse did not ship — NotFound, as one
// that does not exist; one not `lost`, a product of another team than the order's — FailedPrecondition; and, inside the
// transaction, a take not standing here, a parcel already back as its return, a product the take never drew and more
// units than it drew less what the order's founds already report (waiting or approved) — FailedPrecondition. The order
// STAYS LOST: in the same transaction its timeline gets ONE note from the warehouse naming the request — nothing moves.
//
// The owner team and the product's code and name come from product_service, and the order from selling_service, asked
// before the transaction (a call to another service never runs under a lock).
func (s *Service) FoundRequestCreate(
	ctx context.Context,
	req *connect.Request[inventoryv1.FoundRequestCreateRequest],
) (*connect.Response[inventoryv1.FoundRequestCreateResponse], error) {
	msg := req.Msg
	warehouseID := msg.GetTeamId()
	productID := msg.GetProductId()
	rackID := msg.GetRackId()
	actor := actorFrom(ctx)

	if actor == 0 {
		return nil, foundErr(errFoundNoPerson)
	}

	if msg.GetQuantity() <= 0 || productID == 0 || rackID == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errFoundArgs)
	}

	facts, err := s.products.Facts(ctx, warehouseID, []uint64{productID})
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("ask the product's owner: %w", err))
	}

	fact, ok := facts[productID]
	if !ok || fact.TeamID == 0 {
		return nil, foundErr(errFoundProductMissing)
	}

	order, err := s.foundOrderOf(ctx, warehouseID, msg.GetOrderId(), productID, fact)
	if err != nil {
		return nil, foundErr(err)
	}

	row := models.FoundRequest{
		WarehouseID:  warehouseID,
		TeamID:       fact.TeamID,
		ProductID:    productID,
		ProductCode:  fact.ProductCode,
		ProductName:  fact.Name,
		PlacementID:  rackID,
		StockCount:   msg.GetQuantity(),
		Note:         strings.TrimSpace(msg.GetNote()),
		ReportedByID: actor,
		ReportedAt:   time.Now(),
		Status:       models.FoundWaiting,
	}

	db := s.db.WithContext(ctx)

	err = db.Transaction(func(tx *gorm.DB) error {
		exists, checkErr := rackExists(tx, warehouseID, rackID)
		if checkErr != nil {
			return checkErr
		}

		if !exists {
			return errRackMissing
		}

		countedErr := inventory_ledgers.RefuseCounted(tx, []inventory_ledgers.RackKey{{ProductID: productID, PlacementID: rackID}})
		if countedErr != nil {
			return countedErr
		}

		stocked, stockedErr := inventory_mutations.StockedHere(tx, warehouseID, fact.TeamID, productID)
		if stockedErr != nil {
			return stockedErr
		}

		if !stocked {
			return &neverStockedHereError{product: foundProductLabel(fact, productID), teamID: fact.TeamID}
		}

		if order == nil {
			return tx.Create(&row).Error
		}

		units := inventory_mutations.OrderFoundUnits{
			FoundUnits: inventory_mutations.FoundUnits{
				WarehouseID: warehouseID, TeamID: fact.TeamID, ProductID: productID, PlacementID: rackID,
				Count: row.StockCount,
			},
			OrderID:           order.ID,
			TakeTransactionID: order.TakeTransactionID,
		}

		orderErr := inventory_mutations.CheckOrderFound(tx, units)
		if orderErr != nil {
			return orderErr
		}

		row.OrderID = &units.OrderID
		row.OrderTakeTransactionID = &units.TakeTransactionID

		createErr := tx.Create(&row).Error
		if createErr != nil {
			return createErr
		}

		codes, codeErr := placementCodesOf(tx, []uint64{rackID})
		if codeErr != nil {
			return codeErr
		}

		// THE ORDER'S TIMELINE NAMES THE REQUEST — one note, in this transaction; the order stays lost.
		return s.orders.NoteFound(ctx, tx, FoundNote{
			OrderID:        order.ID,
			FoundRequestID: row.ID,
			Count:          row.StockCount,
			ProductCode:    row.ProductCode,
			ProductName:    row.ProductName,
			RackCode:       codes[rackID],
			ActorID:        actor,
			IsOverride:     overrideFrom(ctx),
		})
	})
	if err != nil {
		return nil, foundErr(err)
	}

	mapped, err := foundRequestsProto(db, actor, []models.FoundRequest{row})
	if err != nil {
		return nil, foundErr(err)
	}

	return connect.NewResponse(&inventoryv1.FoundRequestCreateResponse{FoundRequest: mapped[row.ID]}), nil
}

// foundOrderOf is the lost order a report names, asked of selling_service before the transaction — nil when it names
// none (order id 0). An order this warehouse did not ship reads as one that does not exist; one not `lost`, one of
// another team than the product's owner, or one that took no stock is refused (a-found-lost-parcel-is-a-found-stock-in).
func (s *Service) foundOrderOf(
	ctx context.Context,
	warehouseID, orderID, productID uint64,
	fact ProductFact,
) (*FoundOrder, error) {
	if orderID == 0 {
		return nil, nil
	}

	order, ok, err := s.orders.FoundOrder(ctx, orderID)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("ask the order side about order #%d: %w", orderID, err))
	}

	if !ok || order.WarehouseID != warehouseID {
		return nil, &foundOrderMissingError{orderID: orderID}
	}

	if !order.Lost {
		return nil, &foundOrderNotLostError{orderID: orderID, status: order.Status}
	}

	if order.TeamID != fact.TeamID {
		return nil, &foundOrderTeamError{
			orderID: orderID, orderTeamID: order.TeamID, product: foundProductLabel(fact, productID), productTeamID: fact.TeamID,
		}
	}

	if order.TakeTransactionID == 0 {
		return nil, fmt.Errorf("%w: order #%d", errFoundOrderNoTake, orderID)
	}

	return &order, nil
}

// foundProductLabel names a product in a refusal a person reads: its name and code, or its id when product_service
// gave neither.
func foundProductLabel(fact ProductFact, productID uint64) string {
	switch {
	case fact.Name != "" && fact.ProductCode != "":
		return fmt.Sprintf("%s (%s)", fact.Name, fact.ProductCode)
	case fact.Name != "":
		return fact.Name
	case fact.ProductCode != "":
		return fact.ProductCode
	default:
		return fmt.Sprintf("product #%d", productID)
	}
}
