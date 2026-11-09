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
// The owner team and the product's code and name come from product_service, asked before the transaction (a call to
// another service never runs under a lock).
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

		return tx.Create(&row).Error
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
