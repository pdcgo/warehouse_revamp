package liability_v1_test

import (
	"context"
	"testing"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"gorm.io/gorm"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// A team the creditors also lend to — the one whose limits the asking team must never see.
const thirdTeam uint64 = 77

// creditOf asks the read as `debtor` about `creditors` and returns the CREDIT item per creditor.
func creditOf(
	t *testing.T,
	svc *liability_v1.Service,
	debtor uint64,
	creditors ...uint64,
) map[uint64]*liabilityv1.LiabilityCredit {
	t.Helper()

	res, err := svc.LiabilityCreditByIds(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityCreditByIdsRequest{
			TeamId: debtor,
			Filter: &liabilityv1.LiabilityCreditByIdsFilter{Ids: creditors},
		}))
	if err != nil {
		t.Fatalf("LiabilityCreditByIds(%d): %v", debtor, err)
	}

	out := map[uint64]*liabilityv1.LiabilityCredit{}

	for id, list := range res.Msg.GetItems() {
		for _, item := range list.GetItems() {
			if credit := item.GetCredit().GetMapData()[id]; credit != nil {
				out[id] = credit
			}
		}
	}

	return out
}

// debtTo makes `debtor` owe `creditor` through the ledger, as the credit check's own tests do — the read must agree
// with the books, not with a fixture.
func debtTo(t *testing.T, svc *liability_v1.Service, db *gorm.DB, debtor, creditor uint64, amount int64, sourceID uint64) {
	t.Helper()

	_, err := svc.PostEntry(context.Background(), db, liability_v1.Posting{
		DebtorTeamID:   debtor,
		CreditorTeamID: creditor,
		Amount:         amount,
		SourceType:     liability_v1.SourceTypeIncidentalFee,
		SourceID:       sourceID,
	})
	if err != nil {
		t.Fatalf("post %d -> %d: %v", debtor, creditor, err)
	}
}

func limitOf(t *testing.T, c *liabilityv1.LiabilityCredit) int64 {
	t.Helper()

	if c.CreditLimit == nil {
		t.Fatalf("creditor %d: no limit, want one", c.GetCreditorTeamId())
	}

	return c.GetCreditLimit()
}

// THE PAIR ROW WINS OVER THE DEFAULT — whether it tightens or loosens, which is what an override means.
func TestCreditByIds_ThePairRowWinsOverTheDefault(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	putTerms(t, svc, warehouse, 0, 0, rupiah(10_000_000))
	putTerms(t, svc, warehouse, selling, 0, rupiah(2_000_000))

	got := creditOf(t, svc, selling, warehouse)[warehouse]
	if limit := limitOf(t, got); limit != 2_000_000 {
		t.Fatalf("limit = %d, want 2000000 — the pair row, not the default", limit)
	}

	// A pair row with NO limit lifts the default for this debtor, exactly as the check reads it.
	putTerms(t, svc, warehouse, selling, 0, nil)

	if got := creditOf(t, svc, selling, warehouse)[warehouse]; got.CreditLimit != nil {
		t.Fatalf("limit = %d, want unlimited — an unlimited pair row overrides the default", got.GetCreditLimit())
	}
}

// THE DEFAULT ROW APPLIES TO A TEAM WITH NO ROW OF ITS OWN.
func TestCreditByIds_TheDefaultRowAppliesWithoutAPairRow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	putTerms(t, svc, warehouse, 0, 0, rupiah(5_000_000))

	got := creditOf(t, svc, selling, warehouse)[warehouse]
	if limit := limitOf(t, got); limit != 5_000_000 {
		t.Fatalf("limit = %d, want the default's 5000000", limit)
	}
}

// NO ROWS AT ALL IS UNLIMITED (the-threshold-defaults-to-unlimited) — and still an ITEM, because an absent creditor
// could not be told from an unlimited one.
func TestCreditByIds_NoRowsIsUnlimited(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	debtTo(t, svc, db, selling, warehouse, 99_000_000, 1)

	got, ok := creditOf(t, svc, selling, warehouse)[warehouse]
	if !ok {
		t.Fatal("no item for a creditor with no terms — absence cannot be told from unlimited")
	}

	if got.CreditLimit != nil {
		t.Fatalf("limit = %d, want unlimited", got.GetCreditLimit())
	}

	if got.GetDebt() != 99_000_000 {
		t.Fatalf("debt = %d, want 99000000 — the debt is shown under no limit too", got.GetDebt())
	}

	if got.GetState() != liabilityv1.LiabilityCreditState_LIABILITY_CREDIT_STATE_OK {
		t.Fatalf("state = %s, want OK — 80%% of unlimited is not a number", got.GetState())
	}
}

// THE THREE STATES, at their edges: OK one rupiah under 80%, NEAR from 80%, AT_LIMIT at the limit — and AT_LIMIT
// exactly when the order create's check refuses, never a rupiah apart.
func TestCreditByIds_TheStateAtEachEdge(t *testing.T) {
	cases := []struct {
		name string
		debt int64
		want liabilityv1.LiabilityCreditState
	}{
		{"below 80%", 799_999, liabilityv1.LiabilityCreditState_LIABILITY_CREDIT_STATE_OK},
		{"at 80%", 800_000, liabilityv1.LiabilityCreditState_LIABILITY_CREDIT_STATE_NEAR},
		{"one under the limit", 999_999, liabilityv1.LiabilityCreditState_LIABILITY_CREDIT_STATE_NEAR},
		{"at the limit", 1_000_000, liabilityv1.LiabilityCreditState_LIABILITY_CREDIT_STATE_AT_LIMIT},
		{"past the limit", 1_200_000, liabilityv1.LiabilityCreditState_LIABILITY_CREDIT_STATE_AT_LIMIT},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			db := san_testdb.DB(t)
			svc := liability_v1.NewService(db, nil, nil, nil)

			putTerms(t, svc, warehouse, selling, 0, rupiah(1_000_000))
			debtTo(t, svc, db, selling, warehouse, c.debt, 1)

			got := creditOf(t, svc, selling, warehouse)[warehouse]
			if got.GetState() != c.want {
				t.Fatalf("debt %d of 1000000: state = %s, want %s", c.debt, got.GetState(), c.want)
			}

			if got.GetDebt() != c.debt {
				t.Fatalf("debt = %d, want %d", got.GetDebt(), c.debt)
			}

			atLimit := got.GetState() == liabilityv1.LiabilityCreditState_LIABILITY_CREDIT_STATE_AT_LIMIT
			blocked := checkCredit(t, svc, selling, warehouse) != nil

			if atLimit != blocked {
				t.Fatalf("the read says at-limit=%v and the check says blocked=%v — they must never disagree",
					atLimit, blocked)
			}
		})
	}
}

// A CREDITOR NOT YET OWED ANYTHING is an item with a debt of 0 — and a FROZEN one (limit 0) is at its limit already,
// because the check refuses its very first order.
func TestCreditByIds_ACreditorWithNoDebtYet(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	putTerms(t, svc, warehouse, selling, 0, rupiah(3_000_000))
	putTerms(t, svc, productOwner, selling, 0, rupiah(0))

	got := creditOf(t, svc, selling, warehouse, productOwner)

	if c := got[warehouse]; c.GetDebt() != 0 ||
		c.GetState() != liabilityv1.LiabilityCreditState_LIABILITY_CREDIT_STATE_OK {
		t.Fatalf("no debt yet: debt = %d state = %s, want 0 / OK", c.GetDebt(), c.GetState())
	}

	frozen := got[productOwner]
	if limitOf(t, frozen) != 0 {
		t.Fatalf("limit = %d, want 0 — frozen is a real limit, not unlimited", frozen.GetCreditLimit())
	}

	if frozen.GetState() != liabilityv1.LiabilityCreditState_LIABILITY_CREDIT_STATE_AT_LIMIT {
		t.Fatalf("frozen with nothing owed: state = %s, want AT_LIMIT", frozen.GetState())
	}
}

// BEING OWED IS NOT DEBT — the creditor owing the asking team reads as a debt of 0, as the check reads it.
func TestCreditByIds_BeingOwedIsNotDebt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	putTerms(t, svc, selling, warehouse, 0, rupiah(1))
	// The warehouse is OWED by the selling team, so toward the selling team it has borrowed nothing.
	debtTo(t, svc, db, selling, warehouse, 15_000, 1)

	got := creditOf(t, svc, warehouse, selling)[selling]
	if got.GetDebt() != 0 || got.GetState() != liabilityv1.LiabilityCreditState_LIABILITY_CREDIT_STATE_OK {
		t.Fatalf("a receivable read as debt %d (%s) against a limit of 1", got.GetDebt(), got.GetState())
	}
}

// ⚠ A LIMIT SET ON A THIRD TEAM IS NEVER RETURNED. Asking about a creditor answers only the row that creditor set
// on the ASKING team — its row for somebody else, and that somebody's debt, stay its own business.
func TestCreditByIds_NeverReturnsALimitSetOnAThirdTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	putTerms(t, svc, warehouse, thirdTeam, 0, rupiah(1_234_567))
	debtTo(t, svc, db, thirdTeam, warehouse, 1_000_000, 1)

	got := creditOf(t, svc, selling, warehouse)[warehouse]
	if got.CreditLimit != nil {
		t.Fatalf("limit = %d — the warehouse set no limit on this team; that is the third team's", got.GetCreditLimit())
	}

	if got.GetDebt() != 0 {
		t.Fatalf("debt = %d — this team owes nothing; that is the third team's debt", got.GetDebt())
	}

	// And with a default row, the asking team reads the DEFAULT — still never the third team's own row.
	putTerms(t, svc, warehouse, 0, 0, rupiah(9_000_000))

	if limit := limitOf(t, creditOf(t, svc, selling, warehouse)[warehouse]); limit != 9_000_000 {
		t.Fatalf("limit = %d, want the default's 9000000", limit)
	}
}

// A TEAM IS NEVER ITS OWN CREDITOR — asking about yourself is dropped, exactly as the check drops it.
func TestCreditByIds_DropsTheAskingTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	got := creditOf(t, svc, selling, selling, warehouse)

	if _, ok := got[selling]; ok {
		t.Fatal("the asking team came back as its own creditor")
	}

	if _, ok := got[warehouse]; !ok {
		t.Fatal("the real creditor beside it went missing")
	}
}

// THE NAME IS ASKED ONLY FOR THE GENERAL SLICE — and an unknown team carries its id alone.
func TestCreditByIds_GeneralNamesTheCreditors(t *testing.T) {
	db := san_testdb.DB(t)
	names := &fakeNames{names: map[uint64]string{warehouse: "Gudang Pusat"}}
	svc := liability_v1.NewService(db, nil, nil, names)

	res, err := svc.LiabilityCreditByIds(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityCreditByIdsRequest{
			TeamId: selling,
			Filter: &liabilityv1.LiabilityCreditByIdsFilter{Ids: []uint64{warehouse, productOwner}},
			DataRequest: []liabilityv1.LiabilityCreditByIdsDataType{
				liabilityv1.LiabilityCreditByIdsDataType_LIABILITY_CREDIT_BY_IDS_DATA_TYPE_GENERAL,
			},
		}))
	if err != nil {
		t.Fatalf("LiabilityCreditByIds: %v", err)
	}

	general := func(id uint64) string {
		for _, item := range res.Msg.GetItems()[id].GetItems() {
			if g := item.GetGeneral().GetMapData()[id]; g != nil {
				return g.GetName()
			}

			if item.GetCredit() != nil {
				t.Fatalf("a CREDIT slice came back for a GENERAL-only request")
			}
		}

		t.Fatalf("no GENERAL item for %d", id)

		return ""
	}

	if got := general(warehouse); got != "Gudang Pusat" {
		t.Fatalf("name = %q, want Gudang Pusat", got)
	}

	if got := general(productOwner); got != "" {
		t.Fatalf("name = %q for a team the namer does not know, want empty", got)
	}

	// The CREDIT-only default never asks team_service.
	names.calls = 0
	creditOf(t, svc, selling, warehouse)

	if names.calls != 0 {
		t.Fatalf("team_service asked %d times for a CREDIT-only read", names.calls)
	}
}

// ⚠ THE QUERY COUNT DOES NOT GROW WITH THE CREDITORS: one read of the terms, one of the balances, for one creditor
// or fifty.
func TestCreditByIds_TwoQueriesWhateverTheCreditors(t *testing.T) {
	base := san_testdb.DB(t)
	db, probe := san_perf.Wrap(base)
	svc := liability_v1.NewService(db, nil, nil, nil)

	ids := make([]uint64, 0, 50)
	for i := uint64(0); i < 50; i++ {
		creditor := 1000 + i
		ids = append(ids, creditor)
		putTerms(t, svc, creditor, selling, 0, rupiah(1_000_000))
		debtTo(t, svc, db, selling, creditor, int64(10_000*(i+1)), 100+i)
	}

	probe.Reset()

	got := creditOf(t, svc, selling, ids...)

	if probe.Count() != 2 {
		t.Fatalf("%d queries for 50 creditors, want 2 — something reads per creditor", probe.Count())
	}

	if len(got) != 50 {
		t.Fatalf("%d items, want 50", len(got))
	}
}

// THE CONTRACT BOUNDS THE ASK: 1 to 50 creditors, each a real, distinct team id, and a scope.
func TestCreditByIds_RefusesIdsOutOfBounds(t *testing.T) {
	v, err := protovalidate.New()
	if err != nil {
		t.Fatalf("protovalidate.New: %v", err)
	}

	fiftyOne := make([]uint64, 0, 51)
	for i := uint64(1); i <= 51; i++ {
		fiftyOne = append(fiftyOne, i)
	}

	for name, req := range map[string]*liabilityv1.LiabilityCreditByIdsRequest{
		"no filter":      {TeamId: selling},
		"no ids":         {TeamId: selling, Filter: &liabilityv1.LiabilityCreditByIdsFilter{}},
		"51 ids":         {TeamId: selling, Filter: &liabilityv1.LiabilityCreditByIdsFilter{Ids: fiftyOne}},
		"a zero id":      {TeamId: selling, Filter: &liabilityv1.LiabilityCreditByIdsFilter{Ids: []uint64{0}}},
		"a repeated id":  {TeamId: selling, Filter: &liabilityv1.LiabilityCreditByIdsFilter{Ids: []uint64{900, 900}}},
		"no asking team": {Filter: &liabilityv1.LiabilityCreditByIdsFilter{Ids: []uint64{900}}},
	} {
		if v.Validate(req) == nil {
			t.Fatalf("%s was accepted", name)
		}
	}

	ok := &liabilityv1.LiabilityCreditByIdsRequest{
		TeamId: selling,
		Filter: &liabilityv1.LiabilityCreditByIdsFilter{Ids: fiftyOne[:50]},
	}

	err = v.Validate(ok)
	if err != nil {
		t.Fatalf("50 distinct ids were refused: %v", err)
	}
}

// fakeNames is team_service as the GENERAL slice sees it — a fixed map, counting how often it is asked.
type fakeNames struct {
	names map[uint64]string
	calls int
}

func (f *fakeNames) TeamNames(_ context.Context, ids []uint64) (map[uint64]string, error) {
	f.calls++

	out := map[uint64]string{}

	for _, id := range ids {
		if name, ok := f.names[id]; ok {
			out[id] = name
		}
	}

	return out, nil
}
