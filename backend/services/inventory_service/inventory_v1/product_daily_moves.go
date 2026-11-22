package inventory_v1

import (
	"context"
	"fmt"
	"slices"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// ProductDailyMoves is KELUAR MASUK HARIAN — a product's last fourteen Jakarta days, the Per Gudang tab of its own page
// and of its discover detail (the-warehouse-zone-is-tabs: *"the last fourteen days: date, in, out, on hand"*,
// the-discover-detail-has-the-warehouse-zone): per day, each change type's net units, what came in (Masuk), what went
// out (Keluar) and what was on hand at the end of the day (Sisa).
//
// ── The daily fold, never the ledger ────────────────────────────────────────────────────────────
//
// Every stock change writes its rows of `inventory_stock_daily_changes` in its own transaction
// (inventory_ledgers.StockTransaction, ready-stock-is-folded-in-the-stock-changes-own-step): per Jakarta day, warehouse,
// owner, product, supplier and change type, the units it moved, signed. Σ change = Σ batch_logs per key and day, by
// construction — so the day's figures are the fold's rows of the product, summed per change type over the lens, and a
// hot product's ledger (thousands of order rows) is never read.
//
//	kinds      each change type's NET units on the day — a take and its cancel on one day net in one row; a cancel on
//	           a later day lands on ITS day, positive (a-warehouse-fee-counts-on-its-day-and-a-cancel-takes-it-back-on-
//	           its-day's shape). A price correction moves no unit: never a kind.
//	Masuk      ⚠ HELD (the owner's Q2) — dailySide below.
//	Keluar     ⚠ HELD (the owner's Q2) — dailySide below.
//	Sisa       on hand at the end of the day, READ BACKWARDS FROM TODAY as Ready stock reads its position
//	           (inventory_metric_ready.go): Σ the product's batches now − Σ its changes after that day. Exact by
//	           construction, and Sisa(day) − Sisa(day before) is the day's net — so Masuk − Keluar is it too.
//
// ── The owner's units, read for anybody ─────────────────────────────────────────────────────────
//
// Every unit of the product sits in its OWNER's batches (a-batch-carries-its-owner) and the fold keys its rows by that
// owner, so the days are the owner's whoever asks: the owner is read from product_service (ProductReader.Facts, as
// DiscoverStockHistory does) and `team_id` only authorizes (stock-history-is-everyones). UNITS ONLY, for every caller —
// the answer has no value or price field at all (DiscoverStockHistory's policy: the discover detail never shows another
// team's money).
//
// ── The warehouse picker ────────────────────────────────────────────────────────────────────────
//
// `warehouse_id` is the page's Per Gudang picker (the-warehouse-picker-splits-the-page): only what moved, and what is on
// hand, in that warehouse — a transfer between two of the owner's warehouses is a Keluar in one and a Masuk in the
// other, and both under every warehouse. 0 = every warehouse.
//
// ONE statement (one snapshot): today's batches and the fold rows from the first day on, so a stock change landing
// between two reads can never leave Sisa off by its units.
func (s *Service) ProductDailyMoves(
	ctx context.Context,
	req *connect.Request[inventoryv1.ProductDailyMovesRequest],
) (*connect.Response[inventoryv1.ProductDailyMovesResponse], error) {
	filter := req.Msg.GetFilter()
	productID := filter.GetProductId()
	today := readToday(ctx)

	facts, err := s.products.Facts(ctx, req.Msg.GetTeamId(), []uint64{productID})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("ask product facts: %w", err))
	}

	// A product nobody owns (unknown) has no batches and no changes: fourteen empty days.
	fact, ok := facts[productID]
	if !ok {
		return productDailyMovesResponse(dailyMoves(today, 0, nil), req.Msg.GetDataRequest()), nil
	}

	batchScope := `b.team_id = ? AND b.product_id = ?`
	changeScope := `c.team_id = ? AND c.product_id = ?`
	args := []any{fact.TeamID, productID}

	warehouseID := filter.GetWarehouseId()
	if warehouseID > 0 {
		batchScope += ` AND b.warehouse_id = ?`
		changeScope += ` AND c.warehouse_id = ?`
		args = append(args, warehouseID)
	}

	first := today.AddDate(0, 0, -(productDailyMoveDays - 1))

	// Today's batches with units (the first row, its day NULL), then each (day, change type)'s net from the first day
	// on — a day after today included, should a clock ever write one, so Sisa stays exact.
	statement := `
		SELECT NULL::date AS day, '' AS change_type, COALESCE(SUM(b.stock_count), 0)::bigint AS units
		FROM batches b
		WHERE b.stock_count > 0 AND ` + batchScope + `
		UNION ALL
		SELECT c.day, c.change_type, SUM(c.change_count)::bigint
		FROM inventory_stock_daily_changes c
		WHERE c.day >= ` + dayLiteral(first) + ` AND ` + changeScope + `
		GROUP BY c.day, c.change_type`

	type row struct {
		Day        *time.Time
		ChangeType string
		Units      int64
	}

	var rows []row

	err = s.db.
		WithContext(ctx).
		Raw(statement, append(slices.Clone(args), args...)...).
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("product daily moves: %w", err))
	}

	var onHand int64

	changes := make([]dailyChange, 0, len(rows))

	for _, r := range rows {
		if r.Day == nil {
			onHand = r.Units

			continue
		}

		changes = append(changes, dailyChange{day: r.Day.Format(lostDateLayout), changeType: r.ChangeType, units: r.Units})
	}

	return productDailyMovesResponse(dailyMoves(today, onHand, changes), req.Msg.GetDataRequest()), nil
}

// productDailyMoveDays is how many days the tab shows — the last fourteen, today included (the-warehouse-zone-is-tabs).
const productDailyMoveDays = 14

// ── THE MASUK / KELUAR SPLIT ────────────────────────────────────────────────────────────────────
//
// ⚠ HELD — which movements are Masuk and which Keluar is the OWNER's question (Q2 of the statistics scoping); no
// decision names it. Drawn as option A until he answers: EVERY movement, by its direction on its day — each change
// type's net units of the day go to Masuk when positive and to Keluar when negative — so Sisa kemarin + Masuk − Keluar
// = Sisa, every day (the bridge of rincian-answers-two-questions: Saldo awal → Masuk → Keluar → Saldo akhir). A
// cancelled pick put back the same day as other picks lowers that day's Keluar (one `order` row nets them).
//
// dailyCounted is which change types the table counts — nil = every one (option A). Option B (sales and purchases
// only, the balance then not adding up) is the one line `var dailyCounted = []string{"restock", "order"}`.
var dailyCounted []string

// dailySide is where one change type's net units of a day land: (Masuk, Keluar), Keluar a positive count.
func dailySide(changeType string, net int64) (in, out int64) {
	if dailyCounted != nil && !slices.Contains(dailyCounted, changeType) {
		return 0, 0
	}

	if net > 0 {
		return net, 0
	}

	return 0, -net
}

// dailyKinds is the fold's change types as the wire names them, in StockChangeType order — a revaluation moves no unit.
var dailyKinds = []struct {
	changeType string
	kind       inventoryv1.StockChangeType
}{
	{"order", inventoryv1.StockChangeType_STOCK_CHANGE_TYPE_ORDER},
	{"restock", inventoryv1.StockChangeType_STOCK_CHANGE_TYPE_RESTOCK},
	{"return", inventoryv1.StockChangeType_STOCK_CHANGE_TYPE_RETURN},
	{"transfer_in", inventoryv1.StockChangeType_STOCK_CHANGE_TYPE_TRANSFER_IN},
	{"transfer_out", inventoryv1.StockChangeType_STOCK_CHANGE_TYPE_TRANSFER_OUT},
	{"sample", inventoryv1.StockChangeType_STOCK_CHANGE_TYPE_SAMPLE},
	{"broken", inventoryv1.StockChangeType_STOCK_CHANGE_TYPE_BROKEN},
	{"lost", inventoryv1.StockChangeType_STOCK_CHANGE_TYPE_LOST},
	{"found", inventoryv1.StockChangeType_STOCK_CHANGE_TYPE_FOUND},
	{"adjustment", inventoryv1.StockChangeType_STOCK_CHANGE_TYPE_ADJUSTMENT},
	{"restock_correction", inventoryv1.StockChangeType_STOCK_CHANGE_TYPE_RESTOCK_CORRECTION},
	{"transfer_correction", inventoryv1.StockChangeType_STOCK_CHANGE_TYPE_TRANSFER_CORRECTION},
}

// dailyChange is one change type's net units on one Jakarta day (YYYY-MM-DD), in the lens.
type dailyChange struct {
	day        string
	changeType string
	units      int64
}

// dailyMoves is the fourteen days ending `today`, today first: each day's kinds, Masuk and Keluar, and Sisa walked back
// from `onHand` (today's batches) — Sisa(day) = onHand − Σ every change after it, a change dated after today included.
func dailyMoves(today time.Time, onHand int64, changes []dailyChange) []*inventoryv1.ProductDailyMove {
	byDay := map[string]map[string]int64{}
	net := map[string]int64{}

	for _, c := range changes {
		if byDay[c.day] == nil {
			byDay[c.day] = map[string]int64{}
		}

		byDay[c.day][c.changeType] += c.units
		net[c.day] += c.units
	}

	// Whatever changed after today (no shelf clock should write it) comes off today's Sisa first.
	todayKey := today.Format(lostDateLayout)
	sisa := onHand

	for day, units := range net {
		if day > todayKey {
			sisa -= units
		}
	}

	days := make([]*inventoryv1.ProductDailyMove, 0, productDailyMoveDays)

	for i := range productDailyMoveDays {
		key := today.AddDate(0, 0, -i).Format(lostDateLayout)
		move := &inventoryv1.ProductDailyMove{Id: uint64(i) + 1, Day: key, OnHand: sisa}

		for _, k := range dailyKinds {
			units := byDay[key][k.changeType]
			if units == 0 {
				continue
			}

			move.Kinds = append(move.Kinds, &inventoryv1.ProductDailyMoveKind{ChangeType: k.kind, Units: units})

			in, out := dailySide(k.changeType, units)
			move.InUnits += in
			move.OutUnits += out
		}

		days = append(days, move)

		// The day before ended at this day's Sisa less what this day moved.
		sisa -= net[key]
	}

	return days
}

// productDailyMovesResponse wraps the days in the guideline's slices — the DAY slice unless asked otherwise — keyed by
// the day's position, today first.
func productDailyMovesResponse(
	days []*inventoryv1.ProductDailyMove,
	types []inventoryv1.ProductDailyMovesDataType,
) *connect.Response[inventoryv1.ProductDailyMovesResponse] {
	if len(types) == 0 {
		types = []inventoryv1.ProductDailyMovesDataType{inventoryv1.ProductDailyMovesDataType_PRODUCT_DAILY_MOVES_DATA_TYPE_DAY}
	}

	ids := make([]uint64, 0, len(days))
	for _, d := range days {
		ids = append(ids, d.GetId())
	}

	items := make([]*inventoryv1.ProductDailyMovesResponseItem, 0, len(types))

	for _, t := range types {
		switch t {
		case inventoryv1.ProductDailyMovesDataType_PRODUCT_DAILY_MOVES_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(days))
			for _, d := range days {
				m[d.GetId()] = &commonv1.GeneralItem{Id: d.GetId(), Name: d.GetDay()}
			}

			items = append(items, &inventoryv1.ProductDailyMovesResponseItem{
				D: &inventoryv1.ProductDailyMovesResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case inventoryv1.ProductDailyMovesDataType_PRODUCT_DAILY_MOVES_DATA_TYPE_DAY:
			m := make(map[uint64]*inventoryv1.ProductDailyMove, len(days))
			for _, d := range days {
				m[d.GetId()] = d
			}

			items = append(items, &inventoryv1.ProductDailyMovesResponseItem{
				D: &inventoryv1.ProductDailyMovesResponseItem_Day{Day: &inventoryv1.ProductDailyMoveMapItem{MapData: m}},
			})
		}
	}

	return connect.NewResponse(&inventoryv1.ProductDailyMovesResponse{Items: items, Ids: ids})
}
