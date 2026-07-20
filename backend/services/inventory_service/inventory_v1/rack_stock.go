package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RackStock answers the question a person standing at a shelf actually has (#138): what is on THIS
// rack, and how much of each. It is the mirror of StockList — that one sums a product ACROSS its
// racks to answer "how much of X does this warehouse hold"; this one reads a single rack.
//
// The rack is verified against the scoped warehouse first, so another warehouse's rack reads as
// NotFound rather than as an empty shelf. Those are very different answers: "not yours" and "nothing
// on it" must not look the same, or a probe could map another warehouse's rack ids by which of them
// come back empty.
//
// A line's product may belong to ANOTHER team's catalogue — a selling team's restock puts its product
// on this warehouse's shelf — so only the id is returned here. Resolving sku/name is the caller's job,
// via product_service's ProductByIds (see plans/inventory_service/brainstorming.md §4): this service
// owns stock, not the catalogue, and inventing a name for a product it does not own would be guessing.
func (s *Service) RackStock(
	ctx context.Context,
	req *connect.Request[inventoryv1.RackStockRequest],
) (*connect.Response[inventoryv1.RackStockResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	rackID := req.Msg.GetRackId()
	page := req.Msg.GetPage()

	exists, err := rackExists(s.db.WithContext(ctx), warehouseID, rackID)
	if err != nil {
		return nil, rackDBError(err)
	}

	if !exists {
		return nil, rackNotFound()
	}

	// Rows with nothing on them are not "on the rack" — a level can fall to 0 without being deleted
	// (a stock-take zeroing a shelf), and listing it would show a product that is not there.
	query := s.db.
		WithContext(ctx).
		Model(&inventory_service_models.StockLevel{}).
		Where("rack_id = ? AND on_hand > 0", rackID)

	var total int64

	err = query.Count(&total).Error
	if err != nil {
		return nil, rackDBError(err)
	}

	var levels []inventory_service_models.StockLevel

	err = query.
		Order("product_id ASC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&levels).
		Error
	if err != nil {
		return nil, rackDBError(err)
	}

	lines := make([]*inventoryv1.RackStockLine, 0, len(levels))
	for i := range levels {
		lines = append(lines, &inventoryv1.RackStockLine{
			ProductId: levels[i].ProductID,
			OnHand:    levels[i].OnHand,
		})
	}

	return connect.NewResponse(&inventoryv1.RackStockResponse{
		Lines:    lines,
		PageInfo: pageInfo(page, total),
	}), nil
}
