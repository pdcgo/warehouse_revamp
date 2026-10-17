package inventory_v1

import (
	"context"
	"math"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// CostLayerList backs the product detail's PRICES tab (#209): the warehouse's units of one product, grouped by the
// price each batch carries. Batches at the same price form one layer; the value of the shelf is the sum of the layers'
// own values, not units × a single price. Depleted layers (nothing left) drop out. Every batch carries its price, so
// there is no unknown layer.
func (s *Service) CostLayerList(
	ctx context.Context,
	req *connect.Request[inventoryv1.CostLayerListRequest],
) (*connect.Response[inventoryv1.CostLayerListResponse], error) {
	page := req.Msg.GetPage()

	layers, total, totalValue, err := costLayers(s.db.WithContext(ctx), page,
		"b.warehouse_id = ? AND b.product_id = ?", req.Msg.GetTeamId(), req.Msg.GetFilter().GetProductId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	items, ids := costLayerItems(layers, req.Msg.GetDataRequest())

	return connect.NewResponse(&inventoryv1.CostLayerListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   pageCount(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
		TotalValue: totalValue,
	}), nil
}

// costLayers groups the batches matching `where` that still hold units by their price, dearest first, one page. A
// layer's price is rounded to 4 places before grouping, so float dust never splits one price into two layers
// (stock-money-is-float64-compared-at-4-digits). Its amount is its batches' own value. Whole rupiah on this contract.
func costLayers(db *gorm.DB, page pager, where string, args ...any) ([]*inventoryv1.CostLayer, int64, int64, error) {
	grouped := `
		SELECT ROUND(b.price_unit::numeric, 4)::float8 AS price, SUM(b.stock_count) AS on_hand, SUM(b.stock_valuation) AS amount
		FROM batches b
		WHERE ` + where + ` AND b.stock_count > 0
		GROUP BY ROUND(b.price_unit::numeric, 4)`

	var total int64

	err := db.Raw("SELECT COUNT(*) FROM ("+grouped+") g", args...).Scan(&total).Error
	if err != nil {
		return nil, 0, 0, err
	}

	var totalValue float64

	err = db.Raw("SELECT COALESCE(SUM(amount), 0) FROM ("+grouped+") g", args...).Scan(&totalValue).Error
	if err != nil {
		return nil, 0, 0, err
	}

	var rows []struct {
		Price  float64
		OnHand int64
		Amount float64
	}

	err = db.
		Raw(grouped+" ORDER BY price DESC LIMIT ? OFFSET ?", append(append([]any{}, args...), int(page.GetLimit()), pageOffset(page))...).
		Scan(&rows).
		Error
	if err != nil {
		return nil, 0, 0, err
	}

	layers := make([]*inventoryv1.CostLayer, 0, len(rows))
	for _, r := range rows {
		layers = append(layers, &inventoryv1.CostLayer{
			UnitCost:  int64(math.Round(r.Price)),
			CostKnown: true,
			OnHand:    r.OnHand,
			Amount:    int64(math.Round(r.Amount)),
		})
	}

	return layers, total, int64(math.Round(totalValue)), nil
}
