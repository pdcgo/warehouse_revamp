package supplier_v1_test

import (
	"context"
	"strconv"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// line is one counted restock line: ordered units for a total, then what the accept found.
type line struct {
	product                uint64
	ordered, total         int64
	accepted, broken, lost int64
}

// accept builds the RestockAccepted the restock's accept would send — on a Jakarta day, at noon that day.
func accept(restockID, team, supplier uint64, day string, lines ...line) *eventsv1.Event {
	at, err := time.ParseInLocation("2006-01-02", day, time.FixedZone("WIB", 7*60*60))
	if err != nil {
		panic(err)
	}

	wire := make([]*eventsv1.RestockAcceptedLine, 0, len(lines))
	for _, l := range lines {
		wire = append(wire, &eventsv1.RestockAcceptedLine{
			ProductId: l.product, OrderedCount: l.ordered, TotalPrice: l.total,
			AcceptedCount: l.accepted, BrokenCount: l.broken, MissingCount: l.lost,
		})
	}

	ref := strconv.FormatUint(restockID, 10)

	return &eventsv1.Event{
		EventId:     "restock-accepted:" + ref,
		OccurredAt:  timestamppb.New(at.Add(12 * time.Hour)),
		AggregateId: "restock:" + ref,
		Message: &eventsv1.Event_RestockAccepted{RestockAccepted: &eventsv1.RestockAccepted{
			RestockId: restockID, TeamId: team, WarehouseId: 5, SupplierId: supplier, AcceptedOn: day, Lines: wire,
		}},
	}
}

// fold sends one event through the webhook's handler — the live path.
func fold(t *testing.T, svc *supplier_v1.Service, event *eventsv1.Event) {
	t.Helper()

	err := svc.FoldHandler()(context.Background(), event)
	if err != nil {
		t.Fatalf("fold %s: %v", event.GetEventId(), err)
	}
}

// figureRow reads one (day, supplier, product, team) row — the zero value when there is none.
func figureRow(t *testing.T, db *gorm.DB, day string, supplier, product, team uint64) supplier_service_models.SupplierMetricColumns {
	t.Helper()

	var rows []supplier_service_models.SupplierProductDailyReport

	err := db.
		Where("day = CAST(? AS date) AND supplier_id = ? AND product_id = ? AND team_id = ?", day, supplier, product, team).
		Find(&rows).
		Error
	if err != nil {
		t.Fatalf("read figures: %v", err)
	}

	if len(rows) == 0 {
		return supplier_service_models.SupplierMetricColumns{}
	}

	return rows[0].SupplierMetricColumns
}

// metric is a SupplierMetric written as six numbers, for comparing.
func metric(rc, rv, lc, lv, bc, bv int64) *supplierv1.SupplierMetric {
	return &supplierv1.SupplierMetric{
		RestockCount: rc, RestockValuation: rv,
		ShippingLostCount: lc, ShippingLostValuation: lv,
		ShippingBrokenCount: bc, ShippingBrokenValuation: bv,
	}
}

func columns(rc, rv, lc, lv, bc, bv int64) supplier_service_models.SupplierMetricColumns {
	return supplier_service_models.SupplierMetricColumns{
		RestockCount: rc, RestockValuation: rv,
		ShippingLostCount: lc, ShippingLostValuation: lv,
		ShippingBrokenCount: bc, ShippingBrokenValuation: bv,
	}
}

func dateRange(start, end string) *supplierv1.AnalyticDateRange {
	return &supplierv1.AnalyticDateRange{StartDate: start, EndDate: end}
}

// eventsOf is a backfill source over a slice.
func eventsOf(events ...*eventsv1.Event) supplier_v1.BackfillSource {
	return func(each func(*eventsv1.Event) error) error {
		for _, event := range events {
			err := each(event)
			if err != nil {
				return err
			}
		}

		return nil
	}
}

// setEventLock flips the maintenance switch directly — what a developer does by hand.
func setEventLock(t *testing.T, db *gorm.DB, value string) {
	t.Helper()

	err := db.Exec(`UPDATE supplier_service_metadata SET value = ? WHERE key = 'process_event_lock'`, value).Error
	if err != nil {
		t.Fatalf("set lock: %v", err)
	}
}

func metadata(t *testing.T, db *gorm.DB, key string) string {
	t.Helper()

	var rows []supplier_service_models.SupplierServiceMetadata

	err := db.Where("key = ?", key).Find(&rows).Error
	if err != nil {
		t.Fatalf("read metadata: %v", err)
	}

	if len(rows) == 0 {
		return ""
	}

	return rows[0].Value
}
