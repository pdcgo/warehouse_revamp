//go:build raceaudit

// Concurrency audit for financial_account_service's write paths (the audit-sql skill).
//
// Every write goes through ONE lock: the account's row, FOR UPDATE, before the log row, the balance and the
// daily report are touched (ledger.go). These tests prove that lock holds where it must — the balance, the
// archive check, a transfer's two accounts — and that the withdrawal listener re-checks its shop link under
// it. Each claim of safety is closed by an Interleave that shows the step BLOCKING; a Race alone proves
// nothing when it passes.
//
//	go test -tags raceaudit -run 'TestRace_|TestInterleave_' -count=1 -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

func raceHarness(t *testing.T) *san_race.Harness {
	t.Helper()

	// Children before parents.
	return san_race.New(t,
		"financial_account_event_logs",
		"financial_account_daily_reports",
		"financial_account_logs",
		"shop_accounts",
		"operational_accounts",
		"financial_accounts",
	)
}

// on is a service whose every write runs inside tx — an Interleave step drives the REAL handler, its own
// transaction becoming a savepoint under the step's.
func on(tx *gorm.DB) *financial_account_v1.Service {
	return financial_account_v1.NewService(tx, testShops)
}

func capitalIn(svc *financial_account_v1.Service, id uint64, amount float64) error {
	_, err := svc.FinancialAccountCapital(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountCapitalRequest{
		TeamId: teamA, AccountId: id, Direction: financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_IN, Amount: amount, OccurredOn: day(0),
	}))

	return err
}

func storedAccount(t *testing.T, db *gorm.DB, id uint64) m.FinancialAccount {
	t.Helper()

	var a m.FinancialAccount

	err := db.Where("id = ?", id).Take(&a).Error
	if err != nil {
		t.Fatalf("load %d: %v", id, err)
	}

	return a
}

// ── the balance: no lost update ─────────────────────────────────────────────────────────────────

// Eight posts on one account at the same instant: the balance holds every one of them, each row's
// balance_after is distinct, and the day's report closes on the balance.
func TestRace_Post_EightCapitalsLoseNothing(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)
	a := mustCreate(t, svc, cash(teamA, "Kas", 0))

	res := h.Race(t, 8, func(int) error { return capitalIn(svc, a.GetId(), 1_000) })
	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d posts failed", res.Failed())
	}

	if got := storedAccount(t, h.DB(), a.GetId()).Balance; got != 8_000 {
		t.Fatalf("balance = %v, want 8.000 — an update was lost", got)
	}

	seen := map[float64]bool{}
	for _, row := range logs(t, h.DB(), a.GetId()) {
		if seen[row.BalanceAfter] {
			t.Fatalf("two rows share balance_after %v — they read the same balance", row.BalanceAfter)
		}

		seen[row.BalanceAfter] = true
	}

	reports := daily(t, h.DB(), a.GetId())
	if reports[len(reports)-1].CloseBalance != 8_000 {
		t.Fatalf("the day's report closes at %v", reports[len(reports)-1].CloseBalance)
	}
}

// The PROOF: a second post on the same account waits for the first, then builds on its balance.
func TestInterleave_Post_ASecondPostWaitsForTheFirst(t *testing.T) {
	h := raceHarness(t)
	a := mustCreate(t, financial_account_v1.NewService(h.DB(), testShops), cash(teamA, "Kas", 0))

	sched := h.Interleave(t,
		san_race.Do("A", "A posts 1.000", func(tx *gorm.DB) error { return capitalIn(on(tx), a.GetId(), 1_000) }),
		san_race.Block("B", "B posts 500 on the same account", func(tx *gorm.DB) error { return capitalIn(on(tx), a.GetId(), 500) }),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	if !sched.Get("B posts 500 on the same account").Released {
		t.Fatal("B did not wait for A — the account lock is not held")
	}

	rows := logs(t, h.DB(), a.GetId())
	if last := rows[len(rows)-1]; last.BalanceAfter != 1_500 {
		t.Fatalf("B's balance_after = %v, want 1.500 — it did not read A's balance", last.BalanceAfter)
	}
}

// ── a transfer: two locks, one order ────────────────────────────────────────────────────────────

// Transfers both ways between two accounts at once: never a deadlock — both locks are taken in id order —
// and the money is conserved.
func TestRace_Transfer_OppositeDirectionsNeverDeadlock(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)
	x := mustCreate(t, svc, bca(teamA, "X", "R000001", 1_000_000))
	y := mustCreate(t, svc, bca(teamA, "Y", "R000002", 1_000_000))

	res := h.Race(t, 8, func(i int) error {
		if i%2 == 0 {
			return transfer(svc, teamA, x.GetId(), y.GetId(), 1_000, day(0))
		}

		return transfer(svc, teamA, y.GetId(), x.GetId(), 1_000, day(0))
	})
	res.Report(t)

	if n := res.Count(san_race.Deadlock); n != 0 {
		t.Fatalf("%d deadlocks — the two accounts are locked in different orders", n)
	}

	if res.Failed() != 0 {
		t.Fatalf("%d transfers failed", res.Failed())
	}

	bx, by := storedAccount(t, h.DB(), x.GetId()).Balance, storedAccount(t, h.DB(), y.GetId()).Balance
	if bx != 1_000_000 || by != 1_000_000 {
		t.Fatalf("X = %v, Y = %v — four each way should leave both where they started", bx, by)
	}
}

// ── archive: only at zero, checked under the lock ───────────────────────────────────────────────

// An archive and a post at the same instant, ten times over: an archived account never holds money.
func TestRace_Archive_NeverWithMoneyInIt(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)

	for round := range 10 {
		a := mustCreate(t, svc, cash(teamA, fmt.Sprintf("Kas %d", round), 0))

		h.Race(t, 2, func(i int) error {
			if i == 0 {
				_, err := svc.FinancialAccountArchive(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountArchiveRequest{TeamId: teamA, AccountId: a.GetId()}))
				return err
			}

			return capitalIn(svc, a.GetId(), 500)
		})

		got := storedAccount(t, h.DB(), a.GetId())
		if got.Status == m.StatusArchived && got.Balance != 0 {
			t.Fatalf("round %d: archived holding %v", round, got.Balance)
		}
	}
}

// The PROOF: an archive arriving while a post holds the account waits, then sees the money and refuses.
func TestInterleave_Archive_SeesTheBalanceAPostLeft(t *testing.T) {
	h := raceHarness(t)
	a := mustCreate(t, financial_account_v1.NewService(h.DB(), testShops), cash(teamA, "Kas", 0))

	var archiveErr error

	sched := h.Interleave(t,
		san_race.Do("A", "A posts 500", func(tx *gorm.DB) error { return capitalIn(on(tx), a.GetId(), 500) }),
		san_race.Block("B", "B archives the account", func(tx *gorm.DB) error {
			_, archiveErr = on(tx).FinancialAccountArchive(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountArchiveRequest{TeamId: teamA, AccountId: a.GetId()}))
			return nil
		}),
		san_race.Commit("A"),
		san_race.Rollback("B"),
	)
	sched.Report(t)

	if !sched.Get("B archives the account").Released {
		t.Fatal("the archive did not wait for the post — its balance check is not under the lock")
	}

	if connect.CodeOf(archiveErr) != connect.CodeFailedPrecondition {
		t.Fatalf("archive after the post = %v, want FailedPrecondition", archiveErr)
	}
}

// ── one real account, one row ───────────────────────────────────────────────────────────────────

// Eight teams recording one number at once: one row, the rest AlreadyExists — never Internal.
func TestRace_Create_OneNumberOneRow(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)

	res := h.Race(t, 8, func(i int) error {
		_, err := create(svc, bca(teamA+uint64(i*10), fmt.Sprintf("BCA %d", i), "R555555", 0))
		return err
	})
	res.Report(t)

	ok, exists := 0, 0
	for _, o := range res.Outcomes {
		switch {
		case o.Err == nil:
			ok++
		case connect.CodeOf(o.Err) == connect.CodeAlreadyExists:
			exists++
		default:
			t.Fatalf("caller %d: %v — a duplicate must answer AlreadyExists", o.I, o.Err)
		}
	}

	var count int64
	h.DB().Model(&m.FinancialAccount{}).Where("account_number = ?", "R555555").Count(&count)

	if ok != 1 || exists != 7 || count != 1 {
		t.Fatalf("ok %d, exists %d, rows %d", ok, exists, count)
	}
}

// ── the withdrawal listener ─────────────────────────────────────────────────────────────────────

func deliver(svc *financial_account_v1.Service, eventID string, shop uint64, change int64) error {
	return svc.WithdrawalHandler()(context.Background(), settlementEvent(eventID, teamA, shop, settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL, change, day(0)))
}

// The same event delivered four times at once — Pub/Sub redelivering while the first is still running:
// posted ONCE, and every delivery is acked.
func TestRace_Withdrawal_OneEventFourDeliveries(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)
	a := mustCreate(t, svc, bca(teamA, "BCA", "R000101", 0))

	_, err := svc.FinancialAccountShopSet(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountShopSetRequest{TeamId: teamA, ShopId: 501, AccountId: a.GetId()}))
	if err != nil {
		t.Fatalf("link: %v", err)
	}

	res := h.Race(t, 4, func(int) error { return deliver(svc, "race-same-event", 501, -100_000) })
	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d deliveries failed — a redelivery must ack", res.Failed())
	}

	if got := storedAccount(t, h.DB(), a.GetId()).Balance; got != 100_000 {
		t.Fatalf("balance = %v — the withdrawal posted more than once", got)
	}
}

// A new shop's first four withdrawals at once: ONE unknown account and one link. A delivery that lost the
// insert fails and is redelivered — and then every withdrawal is in it, once.
func TestRace_Withdrawal_ANewShopGetsOneUnknownAccount(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)

	res := h.Race(t, 4, func(i int) error { return deliver(svc, fmt.Sprintf("race-new-shop-%d", i), 502, -10_000) })
	res.Report(t)

	// What Pub/Sub would do: redeliver every one that failed.
	for _, o := range res.Outcomes {
		if o.Err == nil {
			continue
		}

		if err := deliver(svc, fmt.Sprintf("race-new-shop-%d", o.I), 502, -10_000); err != nil {
			t.Fatalf("redelivery %d: %v", o.I, err)
		}
	}

	var accounts []m.FinancialAccount
	h.DB().Where("team_id = ? AND type = ?", teamA, m.TypeUnknown).Find(&accounts)

	if len(accounts) != 1 {
		t.Fatalf("%d unknown accounts for one shop", len(accounts))
	}

	if accounts[0].Balance != 40_000 || len(logs(t, h.DB(), accounts[0].ID)) != 4 {
		t.Fatalf("unknown account = %+v", accounts[0])
	}
}

// The PROOF of the re-check: a withdrawal that read the shop's link, then waited on the account while a move-in
// re-pointed the shop and archived the account, does NOT post into the archived account — it fails, and its
// redelivery follows the shop to the real one.
func TestInterleave_Withdrawal_FollowsAShopMovedWhileItWaited(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)

	if err := deliver(svc, "move-seed", 501, -50_000); err != nil {
		t.Fatalf("seed withdrawal: %v", err)
	}

	var link m.ShopAccount
	if err := h.DB().Where("shop_id = ?", 501).Take(&link).Error; err != nil {
		t.Fatalf("link: %v", err)
	}

	unknown := link.AccountID
	real := mustCreate(t, svc, bca(teamA, "BCA", "R000202", 0))

	var withdrawalErr error

	sched := h.Interleave(t,
		san_race.Do("A", "A moves the unknown account into BCA", func(tx *gorm.DB) error {
			_, err := on(tx).FinancialAccountIdentify(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountIdentifyRequest{
				TeamId: teamA, AccountId: unknown,
				Target: &financial_accountv1.FinancialAccountIdentifyRequest_MoveIntoAccountId{MoveIntoAccountId: real.GetId()},
			}))
			return err
		}),
		san_race.Block("B", "B posts the shop's next withdrawal", func(tx *gorm.DB) error {
			withdrawalErr = deliver(on(tx), "move-race", 501, -20_000)
			return nil
		}),
		san_race.Commit("A"),
		san_race.Rollback("B"),
	)
	sched.Report(t)

	if !sched.Get("B posts the shop's next withdrawal").Released {
		t.Fatal("the withdrawal did not wait for the move-in")
	}

	if withdrawalErr == nil {
		t.Fatal("the withdrawal posted after the shop moved — into the archived account it left")
	}

	// The redelivery follows the shop.
	if err := deliver(svc, "move-race", 501, -20_000); err != nil {
		t.Fatalf("redelivery: %v", err)
	}

	if got := storedAccount(t, h.DB(), unknown); got.Status != m.StatusArchived || got.Balance != 0 {
		t.Fatalf("unknown = %+v", got)
	}

	if got := storedAccount(t, h.DB(), real.GetId()).Balance; got != 70_000 {
		t.Fatalf("BCA = %v, want 70.000 — the moved 50.000 and the later 20.000", got)
	}
}
