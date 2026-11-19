package selling_v1

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// A LOST ORDER'S PARCEL, FOUND (a-found-lost-parcel-is-a-found-stock-in, docs/business/order/context_decision.md). A parcel
// of an order gone `lost` turns up at the warehouse it shipped from, and the warehouse reports it to inventory as a found
// request NAMING THE ORDER. Inventory asks two things of the order side, through the composition root (return_orders.go
// there) — plain functions over selling's own tables, as OrderIDsByReturnTransactions: a *Service there would close a
// cycle, since selling already takes stock through inventory.
//
// The order STAYS LOST (lost-is-final): nothing here moves a status. Any money the platform paid for the loss is settled
// by hand by customer service (a-lost-parcel-is-settled-by-hand) — the note on the timeline is what tells them.

// FoundOrder is what a found report needs of the order it names: whose it is, where it shipped from, its status and its
// take. Only ids and the status leave — nothing of the selling team's money.
type FoundOrder struct {
	ID          uint64
	TeamID      uint64
	WarehouseID uint64
	// The status as stored ("lost", "shipped", …).
	Status string
	// The inventory transaction the take wrote; 0 = none recorded.
	TakeTransactionID uint64
}

// Lost is whether the order is `lost`.
func (o FoundOrder) Lost() bool {
	return o.Status == orderStatusLost
}

// FoundOrderOf reads the order a found report names — one row by its primary key; ok = false when no order has the id.
// The caller (inventory's report, scoped to its warehouse) decides what the answer allows.
func FoundOrderOf(ctx context.Context, db *gorm.DB, orderID uint64) (FoundOrder, bool, error) {
	var rows []struct {
		ID            uint64
		TeamID        uint64
		WarehouseID   uint64
		Status        string
		TransactionID *uint64
	}

	err := db.
		WithContext(ctx).
		Table("orders").
		Select("id, team_id, warehouse_id, status, transaction_id").
		Where("id = ?", orderID).
		Limit(1).
		Scan(&rows).
		Error
	if err != nil {
		return FoundOrder{}, false, err
	}

	if len(rows) == 0 {
		return FoundOrder{}, false, nil
	}

	r := rows[0]
	out := FoundOrder{ID: r.ID, TeamID: r.TeamID, WarehouseID: r.WarehouseID, Status: r.Status}

	if r.TransactionID != nil {
		out.TakeTransactionID = *r.TransactionID
	}

	return out, true, nil
}

// FoundNote is the lost order's timeline note naming a found request: what was found, where, and who reported it.
type FoundNote struct {
	OrderID        uint64
	FoundRequestID uint64
	Count          int64
	ProductCode    string
	ProductName    string
	RackCode       string
	ActorID        uint64
	IsOverride     bool
}

var errFoundNoteOrder = errors.New("a found note names its order")

// RecordFoundNote writes the lost order's NOTE naming the found request (a-note-is-a-timeline-row): one
// order_timeline_logs row with no status — the order stays lost — from the WAREHOUSE, by the person who reported it, in
// the caller's database transaction (inventory's report), so the request and its note land together.
func RecordFoundNote(ctx context.Context, tx *gorm.DB, n FoundNote) error {
	if n.OrderID == 0 {
		return errFoundNoteOrder
	}

	return recordTimelineLogs(tx.WithContext(ctx), []selling_service_models.OrderTimelineLog{{
		OrderID: n.OrderID,
		// No status: a found moves nothing (lost-is-final).
		Status:     "",
		Note:       foundNoteText(n),
		From:       timelineFromWarehouse,
		ActorID:    n.ActorID,
		IsOverride: n.IsOverride,
		CreatedAt:  time.Now(),
	}})
}

// foundNoteText is the note customer service reads: "Found at the warehouse: 2 × SBN-01 Sabun Mandi on rack A-3 — found
// request #12. The order stays lost." — the request's number is how the warehouse's Found Stock list is searched.
func foundNoteText(n FoundNote) string {
	what := strings.TrimSpace(n.ProductCode + " " + n.ProductName)

	text := "Found at the warehouse: " + strconv.FormatInt(n.Count, 10) + " × " + what
	if n.RackCode != "" {
		text += " on rack " + n.RackCode
	}

	return text + " — found request #" + strconv.FormatUint(n.FoundRequestID, 10) + ". The order stays lost."
}
