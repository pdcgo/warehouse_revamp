package settlement_v1_test

import (
	"context"
	"errors"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// The two teams in every test below: a selling team that owes, and a warehouse that is owed.
const (
	selling   uint64 = 2
	warehouse uint64 = 900
)

func post(
	t *testing.T,
	svc *settlement_v1.Service,
	db *gorm.DB,
	p settlement_v1.Posting,
) (uint64, error) {
	t.Helper()

	return svc.PostEntry(context.Background(), db, p)
}

func codFee(amount int64, sourceID uint64) settlement_v1.Posting {
	return settlement_v1.Posting{
		DebtorTeamID:   selling,
		CreditorTeamID: warehouse,
		Amount:         amount,
		SourceType:     settlement_v1.SourceTypeCODFee,
		SourceID:       sourceID,
	}
}

func balanceOf(t *testing.T, db *gorm.DB, teamID, counterpartyID uint64) int64 {
	t.Helper()

	var row settlement_service_models.SettlementBalance

	err := db.
		Where("team_id = ? AND counterparty_id = ?", teamID, counterpartyID).
		Take(&row).
		Error
	if err != nil {
		t.Fatalf("read balance (%d -> %d): %v", teamID, counterpartyID, err)
	}

	return row.Balance
}

// BOTH LEGS, ONE TRANSACTION, EXACT NEGATIVES. If posting could write one side, the books would be
// silently wrong the first time anybody forgot the other.
func TestPostEntry_WritesBothLegs(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	groupID, err := post(t, svc, db, codFee(15000, 77))
	if err != nil {
		t.Fatalf("PostEntry: %v", err)
	}

	var entries []settlement_service_models.SettlementEntry

	err = db.Where("group_id = ?", groupID).Order("id").Find(&entries).Error
	if err != nil {
		t.Fatalf("read entries: %v", err)
	}

	if len(entries) != 2 {
		t.Fatalf("%d entries in group %d, want 2 — a movement has two sides", len(entries), groupID)
	}

	if entries[0].Amount+entries[1].Amount != 0 {
		t.Fatalf("legs sum to %d, want 0 — they must be exact negatives",
			entries[0].Amount+entries[1].Amount)
	}

	// The CREDITOR is owed: positive. The debtor's side is the mirror.
	if balanceOf(t, db, warehouse, selling) != 15000 {
		t.Fatalf("warehouse balance = %d, want +15000 (a receivable is positive)",
			balanceOf(t, db, warehouse, selling))
	}

	if balanceOf(t, db, selling, warehouse) != -15000 {
		t.Fatalf("selling balance = %d, want -15000 (a payable is negative)",
			balanceOf(t, db, selling, warehouse))
	}
}

// IDEMPOTENCY, and the reason it is load-bearing: order fees arrive on Pub/Sub, which delivers at
// least once. A redelivered movement must be a normal answer the consumer can ACK.
func TestPostEntry_RefusesTheSameMovementTwice(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	_, err := post(t, svc, db, codFee(15000, 77))
	if err != nil {
		t.Fatalf("first posting: %v", err)
	}

	_, err = post(t, svc, db, codFee(15000, 77))
	if !errors.Is(err, settlement_v1.ErrAlreadyPosted) {
		t.Fatalf("second posting returned %v, want ErrAlreadyPosted", err)
	}
}

// A REVERSAL IS NOT A DUPLICATE. It shares source type, source id and counterparty with the entry it
// undoes — so `reversal` has to be in the idempotency key, or the compensating entry is silently
// swallowed and the fee is never returned.
func TestPostEntry_AReversalIsNotADuplicate(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	_, err := post(t, svc, db, codFee(15000, 77))
	if err != nil {
		t.Fatalf("fee: %v", err)
	}

	reversal := codFee(15000, 77)
	reversal.Reversal = true

	_, err = post(t, svc, db, reversal)
	if err != nil {
		t.Fatalf("reversal: %v", err)
	}

	// The balance nets to zero…
	if got := balanceOf(t, db, warehouse, selling); got != 0 {
		t.Fatalf("balance after reversal = %d, want 0", got)
	}

	// …and the history still shows both. "The fee briefly existed" is what an audit needs to see.
	var entries int64

	err = db.
		Model(&settlement_service_models.SettlementEntry{}).
		Where("team_id = ? AND counterparty_id = ?", warehouse, selling).
		Count(&entries).
		Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if entries != 2 {
		t.Fatalf("%d entries, want 2 — a reversal must not delete what it reverses", entries)
	}

	// And a DOUBLE cancel does not reverse twice.
	_, err = post(t, svc, db, reversal)
	if !errors.Is(err, settlement_v1.ErrAlreadyPosted) {
		t.Fatalf("second reversal returned %v, want ErrAlreadyPosted", err)
	}
}

// ONE ORDER POSTS SEVERAL ENTRIES — a handling fee to the warehouse plus a product fee per owning
// team — so the key includes the counterparty. Keyed on source_id alone, the second would vanish.
func TestPostEntry_OneSourceCanOweSeveralCounterparties(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	const owner uint64 = 5

	_, err := post(t, svc, db, settlement_v1.Posting{
		DebtorTeamID: selling, CreditorTeamID: warehouse, Amount: 12000,
		SourceType: settlement_v1.SourceTypeHandlingFee, SourceID: 412,
	})
	if err != nil {
		t.Fatalf("handling fee: %v", err)
	}

	_, err = post(t, svc, db, settlement_v1.Posting{
		DebtorTeamID: selling, CreditorTeamID: owner, Amount: 72000,
		SourceType: settlement_v1.SourceTypeProductFee, SourceID: 412,
	})
	if err != nil {
		t.Fatalf("product fee on the same order: %v", err)
	}

	if got := balanceOf(t, db, selling, warehouse); got != -12000 {
		t.Fatalf("owed to the warehouse = %d, want -12000", got)
	}

	if got := balanceOf(t, db, selling, owner); got != -72000 {
		t.Fatalf("owed to the product owner = %d, want -72000", got)
	}
}

// THE BALANCE IS A PROJECTION (§4.8). If it cannot be recomputed from the entries alone, the ledger
// cannot be audited — so this recomputes it the way an auditor would.
func TestPostEntry_TheBalanceIsRecomputableFromTheEntries(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	for i, amount := range []int64{15000, 4000, 9000} {
		_, err := post(t, svc, db, codFee(amount, uint64(100+i)))
		if err != nil {
			t.Fatalf("posting %d: %v", i, err)
		}
	}

	var summed int64

	err := db.
		Model(&settlement_service_models.SettlementEntry{}).
		Where("team_id = ? AND counterparty_id = ?", warehouse, selling).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&summed).
		Error
	if err != nil {
		t.Fatalf("sum entries: %v", err)
	}

	if stored := balanceOf(t, db, warehouse, selling); stored != summed {
		t.Fatalf("stored balance %d != sum of entries %d — the projection has drifted",
			stored, summed)
	}
}

// AGEING. The clock starts as the balance leaves zero, survives further debt, and is cleared only
// when the pair is square — which is what makes "oldest unsettled 47 days" mean anything.
func TestPostEntry_TheAgeingClockStartsAndStops(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	_, err := post(t, svc, db, codFee(15000, 77))
	if err != nil {
		t.Fatalf("first fee: %v", err)
	}

	first := readBalance(t, db, warehouse, selling)
	if first.OldestUnsettledAt == nil {
		t.Fatal("no ageing clock after the first debt — the position screen has nothing to show")
	}

	// More debt must NOT restart the clock: the oldest unsettled is still the oldest.
	_, err = post(t, svc, db, codFee(4000, 78))
	if err != nil {
		t.Fatalf("second fee: %v", err)
	}

	second := readBalance(t, db, warehouse, selling)
	if second.OldestUnsettledAt == nil || !second.OldestUnsettledAt.Equal(*first.OldestUnsettledAt) {
		t.Fatalf("the clock moved on a second debt (%v -> %v)",
			first.OldestUnsettledAt, second.OldestUnsettledAt)
	}

	// Settling in full stops it.
	_, err = post(t, svc, db, settlement_v1.Posting{
		DebtorTeamID: warehouse, CreditorTeamID: selling, Amount: 19000,
		SourceType: settlement_v1.SourceTypePayment, SourceID: 1,
	})
	if err != nil {
		t.Fatalf("payment: %v", err)
	}

	settled := readBalance(t, db, warehouse, selling)
	if settled.Balance != 0 {
		t.Fatalf("balance = %d after settling in full, want 0", settled.Balance)
	}

	if settled.OldestUnsettledAt != nil {
		t.Fatalf("the ageing clock survived a full settlement (%v)", settled.OldestUnsettledAt)
	}
}

// readBalance returns a FRESH struct every time, and that is not fussiness.
//
// GORM scans into whatever it is given, and a NULL column leaves the destination field UNTOUCHED —
// so reusing one struct across reads makes a cleared `oldest_unsettled_at` look like one that was
// never cleared. The first version of this test did exactly that and reported a bug in the SQL that
// was not there.
func readBalance(
	t *testing.T,
	db *gorm.DB,
	teamID, counterpartyID uint64,
) settlement_service_models.SettlementBalance {
	t.Helper()

	var row settlement_service_models.SettlementBalance

	err := db.
		Where("team_id = ? AND counterparty_id = ?", teamID, counterpartyID).
		Take(&row).
		Error
	if err != nil {
		t.Fatalf("read balance (%d -> %d): %v", teamID, counterpartyID, err)
	}

	return row
}

// PostEntry is POLICY-FREE but not credulous. Each of these would corrupt the ledger quietly rather
// than loudly, which is why they are refused at the door.
func TestPostEntry_RefusesPostingsThatCannotMeanAnything(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	cases := []struct {
		name string
		p    settlement_v1.Posting
	}{
		{"a team owing itself", settlement_v1.Posting{
			DebtorTeamID: selling, CreditorTeamID: selling, Amount: 100,
			SourceType: settlement_v1.SourceTypeCODFee, SourceID: 1,
		}},
		// A zero would change nothing while consuming the pair's idempotency key for that source, so
		// the real fee would later be swallowed as a duplicate.
		{"a zero amount", settlement_v1.Posting{
			DebtorTeamID: selling, CreditorTeamID: warehouse, Amount: 0,
			SourceType: settlement_v1.SourceTypeCODFee, SourceID: 1,
		}},
		{"a negative amount", settlement_v1.Posting{
			DebtorTeamID: selling, CreditorTeamID: warehouse, Amount: -100,
			SourceType: settlement_v1.SourceTypeCODFee, SourceID: 1,
		}},
		{"no stated cause", settlement_v1.Posting{
			DebtorTeamID: selling, CreditorTeamID: warehouse, Amount: 100, SourceID: 1,
		}},
		{"only one side", settlement_v1.Posting{
			DebtorTeamID: selling, Amount: 100,
			SourceType: settlement_v1.SourceTypeCODFee, SourceID: 1,
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := post(t, svc, db, tc.p)
			if err == nil {
				t.Fatalf("accepted %s", tc.name)
			}
		})
	}
}

// A POSTING JOINS THE CALLER'S TRANSACTION — the whole reason PostEntry takes a `tx`. The COD
// obligation is written in the same transaction as the restock acceptance (#184), so a rollback must
// take the ledger entry with it. If it did not, a failed acceptance would leave a debt nobody owes.
func TestPostEntry_RollsBackWithItsCallersTransaction(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	sentinel := errors.New("the caller's work failed")

	err := db.Transaction(func(tx *gorm.DB) error {
		_, postErr := svc.PostEntry(context.Background(), tx, codFee(15000, 77))
		if postErr != nil {
			return postErr
		}

		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("transaction returned %v, want the sentinel", err)
	}

	var entries int64

	err = db.Model(&settlement_service_models.SettlementEntry{}).Count(&entries).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if entries != 0 {
		t.Fatalf("%d entries survived a rolled-back transaction", entries)
	}
}
