package liability_v1_test

import (
	"context"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

func checkCredit(
	t *testing.T,
	svc *liability_v1.Service,
	debtor uint64,
	creditors ...uint64,
) *liability_v1.CreditBlock {
	t.Helper()

	block, err := svc.CheckCredit(context.Background(), debtor, creditors)
	if err != nil {
		t.Fatalf("CheckCredit(%d): %v", debtor, err)
	}

	return block
}

// oweThem makes the debtor owe the creditor `amount`, through the ledger rather than by writing a
// balance row — the check must agree with the books, not with a fixture.
func oweThem(t *testing.T, svc *liability_v1.Service, db *gorm.DB, amount int64, sourceID uint64) {
	t.Helper()

	_, err := svc.PostEntry(context.Background(), db, codFee(amount, sourceID))
	if err != nil {
		t.Fatalf("post %d: %v", amount, err)
	}
}

// NO TERMS MEANS UNLIMITED. A creditor that has configured nothing is extending unlimited credit —
// this is the day-one state of every pair in the system, so it must not block anything.
func TestCheckCredit_UnconfiguredCreditorAllows(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	oweThem(t, svc, db, 99_000_000, 1)

	if block := checkCredit(t, svc, selling, warehouse); block != nil {
		t.Fatalf("blocked by %d with no terms configured — unconfigured must allow",
			block.CreditorTeamID)
	}
}

// ⚠ AN ABSENT LIMIT IS UNLIMITED EVEN WHEN THE OTHER TERMS EXIST. A warehouse that set a handling fee
// but no limit is charging, not capping — reading the missing limit as 0 would freeze every team it
// has ever configured a rate for.
func TestCheckCredit_TermsWithoutALimitAllow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	putTerms(t, svc, warehouse, selling, 12000, 2000, nil)
	oweThem(t, svc, db, 99_000_000, 1)

	if block := checkCredit(t, svc, selling, warehouse); block != nil {
		t.Fatal("a terms row with no credit_limit blocked — absent means unlimited")
	}
}

// THE RULE IS `debt < limit`, ON CURRENT DEBT. At exactly the limit the next order is refused; below
// it, allowed. Exposure reaching limit-plus-one-order is what the rule permits, not a bug.
func TestCheckCredit_BlocksAtTheLimitNotBeforeIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	putTerms(t, svc, warehouse, selling, 0, 0, rupiah(50_000_000))

	oweThem(t, svc, db, 49_999_999, 1)

	if block := checkCredit(t, svc, selling, warehouse); block != nil {
		t.Fatal("blocked one rupiah below the limit — the rule is debt < limit")
	}

	oweThem(t, svc, db, 1, 2)

	block := checkCredit(t, svc, selling, warehouse)
	if block == nil {
		t.Fatal("allowed AT the limit — the rule is debt < limit, so equality blocks")
	}

	if block.Debt != 50_000_000 || block.Limit != 50_000_000 {
		t.Fatalf("block reported debt %d of limit %d, want 50000000 / 50000000",
			block.Debt, block.Limit)
	}
}

// ⚠ A LIMIT OF ZERO IS NO CREDIT AT ALL — it blocks the very first order, before any debt exists.
// This is the case the whole absent-vs-zero distinction was built for: somebody freezing a team.
func TestCheckCredit_ZeroLimitBlocksImmediately(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	putTerms(t, svc, warehouse, selling, 0, 0, rupiah(0))

	block := checkCredit(t, svc, selling, warehouse)
	if block == nil {
		t.Fatal("a limit of 0 allowed an order — that team is supposed to be frozen")
	}

	if block.Debt != 0 {
		t.Fatalf("debt = %d, want 0 — frozen with nothing owed is still frozen", block.Debt)
	}
}

// THE DEBT IS READ FROM THE DEBTOR'S SIDE AND FLIPPED. Being OWED money is not debt — a team with a
// receivable must not be treated as having borrowed it.
func TestCheckCredit_BeingOwedIsNotDebt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	putTerms(t, svc, selling, warehouse, 0, 0, rupiah(1))

	// The warehouse is owed 15.000 by the selling team, so from the WAREHOUSE's side this is a
	// receivable — it has borrowed nothing from the selling team.
	oweThem(t, svc, db, 15000, 1)

	if block := checkCredit(t, svc, warehouse, selling); block != nil {
		t.Fatalf("a receivable of %d counted as debt against a limit of 1", block.Debt)
	}
}

// THE DEFAULT ROW APPLIES TO A TEAM WITH NO OVERRIDE — that is the whole point of having one.
func TestCheckCredit_FallsBackToTheDefaultRow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	putTerms(t, svc, warehouse, 0, 0, 0, rupiah(10_000))
	oweThem(t, svc, db, 10_000, 1)

	if checkCredit(t, svc, selling, warehouse) == nil {
		t.Fatal("the creditor's default limit was ignored for a team with no override")
	}
}

// AN OVERRIDE WINS WHETHER IT TIGHTENS OR LOOSENS. A specific row with NO limit lifts the default's
// cap for that one debtor — "override" means override, not "override only if stricter".
func TestCheckCredit_OverrideWithoutALimitLiftsTheDefault(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	putTerms(t, svc, warehouse, 0, 0, 0, rupiah(10_000))
	putTerms(t, svc, warehouse, selling, 0, 0, nil)

	oweThem(t, svc, db, 99_000_000, 1)

	if block := checkCredit(t, svc, selling, warehouse); block != nil {
		t.Fatalf("blocked at %d despite an unlimited override on this pair", block.Limit)
	}
}

// EVERY CREDITOR IS CHECKED INDEPENDENTLY, and the blocker is NAMED. An order draws on the fulfilling
// warehouse and on each team whose goods it sells — any one of them over its limit stops the order,
// and a block nobody can attribute is a block nobody can clear.
func TestCheckCredit_NamesWhichCreditorBlocked(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	// The warehouse is generous; the product's owner has frozen this team.
	putTerms(t, svc, warehouse, selling, 0, 0, rupiah(99_000_000))
	putTerms(t, svc, productOwner, selling, 0, 0, rupiah(0))

	block := checkCredit(t, svc, selling, warehouse, productOwner)
	if block == nil {
		t.Fatal("no block, but one of the two creditors allows no credit at all")
	}

	if block.CreditorTeamID != productOwner {
		t.Fatalf("blocked by %d, want %d (the frozen pair)", block.CreditorTeamID, productOwner)
	}
}

// A TEAM NEVER LIMITS ITSELF. A warehouse fulfilling its own order, or a team selling its own goods,
// owes nobody — and a self-referential terms row cannot exist anyway (the DB refuses it).
func TestCheckCredit_IgnoresYourselfAndUnresolvedOwners(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	// 0 is "the owner could not be resolved" on an order line — nobody to owe, so nobody to check.
	if block := checkCredit(t, svc, selling, selling, 0); block != nil {
		t.Fatalf("blocked by %d checking only yourself and an unresolved owner",
			block.CreditorTeamID)
	}
}
