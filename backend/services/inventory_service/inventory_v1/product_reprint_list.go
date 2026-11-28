package inventory_v1

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// ProductReprintList is CETAK ULANG KODE's read (backlog #151, #141 P3; products-have-their-own-tag-list, its 🔄 *what
// clears*; the-team-code-and-product-tags-prototype-is-accepted, row *the reprint*): every product still waiting for THIS
// warehouse's new labels — its code changed while units of it sat on these shelves, or units of it arrived here by a
// transfer while it was tagged — each with ONE LABEL PER SHELF SPOT of this warehouse holding it now.
//
// Two halves, each over its own rows (HARD RULE 3):
//   - which products wait, by live code, and how many — product_service's `product_reprint_waits` with each product's
//     LIVE code, name and former code (the newest `code_changed` line), asked in-process (ProductReader.ReprintWaits) —
//     one statement there;
//   - their labels — inventory's `product_placements` of this warehouse with stock, one per spot, with the spot's code and
//     its quantity, for the page's products only — one statement here.
//
// A product waiting here with nothing on a shelf here now is listed with no label: printing it still clears its wait. A
// warehouse reads its own waits and shelves only (the scope), never a price.
func (s *Service) ProductReprintList(
	ctx context.Context,
	req *connect.Request[inventoryv1.ProductReprintListRequest],
) (*connect.Response[inventoryv1.ProductReprintListResponse], error) {
	warehouseID := req.Msg.GetWarehouseId()
	page := req.Msg.GetPage()

	waits, err := s.products.ReprintWaits(ctx, warehouseID, pageOffset(page), int(page.GetLimit()))
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("read the products waiting for the reprint: %w", err))
	}

	ids := make([]uint64, 0, len(waits.Waits))
	for _, w := range waits.Waits {
		ids = append(ids, w.ProductID)
	}

	labels, err := reprintLabelsOf(s.db.WithContext(ctx), warehouseID, ids)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	items := make([]*inventoryv1.ProductReprintItem, 0, len(waits.Waits))
	for _, w := range waits.Waits {
		items = append(items, &inventoryv1.ProductReprintItem{
			ProductId:   w.ProductID,
			ProductCode: w.ProductCode,
			Name:        w.Name,
			FormerCode:  w.FormerCode,
			Labels:      labels[w.ProductID],
		})
	}

	return connect.NewResponse(&inventoryv1.ProductReprintListResponse{
		Items:    items,
		PageInfo: pageInfo(page, waits.Total),
	}), nil
}

// reprintLabelsOf is one label per shelf spot of `warehouseID` holding each of the products now (stock > 0), by spot
// code, keyed by product. ONE statement for the page; the ids go as one array parameter. Every product asked gets a
// slice, empty when nothing of it sits on a shelf here.
func reprintLabelsOf(db *gorm.DB, warehouseID uint64, productIDs []uint64) (map[uint64][]*inventoryv1.ProductReprintLabel, error) {
	out := make(map[uint64][]*inventoryv1.ProductReprintLabel, len(productIDs))
	if len(productIDs) == 0 {
		return out, nil
	}

	parts := make([]string, 0, len(productIDs))
	for _, id := range productIDs {
		parts = append(parts, strconv.FormatUint(id, 10))
		out[id] = []*inventoryv1.ProductReprintLabel{}
	}

	var rows []struct {
		ProductID     uint64
		PlacementID   uint64
		PlacementCode string
		Quantity      int64
	}

	err := db.
		Raw(`SELECT pp.product_id, pp.placement_id, pl.code AS placement_code, pp.stock_count AS quantity
			FROM product_placements pp
			JOIN placements pl ON pl.id = pp.placement_id
			WHERE pp.product_id = ANY(CAST(? AS bigint[])) AND pp.warehouse_id = ? AND pp.stock_count > 0
			ORDER BY pp.product_id, pl.code, pp.placement_id`,
			"{"+strings.Join(parts, ",")+"}", warehouseID).
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		out[row.ProductID] = append(out[row.ProductID], &inventoryv1.ProductReprintLabel{
			PlacementId:   row.PlacementID,
			PlacementCode: row.PlacementCode,
			Quantity:      row.Quantity,
		})
	}

	return out, nil
}
