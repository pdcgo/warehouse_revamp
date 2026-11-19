package inventory_mutations

import (
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// A FOUND FROM A LOST ORDER (a-found-lost-parcel-is-a-found-stock-in, docs/business/order/context_decision.md). A parcel
// of an order gone `lost` turns up at the warehouse it shipped from; the found request names the order, and approving it
// puts the units back under the order's team at THE COST THE ORDER TOOK THEM AT: the order's take already names its
// batches, so the units are minted one batch per batch the take drew from, each at the price that batch had when the
// units left the shelf (its batch row's price_unit_after — what the order line was costed at), with its expiry and
// supplier — the return's rule (a-return-mints-one-batch-per-batch-the-order-took) for a parcel that came back by
// another door. No open loss is claimed: the units were the order's, not the shelf's.
//
// The units fill the take's OLDEST batches first, after the units the order's earlier approved founds already brought
// back — so two founds of one parcel together never bring back more than it took, nor price a unit twice. A found never
// brings back more than the take drew of its product (the build's rule — more units than the order took are not the
// order's: they are reported as a found of no order).

var (
	// ErrOrderFoundNotTaken refuses a product the lost order's take never drew for the found's team.
	ErrOrderFoundNotTaken = errors.New("the lost order's take never drew this product for its team")
	// ErrOrderFoundMoreThanTaken refuses more units than the take drew of the product, less those its founds already
	// report.
	ErrOrderFoundMoreThanTaken = errors.New("more units than the lost order took")
	// ErrOrderTakeGone refuses a take that is not a standing order take of this warehouse for the order's team — rolled
	// back, or another building's.
	ErrOrderTakeGone = errors.New("the lost order's take is not a standing take of this warehouse")
	// ErrOrderFoundReturned refuses an order whose parcel already came back as its return: the units are on the shelf.
	ErrOrderFoundReturned = errors.New("the order's parcel already came back as its return")
)

// OrderFoundUnits is a found request naming a lost order: its units, the order and the order's take.
type OrderFoundUnits struct {
	FoundUnits
	// The request itself — 0 at the report, before it exists. Its own units are never counted as already found.
	RequestID         uint64
	OrderID           uint64
	TakeTransactionID uint64
}

// OrderFoundLine is one batch approving mints (or minted): units at the price the take drew them at.
type OrderFoundLine struct {
	// 0 until minted.
	BatchID   uint64
	Count     int64
	PriceUnit float64
	Amount    float64
}

// OrderFoundPreview is what approving one order found NOW would mint — Short when its order's approved founds already
// leave fewer units than it reports, and approving it is refused.
type OrderFoundPreview struct {
	Lines []OrderFoundLine
	Short bool
}

type orderProduct struct {
	orderID   uint64
	productID uint64
}

// takenRow is one batch row of a take as takenLayers reads it — plain exported fields: GORM's Scan skips an embedded
// unexported struct.
type takenRow struct {
	TransactionID     uint64
	BatchID           uint64
	ProductID         uint64
	TeamID            uint64
	Units             int64
	PriceUnit         float64
	SupplierID        uint64
	SupplierChannelID uint64
	ExpiredAt         *time.Time
}

// takenLayers reads what each take drew, per take and product, oldest batch first — ONE statement for them all. Only
// the take's own rows: a rollback's reversals are positive and never read here (outboundLayers' rule).
func takenLayers(db *gorm.DB, takeIDs []uint64) (map[uint64]map[uint64][]layer, error) {
	out := make(map[uint64]map[uint64][]layer, len(takeIDs))
	if len(takeIDs) == 0 {
		return out, nil
	}

	var rows []takenRow

	err := db.Raw(`
		SELECT l.transaction_id, l.batch_id, b.product_id, b.team_id, -l.change_count AS units,
		       l.price_unit_after AS price_unit, b.supplier_id, b.supplier_channel_id, b.expired_at
		FROM batch_logs l
		JOIN batches b ON b.id = l.batch_id
		WHERE l.transaction_id IN ? AND l.change_count < 0
		ORDER BY l.transaction_id, b.product_id, l.batch_id`, takeIDs).
		Scan(&rows).
		Error
	if err != nil {
		return nil, fmt.Errorf("read the batch rows of %d take(s): %w", len(takeIDs), err)
	}

	for _, r := range rows {
		byProduct := out[r.TransactionID]
		if byProduct == nil {
			byProduct = map[uint64][]layer{}
			out[r.TransactionID] = byProduct
		}

		byProduct[r.ProductID] = append(byProduct[r.ProductID], layer{
			BatchID:           r.BatchID,
			ProductID:         r.ProductID,
			TeamID:            r.TeamID,
			Units:             r.Units,
			PriceUnit:         r.PriceUnit,
			SupplierID:        r.SupplierID,
			SupplierChannelID: r.SupplierChannelID,
			ExpiredAt:         r.ExpiredAt,
		})
	}

	return out, nil
}

// orderFoundUnits sums, per order and product, the units of the orders' found requests in the given statuses — every
// request but `exceptID` (the one being decided). One statement, by found_requests_order_idx.
func orderFoundUnits(
	db *gorm.DB,
	orderIDs []uint64,
	statuses []models.FoundRequestStatus,
	exceptID uint64,
) (map[orderProduct]int64, error) {
	out := map[orderProduct]int64{}
	if len(orderIDs) == 0 {
		return out, nil
	}

	var rows []struct {
		OrderID   uint64
		ProductID uint64
		Units     int64
	}

	err := db.
		Model(&models.FoundRequest{}).
		Select("order_id, product_id, SUM(stock_count) AS units").
		Where("order_id IN ? AND status IN ? AND id <> ?", orderIDs, statuses, exceptID).
		Group("order_id, product_id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, fmt.Errorf("the founds of %d lost order(s): %w", len(orderIDs), err)
	}

	for _, r := range rows {
		out[orderProduct{orderID: r.OrderID, productID: r.ProductID}] = r.Units
	}

	return out, nil
}

// orderFoundShares is which layers of the take a found's `count` units come back at: the product's layers — every one
// the found's team's own — oldest first, skipping the `already` units earlier founds brought back. Refused when the take
// never drew the product for the team, or when already + count is more than it drew.
func orderFoundShares(layers []layer, u OrderFoundUnits, already int64) ([]layer, error) {
	if len(layers) == 0 {
		return nil, fmt.Errorf("%w: product %d is not in order #%d's take", ErrOrderFoundNotTaken, u.ProductID, u.OrderID)
	}

	var taken int64

	for _, l := range layers {
		if l.TeamID != u.TeamID {
			return nil, fmt.Errorf("%w: order #%d took product %d from team #%d's batches, not team #%d's",
				ErrOrderFoundNotTaken, u.OrderID, u.ProductID, l.TeamID, u.TeamID)
		}

		taken += l.Units
	}

	if u.Count <= 0 || already+u.Count > taken {
		return nil, fmt.Errorf("%w: order #%d took %d of product %d and %d are already reported found — %d more at most",
			ErrOrderFoundMoreThanTaken, u.OrderID, taken, u.ProductID, already, max(taken-already, 0))
	}

	skip := already
	want := u.Count

	var shares []layer

	for _, l := range layers {
		if want == 0 {
			break
		}

		n := l.Units

		if skip > 0 {
			gone := min(skip, n)
			skip -= gone
			n -= gone
		}

		n = min(n, want)
		if n <= 0 {
			continue
		}

		share := l
		share.Units = n
		shares = append(shares, share)
		want -= n
	}

	return shares, nil
}

// takeReturned is whether the take's parcel already came back as the order's return (order_return_checks).
func takeReturned(db *gorm.DB, takeID uint64) (bool, error) {
	var n int64

	err := db.
		Model(&models.OrderReturnCheck{}).
		Where("take_transaction_id = ?", takeID).
		Count(&n).
		Error
	if err != nil {
		return false, fmt.Errorf("look up the take's return: %w", err)
	}

	return n > 0, nil
}

// CheckOrderFound is the report's check of a found naming a lost order (a-found-lost-parcel-is-a-found-stock-in): the
// take a standing order take of this warehouse for the found's team, its parcel not already returned, the product one
// it drew for the team, and the units no more than it drew less what the order's founds — waiting or approved — already
// report. Plain reads: the approval re-checks under the take's row lock.
func CheckOrderFound(db *gorm.DB, u OrderFoundUnits) error {
	var n int64

	err := db.
		Model(&models.InventoryTransaction{}).
		Where("id = ? AND tx_type = ? AND team_id = ? AND warehouse_id = ? AND NOT is_rollback",
			u.TakeTransactionID, models.TxOrder, u.TeamID, u.WarehouseID).
		Count(&n).
		Error
	if err != nil {
		return fmt.Errorf("read the lost order's take: %w", err)
	}

	if n == 0 {
		return fmt.Errorf("%w: order #%d", ErrOrderTakeGone, u.OrderID)
	}

	return checkOrderFoundRoom(db, u, []models.FoundRequestStatus{models.FoundWaiting, models.FoundApproved})
}

// checkOrderFoundRoom refuses a returned parcel and a found its take leaves no room for, counting the order's founds in
// the given statuses.
func checkOrderFoundRoom(db *gorm.DB, u OrderFoundUnits, statuses []models.FoundRequestStatus) error {
	returned, err := takeReturned(db, u.TakeTransactionID)
	if err != nil {
		return err
	}

	if returned {
		return fmt.Errorf("%w: order #%d", ErrOrderFoundReturned, u.OrderID)
	}

	layers, err := takenLayers(db, []uint64{u.TakeTransactionID})
	if err != nil {
		return err
	}

	found, err := orderFoundUnits(db, []uint64{u.OrderID}, statuses, u.RequestID)
	if err != nil {
		return err
	}

	_, err = orderFoundShares(layers[u.TakeTransactionID][u.ProductID], u, found[orderProduct{u.OrderID, u.ProductID}])

	return err
}

// PreviewOrderFound works out what approving each WAITING order found would mint now — each on its own, after the
// units its order's APPROVED founds already brought back — in two statements whatever their number: the takes' batch
// rows and the approved founds' units. Read without locks; the approval re-reads under the take's row lock.
func PreviewOrderFound(db *gorm.DB, units []OrderFoundUnits) ([]OrderFoundPreview, error) {
	out := make([]OrderFoundPreview, len(units))
	if len(units) == 0 {
		return out, nil
	}

	takeIDs := make([]uint64, 0, len(units))
	orderIDs := make([]uint64, 0, len(units))

	for _, u := range units {
		takeIDs = append(takeIDs, u.TakeTransactionID)
		orderIDs = append(orderIDs, u.OrderID)
	}

	layers, err := takenLayers(db, takeIDs)
	if err != nil {
		return nil, err
	}

	approved, err := orderFoundUnits(db, orderIDs, []models.FoundRequestStatus{models.FoundApproved}, 0)
	if err != nil {
		return nil, err
	}

	for i, u := range units {
		shares, shareErr := orderFoundShares(layers[u.TakeTransactionID][u.ProductID], u,
			approved[orderProduct{u.OrderID, u.ProductID}])
		if shareErr != nil {
			out[i].Short = true

			continue
		}

		for _, s := range shares {
			out[i].Lines = append(out[i].Lines, OrderFoundLine{
				Count: s.Units, PriceUnit: s.PriceUnit, Amount: float64(s.Units) * s.PriceUnit,
			})
		}
	}

	return out, nil
}

// OrderFoundApproval is an approved found naming a lost order.
type OrderFoundApproval struct {
	OrderFoundUnits
	ActorID uint64
	// Stamped on the transaction (an-override-is-stamped-in-every-service).
	IsOverride  bool
	Description string
}

// PostOrderFoundApproval posts an approved found naming a lost order in the caller's database transaction: ONE `found`
// transaction of the order's team that mints the units one batch per take layer at the price the order took them at,
// puts them on the request's rack and writes its item — no claim, no liability, no money. Locks, after the request
// (the caller's), the take's row — two approvals of one order's founds queue there and the second counts the first's
// units — then the rack row, refused under a count's lock (a-lock-stops-sales-and-cancels-too).
func PostOrderFoundApproval(tx *gorm.DB, a OrderFoundApproval) (FoundApproved, error) {
	var take models.InventoryTransaction

	err := tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND tx_type = ? AND team_id = ? AND warehouse_id = ? AND NOT is_rollback",
			a.TakeTransactionID, models.TxOrder, a.TeamID, a.WarehouseID).
		Take(&take).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return FoundApproved{}, fmt.Errorf("%w: order #%d", ErrOrderTakeGone, a.OrderID)
	}

	if err != nil {
		return FoundApproved{}, fmt.Errorf("lock the lost order's take: %w", err)
	}

	returned, err := takeReturned(tx, a.TakeTransactionID)
	if err != nil {
		return FoundApproved{}, err
	}

	if returned {
		return FoundApproved{}, fmt.Errorf("%w: order #%d", ErrOrderFoundReturned, a.OrderID)
	}

	layers, err := takenLayers(tx, []uint64{a.TakeTransactionID})
	if err != nil {
		return FoundApproved{}, err
	}

	approved, err := orderFoundUnits(tx, []uint64{a.OrderID}, []models.FoundRequestStatus{models.FoundApproved}, a.RequestID)
	if err != nil {
		return FoundApproved{}, err
	}

	shares, err := orderFoundShares(layers[a.TakeTransactionID][a.ProductID], a.OrderFoundUnits,
		approved[orderProduct{a.OrderID, a.ProductID}])
	if err != nil {
		return FoundApproved{}, err
	}

	t, err := inventory_ledgers.CreateTransaction(tx, inventory_ledgers.NewTransaction{
		WarehouseID: a.WarehouseID,
		TeamID:      a.TeamID,
		TxType:      models.TxFound,
		ActorID:     a.ActorID,
		IsOverride:  a.IsOverride,
		Description: a.Description,
	})
	if err != nil {
		return FoundApproved{}, err
	}

	mints := make([]inventory_ledgers.Mint, 0, len(shares))
	for _, s := range shares {
		mints = append(mints, inventory_ledgers.Mint{
			Transaction:       t,
			TeamID:            a.TeamID,
			ProductID:         a.ProductID,
			Count:             s.Units,
			PriceUnit:         s.PriceUnit,
			SupplierID:        s.SupplierID,
			SupplierChannelID: s.SupplierChannelID,
			ExpiredAt:         s.ExpiredAt,
			ChangeType:        string(models.TxFound),
			ActorID:           a.ActorID,
			Description:       a.Description,
		})
	}

	// BATCHES — new ones only, all written at once (ledger-writes-are-set-based)...
	minted, err := inventory_ledgers.MintBatches(tx, mints)
	if err != nil {
		return FoundApproved{}, err
	}

	out := FoundApproved{Transaction: CountTransaction{Transaction: t, TxType: models.TxFound}}

	var value float64

	for _, b := range minted {
		value += b.InitStockValuation
		out.Transaction.MintedBatchIDs = append(out.Transaction.MintedBatchIDs, b.ID)
	}

	out.Transaction.MintedValue = value

	// ...then the RACK — refused, whole, under a count's lock on the product there.
	_, err = inventory_ledgers.PutOnPlacements(tx, t, string(models.TxFound), a.ActorID, a.Description, []inventory_ledgers.Put{{
		TeamID: a.TeamID, ProductID: a.ProductID, PlacementID: a.PlacementID, Count: a.Count,
	}})
	if err != nil {
		return FoundApproved{}, err
	}

	// One item, equal to its batches (an-item-equals-its-batch-rows).
	err = inventory_ledgers.AddItems(tx, t, []inventory_ledgers.ItemLine{{
		ProductID: a.ProductID, ProductTeamID: a.TeamID, Quantity: a.Count, Total: value,
	}})
	if err != nil {
		return FoundApproved{}, err
	}

	return out, nil
}
