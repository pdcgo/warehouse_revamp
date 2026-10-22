//go:build raceaudit

// Concurrency audit for WarehouseFeeSet (the audit-sql skill).
//
//	go test -tags raceaudit -count=20 -run 'TestRace_WarehouseFeeSet|TestInterleave_WarehouseFeeSet' -v ./backend/services/warehouse_service/warehouse_v1/
package warehouse_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	warehouse_v1 "github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_v1"
)

// The race's warehouse — its own id, so cleaning it can never touch a row another test owns.
const raceWarehouse uint64 = 7_700_011

func feeRaceHarness(t *testing.T) *san_race.Harness {
	t.Helper()

	h := san_race.New(t)

	clean := func() {
		err := h.DB().Exec(`DELETE FROM warehouse_fees WHERE warehouse_id = ?`, raceWarehouse).Error
		if err != nil {
			t.Errorf("cleaning the race warehouse: %v", err)
		}
	}

	clean()
	t.Cleanup(clean)

	return h
}

func raceSetFee(svc *warehouse_v1.Service, percent float64) error {
	_, err := svc.WarehouseFeeSet(context.Background(), connect.NewRequest(&warehousev1.WarehouseFeeSetRequest{
		TeamId: raceWarehouse, FeePercent: percent, MinFee: 1_000, MaxFee: proto.Float64(20_000),
	}))

	return err
}

func feeRows(t *testing.T, db *gorm.DB) (rows int64, percent float64) {
	t.Helper()

	err := db.Raw(`SELECT count(*) FROM warehouse_fees WHERE warehouse_id = ?`, raceWarehouse).Scan(&rows).Error
	if err == nil {
		err = db.Raw(`SELECT COALESCE(MAX(fee_percent), 0) FROM warehouse_fees WHERE warehouse_id = ?`, raceWarehouse).
			Scan(&percent).
			Error
	}

	if err != nil {
		t.Fatalf("read the race warehouse's fee: %v", err)
	}

	return rows, percent
}

// Eight managers set the warehouse's FIRST rate at once, each a different percent. ON CONFLICT on the unique index turns
// the losers into updates: no error, no unique violation, ONE row holding one of the eight.
func TestRace_WarehouseFeeSet_FirstRateAtOnce(t *testing.T) {
	h := feeRaceHarness(t)
	svc := warehouse_v1.NewService(h.DB(), nil)

	const n = 8

	for round := range 10 {
		err := h.DB().Exec(`DELETE FROM warehouse_fees WHERE warehouse_id = ?`, raceWarehouse).Error
		if err != nil {
			t.Fatalf("reset: %v", err)
		}

		res := h.Race(t, n, func(i int) error {
			return raceSetFee(svc, float64(1+i))
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d saves failed (unique violations: %d)", round, res.Failed(), res.Count(san_race.UniqueViolation))
		}

		rows, percent := feeRows(t, h.DB())
		if rows != 1 || percent < 1 || percent > n {
			t.Fatalf("round %d: %d rows holding %v%% — want one row, one of the eight", round, rows, percent)
		}
	}
}

// THE PROOF THE UPSERT SERIALISES on the very first rate — the case no row lock can cover. A has inserted the row and
// not committed; B's insert must WAIT on A's uncommitted key, then take the conflict path: one row, the later rate.
func TestInterleave_WarehouseFeeSet_FirstRateWaits(t *testing.T) {
	h := feeRaceHarness(t)

	set := func(percent float64) func(tx *gorm.DB) error {
		return func(tx *gorm.DB) error {
			return raceSetFee(warehouse_v1.NewService(tx, nil), percent)
		}
	}

	const second = "B sets 3%"

	sched := h.Interleave(t,
		san_race.Do("A", "A inserts the warehouse's first rate, 2%", set(2)),
		san_race.Block("B", second, set(3)),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	step := sched.Get(second)
	if !step.Blocked || !step.Released || step.Err != nil {
		t.Fatalf("B: blocked=%v released=%v err=%v — want it held on A's key, then updating", step.Blocked, step.Released, step.Err)
	}

	rows, percent := feeRows(t, h.DB())
	if rows != 1 || percent != 3 {
		t.Fatalf("%d rows holding %v%% — want one row holding the later 3%%", rows, percent)
	}
}
