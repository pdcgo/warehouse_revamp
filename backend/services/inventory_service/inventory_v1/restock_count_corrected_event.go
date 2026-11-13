package inventory_v1

import (
	"context"
	"log/slog"
	"strconv"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// publishCountCorrected announces a committed restock correction as `RestockReceivedCountCorrected` — supplier_service
// moves the supplier's restock figures on the correction's day (a-received-count-correction-counts-on-its-own-day).
//
// ⚠ A PUBLISH FAILURE DOES NOT FAIL THE CORRECTION (no-outbox-the-publish-is-trusted): the stock moved, and that is the
// truth. A lost publish is logged with its event_id; `san report refold --report supplier-restock-daily` re-reads the
// day's corrections (RestockCountCorrectionEventsOn) and claims it.
func (s *Service) publishCountCorrected(
	ctx context.Context,
	rr *models.Restock,
	t models.InventoryTransaction,
	rows []models.RestockCountCorrection,
) {
	if len(rows) == 0 {
		return
	}

	event := RestockCountCorrectedEvent(rr, rows)

	err := s.events(ctx, publishIdentity(ctx), event)
	if err != nil {
		slog.ErrorContext(ctx, "restock received count corrected but RestockReceivedCountCorrected was not published — "+
			"the supplier's figures miss this correction until the day is re-folded",
			"event_id", event.GetEventId(),
			"transaction_id", t.ID,
			"error", err,
		)
	}
}

// RestockCountCorrectedEvent builds the event ONE correction act announces — `rows` are its correction rows (one
// transaction), `rr` the restock with its items loaded. Pure and exported: the correction sends it, and the supplier
// re-fold rebuilds the very same event from the stored rows (RestockCountCorrectionEventsOn), so the two cannot disagree.
// Counts are SIGNED: accepted −N and missing +N for units out, the reverse for units in; each line carries its ordered
// count and total, so the fold values the units at the line's price as it does an accept's.
func RestockCountCorrectedEvent(rr *models.Restock, rows []models.RestockCountCorrection) *eventsv1.Event {
	items := make(map[uint64]*models.RestockItem, len(rr.Items))
	for i := range rr.Items {
		items[rr.Items[i].ID] = &rr.Items[i]
	}

	lines := make([]*eventsv1.RestockAcceptedLine, 0, len(rows))

	for _, row := range rows {
		line := &eventsv1.RestockAcceptedLine{
			ItemId:        row.RestockItemID,
			ProductId:     row.ProductID,
			AcceptedCount: -row.UnitsOut,
			MissingCount:  row.UnitsOut,
		}

		if item := items[row.RestockItemID]; item != nil {
			line.OrderedCount = item.Count
			line.TotalPrice = item.Total
			line.SupplierId = idOrZero(item.SupplierID)
			line.SupplierChannelId = idOrZero(item.SupplierChannelID)
		}

		lines = append(lines, line)
	}

	first := rows[0]
	ref := strconv.FormatUint(rr.ID, 10)

	return &eventsv1.Event{
		// DERIVED from the correction's transaction: a republish and a re-fold's claim collide in the fold's dedup.
		EventId:     "restock-count-corrected:" + strconv.FormatUint(first.TransactionID, 10),
		OccurredAt:  timestamppb.New(first.CreatedAt),
		AggregateId: "restock:" + ref,
		Message: &eventsv1.Event_RestockReceivedCountCorrected{
			RestockReceivedCountCorrected: &eventsv1.RestockReceivedCountCorrected{
				RestockId:       rr.ID,
				TeamId:          rr.TeamID,
				WarehouseId:     rr.WarehouseID,
				SupplierId:      commonLineSupplier(rr.Items),
				CorrectedOn:     first.CreatedAt.In(jakarta).Format("2006-01-02"),
				Lines:           lines,
				CorrectedAtUnix: first.CreatedAt.Unix(),
				TransactionId:   first.TransactionID,
				ActorId:         first.ActorUserID,
				ActorIsOverride: first.IsOverride,
			},
		},
	}
}

// RestockCountCorrectionEventsOn is the RestockReceivedCountCorrected event of every restock correction made on the
// Jakarta day, one per act, oldest first — built by RestockCountCorrectedEvent from the stored rows. For
// `san report refold --report supplier-restock-daily` (a-wrong-day-is-refolded-from-the-log), beside
// RestockAcceptedEventsOn: the day's restock figures are its accepts and its corrections.
func RestockCountCorrectionEventsOn(db *gorm.DB, day string) ([]*eventsv1.Event, error) {
	start, err := time.ParseInLocation("2006-01-02", day, jakarta)
	if err != nil {
		return nil, err
	}

	var rows []models.RestockCountCorrection

	err = db.
		Where("created_at >= ? AND created_at < ?", start, start.AddDate(0, 0, 1)).
		Order("transaction_id, id").
		Find(&rows).
		Error
	if err != nil {
		return nil, err
	}

	if len(rows) == 0 {
		return nil, nil
	}

	ids := make([]uint64, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.RestockID)
	}

	var restocks []models.Restock

	err = db.
		Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		Where("id IN ?", ids).
		Find(&restocks).
		Error
	if err != nil {
		return nil, err
	}

	byID := make(map[uint64]*models.Restock, len(restocks))
	for i := range restocks {
		byID[restocks[i].ID] = &restocks[i]
	}

	var events []*eventsv1.Event

	for start := 0; start < len(rows); {
		end := start
		for end < len(rows) && rows[end].TransactionID == rows[start].TransactionID {
			end++
		}

		if rr := byID[rows[start].RestockID]; rr != nil {
			events = append(events, RestockCountCorrectedEvent(rr, rows[start:end]))
		}

		start = end
	}

	return events, nil
}
