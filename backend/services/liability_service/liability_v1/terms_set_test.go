package liability_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// setTerms is the call under test, wrapped so each case reads as the thing it is asserting rather
// than as request plumbing. `limit` is a POINTER on purpose — nil is the "unlimited" case, and a
// helper taking an int64 could not express it.
func putTerms(
	t *testing.T,
	svc *liability_v1.Service,
	teamID, counterpartyID uint64,
	handlingFee, markupBP int64,
	limit *int64,
) *liabilityv1.LiabilityTerms {
	t.Helper()

	res, err := svc.LiabilityTermsSet(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityTermsSetRequest{
			TeamId:          teamID,
			CounterpartyId:  counterpartyID,
			HandlingFee:     handlingFee,
			ProductMarkupBp: markupBP,
			CreditLimit:     limit,
		}))
	if err != nil {
		t.Fatalf("LiabilityTermsSet(%d -> %d): %v", teamID, counterpartyID, err)
	}

	return res.Msg.GetTerms()
}

func rupiah(v int64) *int64 { return &v }

// THE RATE EXISTS ONLY IF SOMEBODY CAN WRITE IT. `termsFor` has read this table since #186, but
// until this RPC there was no way to put a row in it — so every handling fee and every markup in the
// system was silently 0. This is the test that the write path is real.
func TestTermsSet_WritesARateTheFeesCanRead(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	got := putTerms(t, svc, warehouse, selling, 12000, 2000, rupiah(50_000_000))

	if got.GetHandlingFee() != 12000 {
		t.Fatalf("handling_fee = %d, want 12000", got.GetHandlingFee())
	}

	if got.GetProductMarkupBp() != 2000 {
		t.Fatalf("product_markup_bp = %d, want 2000 (20%%)", got.GetProductMarkupBp())
	}

	if got.GetCreditLimit() != 50_000_000 {
		t.Fatalf("credit_limit = %d, want 50000000", got.GetCreditLimit())
	}
}

// ⚠ THE TRAP THIS WHOLE FIELD EXISTS TO AVOID. An ABSENT limit is UNLIMITED credit; a limit of 0 is
// NO credit at all. They are opposites, so the handler must not read the value through
// `GetCreditLimit()`, which flattens both to 0 — doing that would grant infinite credit to the team
// somebody just froze.
func TestTermsSet_AbsentLimitIsUnlimitedAndZeroIsNoCredit(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	unlimited := putTerms(t, svc, warehouse, selling, 0, 0, nil)
	if unlimited.CreditLimit != nil {
		t.Fatalf("an omitted limit stored %d, want ABSENT (unlimited)", unlimited.GetCreditLimit())
	}

	frozen := putTerms(t, svc, warehouse, selling, 0, 0, rupiah(0))
	if frozen.CreditLimit == nil {
		t.Fatal("a limit of 0 stored as ABSENT — that grants unlimited credit to a frozen team")
	}

	if frozen.GetCreditLimit() != 0 {
		t.Fatalf("credit_limit = %d, want 0 (no credit at all)", frozen.GetCreditLimit())
	}
}

// SETTING TWICE EDITS, IT DOES NOT FAIL. "Set the rate" is one act whether or not a row exists — a
// create that failed on the second edit would make the screen's Save button work only once.
func TestTermsSet_IsAnUpsert(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	putTerms(t, svc, warehouse, selling, 12000, 2000, rupiah(50_000_000))
	got := putTerms(t, svc, warehouse, selling, 15000, 2500, rupiah(80_000_000))

	if got.GetHandlingFee() != 15000 || got.GetProductMarkupBp() != 2500 {
		t.Fatalf("after re-set: fee = %d, markup = %d — want 15000 / 2500",
			got.GetHandlingFee(), got.GetProductMarkupBp())
	}

	var rows int64

	err := db.Table("liability_terms").
		Where("team_id = ? AND counterparty_id = ?", warehouse, selling).
		Count(&rows).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if rows != 1 {
		t.Fatalf("%d rows for one pair, want 1 — the upsert inserted instead of updating", rows)
	}
}

// LIFTING A LIMIT MUST BE POSSIBLE WITHOUT DELETING THE FEES. Re-setting with the limit omitted
// clears it back to unlimited; COALESCE-ing to the stored value would make a limit permanent once set.
func TestTermsSet_OmittingTheLimitClearsIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	putTerms(t, svc, warehouse, selling, 12000, 2000, rupiah(50_000_000))
	got := putTerms(t, svc, warehouse, selling, 12000, 2000, nil)

	if got.CreditLimit != nil {
		t.Fatalf("limit = %d after omitting it, want ABSENT — a limit cannot be lifted",
			got.GetCreditLimit())
	}

	if got.GetHandlingFee() != 12000 {
		t.Fatalf("handling_fee = %d, want 12000 — clearing the limit must not clear the fees",
			got.GetHandlingFee())
	}
}

// COUNTERPARTY 0 IS THE DEFAULT ROW, not a missing value — the rate applying to every team without
// one of their own. It is the entire override mechanism, so it must be writable.
func TestTermsSet_CounterpartyZeroWritesTheDefaultRow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	got := putTerms(t, svc, warehouse, 0, 9000, 1000, nil)

	if got.GetCounterpartyId() != 0 {
		t.Fatalf("counterparty_id = %d, want 0 (the default row)", got.GetCounterpartyId())
	}

	if got.GetHandlingFee() != 9000 {
		t.Fatalf("default handling_fee = %d, want 9000", got.GetHandlingFee())
	}
}

// A TEAM CANNOT SET TERMS AGAINST ITSELF. The DB has the same CHECK, but a constraint violation
// reaches the caller as an internal error — a mistake worth naming is named.
func TestTermsSet_RefusesTermsAgainstYourself(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	_, err := svc.LiabilityTermsSet(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityTermsSetRequest{
			TeamId:         warehouse,
			CounterpartyId: warehouse,
		}))
	if err == nil {
		t.Fatal("setting terms against yourself succeeded, want InvalidArgument")
	}

	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

// TERMS ARE PER CREDITOR. The warehouse's rate toward the selling team is not the selling team's rate
// toward the warehouse — reading the pair backwards must find nothing, or a debtor would be able to
// discover (and a bug could apply) somebody else's configuration.
func TestTermsSet_IsDirectional(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	putTerms(t, svc, warehouse, selling, 12000, 2000, nil)

	var reverse int64

	err := db.Table("liability_terms").
		Where("team_id = ? AND counterparty_id = ?", selling, warehouse).
		Count(&reverse).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if reverse != 0 {
		t.Fatalf("%d rows on the reverse pair, want 0 — terms are the creditor's own", reverse)
	}
}
