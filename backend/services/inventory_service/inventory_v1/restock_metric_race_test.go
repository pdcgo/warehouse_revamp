//go:build raceaudit

// Concurrency audit for RESTOCK BEFORE THE ACCEPT on Analytic (the-restock-before-the-accept-prototype-is-accepted): a
// restock's create, edit, cancel, mark lost and sign now run in inventory_ledgers.StockTransaction and add their facts to
// the restock's door rows (`inventory_door_daily_reports`) as the transaction's LAST statement — after the restock row
// they lock FOR UPDATE first, as the accept always did. An edit's difference is read UNDER that lock (the lines as
// stored, then as written), so two writers of one restock queue on its row and each nets against what the other left:
// the report's ordered must always equal the restock's lines as they finally stand. Build-tagged: san_race COMMITS.
//
//	go test -tags raceaudit -p 1 -run "TestRace_RestockMetric" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"math"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
)

var restockMetricRaceTables = append([]string{"restock_log_changes", "restock_problem_items", "restock_logs",
	"restock_items", "restocks", "warehouse_products"}, ledgerTables...)

// orderedAgrees is THE CHECK: Σ the door rows' ordered (units and value) equals Σ every restock's lines as they stand —
// units, and the restock's total (goods + shipping) — and Σ missing equals what the accepted lines ordered beyond the
// box. Returns the restocks' units, so a test can say it compared something.
func orderedAgrees(t *testing.T, db *gorm.DB, round int) int64 {
	t.Helper()

	var truth, report struct {
		Units   int64
		Value   float64
		Missing int64
	}

	err := db.Raw(`
SELECT (SELECT COALESCE(SUM(i.count), 0) FROM restock_items i) AS units,
       (SELECT COALESCE(SUM(i.total), 0) FROM restock_items i) + (SELECT COALESCE(SUM(shipment_cost), 0) FROM restocks) AS value,
       (SELECT COALESCE(SUM(i.count - i.received_count), 0) FROM restock_items i JOIN restocks r ON r.id = i.restock_id
        WHERE r.status = 'accepted') AS missing`).Scan(&truth).Error
	if err != nil {
		t.Fatalf("round %d: the restocks: %v", round, err)
	}

	err = db.Raw(`SELECT COALESCE(SUM(ordered_count), 0) AS units, COALESCE(SUM(ordered_value), 0)::float8 AS value,
		COALESCE(SUM(missing_count), 0) AS missing FROM inventory_door_daily_reports WHERE source = 'restock'`).
		Scan(&report).Error
	if err != nil {
		t.Fatalf("round %d: the door rows: %v", round, err)
	}

	if report.Units != truth.Units || math.Abs(report.Value-truth.Value) >= 0.0001 || report.Missing != truth.Missing {
		t.Fatalf("round %d: the report reads %d ordered / Rp %v / %d missing — the restocks stand at %d / Rp %v / %d",
			round, report.Units, report.Value, report.Missing, truth.Units, truth.Value, truth.Missing)
	}

	return truth.Units
}

// AN EDIT RACING THE ACCEPT OF ONE RESTOCK: an arrived box, the selling team raising its line 4 → 6 while the warehouse
// counts 4 in. Either the edit commits first and the accept counts the 4 against 6 (2 missing), or the accept commits
// first and the edit is refused (an accepted restock is closed). Either way the report's ordered equals the line as it
// stands and its missing what the box lacked — never an edit's difference read against a line the other moved. Each side
// is held back on alternate rounds so both orders are hit; the rounds taking each path are logged.
func TestRace_RestockMetric_AnEditAgainstTheAccept(t *testing.T) {
	h := san_race.New(t, restockMetricRaceTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())
	rack := reportRack(t, h.DB())

	const rounds = 12

	var editFirst, acceptFirst int

	for round := range rounds {
		restock := raceRestocks(t, svc, 1, 4)[0]
		item := restock.GetItems()[0]

		_, err := svc.RestockRequestArrive(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestArriveRequest{
			TeamId: raceWarehouse, RequestId: restock.GetId(),
		}))
		if err != nil {
			t.Fatalf("round %d: sign: %v", round, err)
		}

		res := h.Race(t, 2, func(i int) error {
			if i == 0 {
				if round%2 == 1 {
					time.Sleep(time.Duration(round%8) * time.Millisecond)
				}

				_, editErr := svc.RestockRequestUpdate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
					TeamId: raceOwner, RequestId: restock.GetId(), WarehouseId: raceWarehouse,
					Items: []*inventoryv1.RestockRequestItem{{
						ProductId: raceProductA, ProductCode: item.GetProductCode(), Name: "A", Count: 6, Total: 6000,
					}},
				}))

				return editErr
			}

			if round%2 == 0 {
				time.Sleep(time.Duration(2+round%8) * time.Millisecond)
			}

			_, acceptErr := svc.RestockRequestAccept(ctxUser(8), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
				TeamId: raceWarehouse, RequestId: restock.GetId(),
				Lines: []*inventoryv1.RestockRequestReceivedLine{{
					ItemId: item.GetId(), ReceivedCount: 4, Placements: placedOn(rack, 4),
				}},
			}))

			return acceptErr
		})
		res.Report(t)

		if res.Outcomes[1].Err != nil {
			t.Fatalf("round %d: the accept failed: %v", round, res.Outcomes[1].Err)
		}

		editErr := res.Outcomes[0].Err

		switch {
		case editErr == nil:
			editFirst++
		case connect.CodeOf(editErr) == connect.CodeFailedPrecondition:
			acceptFirst++
		default:
			t.Fatalf("round %d: the edit failed with %v — want success or FailedPrecondition", round, editErr)
		}

		if orderedAgrees(t, h.DB(), round) == 0 {
			t.Fatalf("round %d: compared nothing", round)
		}
	}

	t.Logf("%d rounds: the edit first in %d, the accept first (edit refused) in %d", rounds, editFirst, acceptFirst)
	ledgerMatchesReport(t, h.DB())
}

// TWO EDITS OF ONE RESTOCK AT ONCE: the same ongoing restock edited to 6 units and Rp 1.000 shipping, and to 9 units and
// Rp 2.000, at the same second. Both commit, one after the other on the restock's row lock; the second's difference is
// read against what the first wrote, so the report's ordered is exactly the edit that committed last — units and value —
// never the two differences against the same old lines.
func TestRace_RestockMetric_TwoEditsAtOnce(t *testing.T) {
	h := san_race.New(t, restockMetricRaceTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())

	const rounds = 12

	for round := range rounds {
		restock := raceRestocks(t, svc, 1, 4)[0]
		item := restock.GetItems()[0]

		res := h.Race(t, 2, func(i int) error {
			if i == round%2 {
				time.Sleep(time.Duration(round%5) * time.Millisecond)
			}

			count := int64(6 + 3*i)

			_, err := svc.RestockRequestUpdate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
				TeamId: raceOwner, RequestId: restock.GetId(), WarehouseId: raceWarehouse, FinanceAccountId: 41,
				ShipmentCost: float64(1000 * (i + 1)),
				Items: []*inventoryv1.RestockRequestItem{{
					ProductId: raceProductA, ProductCode: item.GetProductCode(), Name: "A", Count: count,
					Total: float64(count) * 1000,
				}},
			}))

			return err
		})
		res.Report(t)

		if res.Failed() != 0 {
			t.Fatalf("round %d: %d of 2 edits failed", round, res.Failed())
		}

		var stored int64
		h.DB().Raw(`SELECT count FROM restock_items WHERE restock_id = ?`, restock.GetId()).Scan(&stored)

		if stored != 6 && stored != 9 {
			t.Fatalf("round %d: the line stands at %d — want one edit's 6 or 9", round, stored)
		}

		orderedAgrees(t, h.DB(), round)
	}
}
