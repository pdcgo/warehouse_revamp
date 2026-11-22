//go:build raceaudit

// Concurrency audit for capital's second door on Biaya (expense_v1/capital_from_account.go —
// prive-and-deposit-on-pengeluaran-are-the-accounts-capital): the listener claims the event and inserts the act's one
// row ON CONFLICT (account_log_id) DO NOTHING, then folds the metric — in one transaction. The same account row arriving
// many times at once (a redelivery, a republish under another id, the import beside the door) is ONE row and one fold;
// two Setor at once beside a typed expense on the same team and day all land, and the report equals the records.
// Build-tagged: san_race COMMITS.
//
//	go test -tags raceaudit -p 1 -run "TestRace_CapitalFromAccount" -v ./backend/services/expense_service/expense_v1/
package expense_v1_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

// raceDoorTeam is raceTeam plus the claims this test's events leave committed.
func raceDoorTeam(t *testing.T, db *gorm.DB, prefix string) uint64 {
	t.Helper()

	team := raceTeam(t, db)

	t.Cleanup(func() {
		db.Where("event_id LIKE ?", prefix+"%").Delete(&expense_service_models.ExpenseEventLog{})
	})

	return team
}

func doorEvent(prefix string, n int, logID, team uint64, change float64) *eventsv1.Event {
	event := capitalEvent(logID, team, plainAccount, change, raceDay, "", false)
	event.EventId = fmt.Sprintf("%s%d:%d", prefix, logID, n)

	return event
}

// ONE ACCOUNT ROW, SIXTEEN ARRIVALS AT ONCE — eight redeliveries of one event and eight republishes under other ids, per
// round: exactly one Biaya row and one fold per account row, every arrival acked.
func TestRace_CapitalFromAccount_OneRowArrivingManyTimesAtOnce(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	svc := newService(t, db)

	prefix := fmt.Sprintf("race-door-%d:", time.Now().UnixNano())
	team := raceDoorTeam(t, db, prefix)
	base := uint64(900_000_000 + time.Now().UnixNano()%1_000_000)

	for round := range 10 {
		logID := base + uint64(round)
		same := doorEvent(prefix, 0, logID, team, 400_000)

		res := h.Race(t, 16, func(i int) error {
			event := same
			if i%2 == 1 {
				event = doorEvent(prefix, i, logID, team, 400_000)
			}

			return svc.CapitalFromAccountHandler()(context.Background(), event)
		})

		if res.Failed() != 0 {
			res.Report(t)
			t.Fatalf("round %d: %d of 16 arrivals failed — a duplicate is acked, never an error", round, res.Failed())
		}

		var rows int64

		db.Model(&expense_service_models.ExpenseRecord{}).Where("account_log_id = ?", logID).Count(&rows)

		reported, _, recorded := theRow(t, db, team)
		want := float64(round+1) * 400_000

		if rows != 1 || !san_money.Equal(reported, want) || !san_money.Equal(recorded, want) {
			t.Fatalf("round %d: %d rows for account row %d, report %v, records %v — want one, %v", round, rows, logID,
				reported, recorded, want)
		}
	}
}

// TWO SETOR AT ONCE BESIDE A TYPED EXPENSE, one team, one day, per round: three rows, the report equal to the records
// (the setoran's capital-in row and the expense's spending row each take their own).
func TestRace_CapitalFromAccount_TwoSetorBesideAnExpense(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	svc := newService(t, db)

	prefix := fmt.Sprintf("race-door2-%d:", time.Now().UnixNano())
	team := raceDoorTeam(t, db, prefix)
	base := uint64(910_000_000 + time.Now().UnixNano()%1_000_000)

	for round := range 10 {
		first := doorEvent(prefix, 0, base+uint64(2*round), team, 250_000)
		second := doorEvent(prefix, 0, base+uint64(2*round+1), team, 150_000)

		res := h.Race(t, 3, func(i int) error {
			switch i {
			case 0:
				return svc.CapitalFromAccountHandler()(context.Background(), first)
			case 1:
				return svc.CapitalFromAccountHandler()(context.Background(), second)
			default:
				_, err := svc.ExpenseCreate(asCaller(userBudi, team, role_basev1.Role_ROLE_SELLING_OWNER), connect.NewRequest(&expensev1.ExpenseCreateRequest{
					TeamId: team, Type: expensev1.ExpenseType_EXPENSE_TYPE_ELECTRICITY, Amount: 33_000, OccurredAt: raceDay,
					FinanceAccountId: payingAccount,
				}))

				return err
			}
		})

		if res.Failed() != 0 {
			res.Report(t)
			t.Fatalf("round %d: %d of 3 failed", round, res.Failed())
		}

		var rows int64

		db.Model(&expense_service_models.ExpenseRecord{}).Where("team_id = ?", team).Count(&rows)

		reported, _, recorded := theRow(t, db, team)
		want := float64(round+1) * (250_000 + 150_000 + 33_000)

		if rows != int64(3*(round+1)) || !san_money.Equal(reported, recorded) || !san_money.Equal(reported, want) {
			t.Fatalf("round %d: %d rows, report %v, records %v — want %d rows reading %v", round, rows, reported, recorded,
				3*(round+1), want)
		}
	}
}
