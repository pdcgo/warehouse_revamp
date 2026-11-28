package inventory_v1

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// DiscoverStockHistory is the RIWAYAT STOK of ANY team's product — the discover detail's tab, read by a selling team
// deciding whether to sell another team's product (stock-history-is-everyones: *"riwayat stok boleh dibaca semua
// orang"*). What came in, what went out and what was left, per warehouse.
//
// ── The owner's ledger, read for anybody ─────────────────────────────────────────────────────────
//
// A product's stock history IS its owner's: the batches carry their owner (a-batch-carries-its-owner) and every unit of
// the product sits in the owner's batches — a borrowing team's order takes from them too. So the rows are exactly
// OwnerStockHistory's for the product's OWNER, whoever asks: the owner is read from product_service (ProductReader.Facts,
// as DiscoverStockByIds does), `team_id` only authorizes, and the running balance is the same window over the owner's
// unfiltered ledger, partitioned by warehouse — so a row reads the same number on both pages.
//
// ── Never the owner's money, nor anything else of theirs ─────────────────────────────────────────
//
// OwnerMovement carries the batch's price before and after, the value a row changed, the batch, the reason typed, the
// order's key or the restock's receipt, and the person — the owner's, every one. The discover detail never shows
// another team's cost (the-supplier-tab-names-the-store; DiscoverStockByIds never sends it) and its columns are Waktu ·
// Transaksi · Gudang · Perubahan · Sesudahnya (the-discover-history-names-no-batch). So this read does not SELECT them:
// DiscoverMovement has no field for any, and a price correction — a row that moved no unit and is only money (the
// owner's Koreksi Harga) — is not a row here. Leaving it out changes no balance: it moved nothing.
func (s *Service) DiscoverStockHistory(
	ctx context.Context,
	req *connect.Request[inventoryv1.DiscoverStockHistoryRequest],
) (*connect.Response[inventoryv1.DiscoverStockHistoryResponse], error) {
	filter := req.Msg.GetFilter()
	page := req.Msg.GetPage()
	productID := filter.GetProductId()

	facts, err := s.products.Facts(ctx, req.Msg.GetTeamId(), []uint64{productID})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("ask product facts: %w", err))
	}

	// A product nobody owns (unknown) has no ledger: an empty page, as DiscoverStockByIds answers zeros.
	fact, ok := facts[productID]
	if !ok {
		return discoverHistoryResponse(nil, req.Msg.GetDataRequest(), page, 0), nil
	}

	inner := `
		SELECT l.id, b.product_id, l.warehouse_id, l.change_type, l.change_count AS delta,
		       SUM(l.change_count) OVER (PARTITION BY l.warehouse_id ORDER BY l.id) AS balance,
		       l.created_at
		FROM batch_logs l
		JOIN batches b ON b.id = l.batch_id
		WHERE b.team_id = ? AND b.product_id = ?`

	args := []any{fact.TeamID, productID}

	warehouseID := filter.GetWarehouseId()
	if warehouseID > 0 {
		inner += ` AND l.warehouse_id = ?`
		args = append(args, warehouseID)
	}

	// Outside the window, as OwnerStockHistory's filters are: a price correction moved no unit (change 0), so leaving it
	// out changes no row's balance — the window is still the whole ledger's.
	where := ` WHERE x.change_type <> 'revaluation'`

	db := s.db.WithContext(ctx)

	var total int64

	err = db.Raw("SELECT COUNT(*) FROM ("+inner+") x"+where, args...).Scan(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	type row struct {
		ID          uint64
		ProductID   uint64
		WarehouseID uint64
		ChangeType  string
		Delta       int64
		Balance     int64
		CreatedAt   time.Time
	}

	var rows []row

	err = db.
		Raw("SELECT * FROM ("+inner+") x"+where+" ORDER BY x.id DESC LIMIT ? OFFSET ?",
			append(append([]any{}, args...), int(page.GetLimit()), pageOffset(page))...).
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	movements := make([]*inventoryv1.DiscoverMovement, 0, len(rows))

	for i := range rows {
		r := &rows[i]

		movements = append(movements, &inventoryv1.DiscoverMovement{
			Id:            r.ID,
			ProductId:     r.ProductID,
			WarehouseId:   r.WarehouseID,
			Kind:          productPageKindOf(r.ChangeType, r.Delta),
			Delta:         r.Delta,
			Balance:       r.Balance,
			CreatedAtUnix: r.CreatedAt.Unix(),
		})
	}

	return discoverHistoryResponse(movements, req.Msg.GetDataRequest(), page, total), nil
}

// discoverHistoryResponse wraps a page of rows in the guideline's slices — the MOVEMENT slice unless asked otherwise —
// keyed by the ledger row's id.
func discoverHistoryResponse(
	movements []*inventoryv1.DiscoverMovement,
	types []inventoryv1.DiscoverStockHistoryDataType,
	page *commonv1.CommonPagination,
	total int64,
) *connect.Response[inventoryv1.DiscoverStockHistoryResponse] {
	if len(types) == 0 {
		types = []inventoryv1.DiscoverStockHistoryDataType{
			inventoryv1.DiscoverStockHistoryDataType_DISCOVER_STOCK_HISTORY_DATA_TYPE_MOVEMENT,
		}
	}

	ids := make([]uint64, 0, len(movements))
	for _, mv := range movements {
		ids = append(ids, mv.GetId())
	}

	items := make([]*inventoryv1.DiscoverStockHistoryResponseItem, 0, len(types))

	for _, t := range types {
		switch t {
		case inventoryv1.DiscoverStockHistoryDataType_DISCOVER_STOCK_HISTORY_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(movements))
			for _, mv := range movements {
				m[mv.GetId()] = &commonv1.GeneralItem{Id: mv.GetId()}
			}

			items = append(items, &inventoryv1.DiscoverStockHistoryResponseItem{
				D: &inventoryv1.DiscoverStockHistoryResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case inventoryv1.DiscoverStockHistoryDataType_DISCOVER_STOCK_HISTORY_DATA_TYPE_MOVEMENT:
			m := make(map[uint64]*inventoryv1.DiscoverMovement, len(movements))
			for _, mv := range movements {
				m[mv.GetId()] = mv
			}

			items = append(items, &inventoryv1.DiscoverStockHistoryResponseItem{
				D: &inventoryv1.DiscoverStockHistoryResponseItem_Movement{Movement: &inventoryv1.DiscoverMovementMapItem{MapData: m}},
			})
		}
	}

	return connect.NewResponse(&inventoryv1.DiscoverStockHistoryResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	})
}
