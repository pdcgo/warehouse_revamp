package supplier_v1_test

import (
	"strconv"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// A RECEIVED-COUNT CORRECTION MOVES THE SUPPLIER'S RESTOCK FIGURES ON ITS OWN DAY, SIGNED
// (docs/business/inventory/adjustment_decision.md#a-received-count-correction-counts-on-its-own-day): accepted on 3 Oct as
// 10, corrected on 10 Oct to 8 → on 10 Oct restock −2 and lost on the way +2, each at the line's price; 3 Oct never moves.

// corrected builds the RestockReceivedCountCorrected a correction would send — on a Jakarta day, at noon.
func corrected(transactionID, restockID, team, supplier uint64, day string, lines ...line) *eventsv1.Event {
	at, err := time.ParseInLocation("2006-01-02", day, time.FixedZone("WIB", 7*60*60))
	if err != nil {
		panic(err)
	}

	wire := make([]*eventsv1.RestockAcceptedLine, 0, len(lines))
	for _, l := range lines {
		wire = append(wire, &eventsv1.RestockAcceptedLine{
			ProductId: l.product, OrderedCount: l.ordered, TotalPrice: float64(l.total),
			AcceptedCount: l.accepted, MissingCount: l.lost,
		})
	}

	return &eventsv1.Event{
		EventId:     "restock-count-corrected:" + strconv.FormatUint(transactionID, 10),
		OccurredAt:  timestamppb.New(at.Add(12 * time.Hour)),
		AggregateId: "restock:" + strconv.FormatUint(restockID, 10),
		Message: &eventsv1.Event_RestockReceivedCountCorrected{RestockReceivedCountCorrected: &eventsv1.RestockReceivedCountCorrected{
			RestockId: restockID, TeamId: team, WarehouseId: 5, SupplierId: supplier, CorrectedOn: day, Lines: wire,
			TransactionId: transactionID,
		}},
	}
}

func TestFold_ACorrectionMovesTheFiguresOnItsOwnDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	fold(t, svc, accept(1, sellingA, 31, "2026-10-03", line{product: 100, ordered: 10, total: 30000, accepted: 10}))

	// Too many typed: 2 out. Then, too few: 1 back — both on 10 Oct, both signed.
	out := corrected(9001, 1, sellingA, 31, "2026-10-10", line{product: 100, ordered: 10, total: 30000, accepted: -2, lost: 2})
	fold(t, svc, out)
	fold(t, svc, out) // a redelivery folds nothing
	fold(t, svc, corrected(9002, 1, sellingA, 31, "2026-10-10", line{product: 100, ordered: 10, total: 30000, accepted: 1, lost: -1}))

	if got, want := figureRow(t, db, "2026-10-03", 31, 100, sellingA), columns(10, 30000, 0, 0, 0, 0); got != want {
		t.Fatalf("the accept's day = %+v, want %+v — never re-folded", got, want)
	}

	if got, want := figureRow(t, db, "2026-10-10", 31, 100, sellingA), columns(-1, -3000, 1, 3000, 0, 0); got != want {
		t.Fatalf("the correction's day = %+v, want %+v (−2 + 1 restock, +2 − 1 lost, at Rp 3.000)", got, want)
	}

	// A correction never lowers the backfill's cutoff — only a live accept does.
	var rows []supplier_service_models.SupplierServiceMetadata

	err := db.Where("key = ?", supplier_service_models.MetadataFiguresLiveSince).Find(&rows).Error
	if err != nil || len(rows) != 1 || rows[0].Value != "2026-10-03T05:00:00.000000Z" {
		t.Fatalf("figures_live_since = %+v (%v) — want the accept's instant", rows, err)
	}
}

// THE DAY'S RE-FOLD COUNTS A CORRECTION — a lost one (never delivered, over an hour old) is claimed and counted beside
// the day's accepts, and a late redelivery then folds nothing.
func TestDayRefold_Restock_ALostCorrectionIsRebuiltAndClaimed(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	acceptDay := accept(801, sellingA, rfSupplier, rfDay, line{product: 100, ordered: 10, total: 100_000, accepted: 10})
	lost := corrected(9101, 801, sellingA, rfSupplier, rfDay, line{product: 100, ordered: 10, total: 100_000, accepted: -3, lost: 3})

	fold(t, svc, acceptDay)

	log := refoldLog{accepts: map[string][]*eventsv1.Event{rfDay: {acceptDay, lost}}}

	result := supplierRefold(t, svc, supplier_v1.ReportRestockDaily, rfSupplier, rfDay, false, log)
	if result.Counted != 2 || result.Claimed != 1 || !result.Changed() {
		t.Fatalf("result = %+v — want the accept and the lost correction counted, the correction claimed", result)
	}

	if got := figureRow(t, db, rfDay, rfSupplier, 100, sellingA); got != columns(7, 70_000, 3, 30_000, 0, 0) {
		t.Fatalf("product 100 = %+v — want 10 − 3 restock, 3 lost", got)
	}

	fold(t, svc, lost)

	if got := figureRow(t, db, rfDay, rfSupplier, 100, sellingA); got != columns(7, 70_000, 3, 30_000, 0, 0) {
		t.Fatalf("after the redelivery = %+v — counted twice", got)
	}
}
