package settlement_v1_test

import (
	"context"
	"errors"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

func detail(
	t *testing.T,
	svc *settlement_v1.Service,
	teamID, orderID uint64,
) (*settlementv1.OrderSettlementDetailResponse, error) {
	t.Helper()

	res, err := svc.OrderSettlementDetail(
		context.Background(),
		connect.NewRequest(&settlementv1.OrderSettlementDetailRequest{
			TeamId:  teamID,
			OrderId: orderID,
		}),
	)
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// THE PANEL DRAWS A RUNNING BALANCE DOWNWARD, so the log must come back oldest first. Newest first
// would show a running total that appears to count backwards, which reads as corrupted data.
func TestOrderSettlementDetail_ReturnsTheLogOldestFirst(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	_, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("initial_total: %v", err)
	}

	_, err = post(t, svc, settlement_v1.PostInput{
		UniqueID:       "stmt-aug-fund",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_IMPORTER,
		Change:         arrived,
	})
	if err != nil {
		t.Fatalf("fund: %v", err)
	}

	got, err := detail(t, svc, team, order)
	if err != nil {
		t.Fatalf("OrderSettlementDetail: %v", err)
	}

	if len(got.GetEntries()) != 2 {
		t.Fatalf("%d entries, want 2", len(got.GetEntries()))
	}

	first := got.GetEntries()[0]
	if first.GetSettlementType() != settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL {
		t.Errorf("first entry is %v, want the opening sale — the log must read oldest first", first.GetSettlementType())
	}

	// The running balance must climb the way it was built: −120.000 then −10.000.
	if first.GetBalance() != -sale {
		t.Errorf("first balance = %v, want %v", first.GetBalance(), -sale)
	}

	if got.GetEntries()[1].GetBalance() != -sale+arrived {
		t.Errorf("second balance = %v, want %v", got.GetEntries()[1].GetBalance(), -sale+arrived)
	}

	if got.GetSettlement().GetInitialTotal() != sale {
		t.Errorf("initial_total = %v, want the POSITIVE sale %v", got.GetSettlement().GetInitialTotal(), sale)
	}
}

// ⚠ ABSENT IS NOT EMPTY. An order never settled is a different statement from one settled to zero, and
// returning a zeroed row would render as a completed settlement that nobody performed.
func TestOrderSettlementDetail_DistinguishesNeverSettledFromZero(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	_, err := detail(t, svc, team, 999_999)
	if err == nil {
		t.Fatal("an order with no account returned a settlement — that reads as settled to zero")
	}

	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("code = %v, want NotFound", connect.CodeOf(err))
	}
}

// The scope proves the caller's team; this proves the ACCOUNT's. Without it an order id is enough to
// read another team's ledger.
func TestOrderSettlementDetail_RefusesAnotherTeamsAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	_, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("initial_total: %v", err)
	}

	_, err = detail(t, svc, team+1, order)
	if err == nil {
		t.Fatal("another team read this account")
	}

	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("code = %v, want PermissionDenied", connect.CodeOf(err))
	}
}

// THE ORDER'S LEDGER READS THE OVERRIDE STAMP (an-override-shows-a-platform-badge): the row Root posted from outside the
// team reads is_override beside its actor — the "by Root team" badge on the ledger — and the CS's row and the opening
// row the system wrote do not.
func TestOrderSettlementDetail_ReadsTheOverrideStamp(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	_, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("initial_total: %v", err)
	}

	for _, in := range []settlement_v1.PostInput{
		{UniqueID: "root-fund", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
			SourceType: settlementv1.SourceType_SOURCE_TYPE_MANUAL, Change: arrived, ActorID: 1, IsOverride: true},
		{UniqueID: "cs-ads", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_EXTERNAL_ADS_FEE,
			SourceType: settlementv1.SourceType_SOURCE_TYPE_MANUAL, Change: adsFee, ActorID: 7},
	} {
		_, err = post(t, svc, in)
		if err != nil {
			t.Fatalf("%s: %v", in.UniqueID, err)
		}
	}

	got, err := detail(t, svc, team, order)
	if err != nil {
		t.Fatalf("OrderSettlementDetail: %v", err)
	}

	if len(got.GetEntries()) != 3 {
		t.Fatalf("%d entries, want 3", len(got.GetEntries()))
	}

	for _, e := range got.GetEntries() {
		want := e.GetActorId() == 1
		if e.GetIsOverride() != want {
			t.Errorf("entry %s by %d: is_override = %v, want %v", e.GetUniqueId(), e.GetActorId(), e.GetIsOverride(), want)
		}
	}
}

// recordingNames answers like fakeNames and records every call, so a test can prove the log is named with ONE read.
type recordingNames struct {
	names fakeNames
	calls [][]uint64
}

func (r *recordingNames) UserNames(ctx context.Context, ids []uint64) (map[uint64]string, error) {
	r.calls = append(r.calls, slices.Clone(ids))

	return r.names.UserNames(ctx, ids)
}

// failingNames is a user read that is down.
type failingNames struct{}

func (failingNames) UserNames(context.Context, []uint64) (map[uint64]string, error) {
	return nil, errors.New("user read down")
}

// The people on the ledger below: the PIC an imported payout counts for, and the team member who typed the ads fee —
// somebody other than whoever reads the panel, so the badge has to name HIM.
const (
	ledgerPIC   uint64 = 61
	ledgerAdder uint64 = 64
)

// seedNamedLedger writes the tester's ledger: the opening sale the system posted (no actor), an imported payout under
// the PIC, and two rows the adder typed by hand.
func seedNamedLedger(t *testing.T, svc *settlement_v1.Service) {
	t.Helper()

	_, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("initial_total: %v", err)
	}

	for _, in := range []settlement_v1.PostInput{
		{UniqueID: "stmt-fund", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
			SourceType: settlementv1.SourceType_SOURCE_TYPE_IMPORTER, Change: arrived, ActorID: ledgerPIC},
		{UniqueID: "manual-ads", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_EXTERNAL_ADS_FEE,
			SourceType: settlementv1.SourceType_SOURCE_TYPE_MANUAL, Change: adsFee, ActorID: ledgerAdder},
		{UniqueID: "manual-ads-2", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_EXTERNAL_ADS_FEE,
			SourceType: settlementv1.SourceType_SOURCE_TYPE_MANUAL, Change: -1_000, ActorID: ledgerAdder},
	} {
		_, err = post(t, svc, in)
		if err != nil {
			t.Fatalf("%s: %v", in.UniqueID, err)
		}
	}
}

// A MANUAL ROW NAMES WHO TYPED IT (the-source-is-a-badge: *Manual · <who typed it>*): the detail fills `actor_name`
// with the adder's name, as the proto promises, so the badge never reads `Manual · 64`. The whole log is named with
// ONE user read over its distinct actors — never a read per row, and never asking for the system's actor 0.
func TestOrderSettlementDetail_NamesWhoTypedAManualEntry(t *testing.T) {
	db := san_testdb.DB(t)
	names := &recordingNames{names: fakeNames{ledgerPIC: "Dewi", ledgerAdder: "SO Adder"}}
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, names)

	seedNamedLedger(t, svc)

	got, err := detail(t, svc, team, order)
	if err != nil {
		t.Fatalf("OrderSettlementDetail: %v", err)
	}

	manual := 0

	for _, e := range got.GetEntries() {
		if e.GetSourceType() != settlementv1.SourceType_SOURCE_TYPE_MANUAL {
			continue
		}

		manual++

		if e.GetActorId() != ledgerAdder || e.GetActorName() != "SO Adder" {
			t.Errorf("manual entry %s: actor %d named %q, want %d named %q",
				e.GetUniqueId(), e.GetActorId(), e.GetActorName(), ledgerAdder, "SO Adder")
		}
	}

	if manual != 2 {
		t.Fatalf("%d manual entries, want 2", manual)
	}

	if len(names.calls) != 1 {
		t.Fatalf("%d user reads, want ONE for the whole log", len(names.calls))
	}

	asked := slices.Clone(names.calls[0])
	slices.Sort(asked)

	if !slices.Equal(asked, []uint64{ledgerPIC, ledgerAdder}) {
		t.Errorf("asked for %v, want each actor once and never 0: %v", asked, []uint64{ledgerPIC, ledgerAdder})
	}
}

// AN ADDER THE USER READ NO LONGER KNOWS (a user since removed) keeps today's fallback: the row comes back with its
// actor id and an empty name, so the badge reads `Manual · <id>` — never a failed panel, never somebody else's name.
func TestOrderSettlementDetail_AnUnknownAdderKeepsTheIdFallback(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, fakeNames{ledgerPIC: "Dewi"})

	seedNamedLedger(t, svc)

	got, err := detail(t, svc, team, order)
	if err != nil {
		t.Fatalf("OrderSettlementDetail: %v", err)
	}

	for _, e := range got.GetEntries() {
		if e.GetSourceType() != settlementv1.SourceType_SOURCE_TYPE_MANUAL {
			continue
		}

		if e.GetActorId() != ledgerAdder || e.GetActorName() != "" {
			t.Errorf("manual entry %s: actor %d named %q, want %d with no name (the screen shows the id)",
				e.GetUniqueId(), e.GetActorId(), e.GetActorName(), ledgerAdder)
		}
	}
}

// THE OTHER ROWS READ AS BEFORE: naming the actors changes nothing else on any entry, and an Order or Import row is
// named after ITS OWN actor (or not at all for the system's 0) — never the adder's. Their badge draws no name either
// way (SettlementSourceBadge's OnlyManualCarriesAName story).
func TestOrderSettlementDetail_NamingLeavesTheOtherRowsAsTheyWere(t *testing.T) {
	db := san_testdb.DB(t)
	named := settlement_v1.NewService(db, nil, nil, nil, nil, nil, fakeNames{ledgerPIC: "Dewi", ledgerAdder: "SO Adder"})
	unnamed := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	seedNamedLedger(t, named)

	got, err := detail(t, named, team, order)
	if err != nil {
		t.Fatalf("OrderSettlementDetail (named): %v", err)
	}

	before, err := detail(t, unnamed, team, order)
	if err != nil {
		t.Fatalf("OrderSettlementDetail (no user read): %v", err)
	}

	if len(got.GetEntries()) != 4 || len(before.GetEntries()) != 4 {
		t.Fatalf("%d / %d entries, want 4", len(got.GetEntries()), len(before.GetEntries()))
	}

	if !proto.Equal(got.GetSettlement(), before.GetSettlement()) {
		t.Errorf("account = %v, want it untouched by naming: %v", got.GetSettlement(), before.GetSettlement())
	}

	wantName := map[uint64]string{0: "", ledgerPIC: "Dewi", ledgerAdder: "SO Adder"}

	for i, e := range got.GetEntries() {
		if e.GetActorName() != wantName[e.GetActorId()] {
			t.Errorf("entry %s by %d: named %q, want %q", e.GetUniqueId(), e.GetActorId(), e.GetActorName(), wantName[e.GetActorId()])
		}

		if before.GetEntries()[i].GetActorName() != "" {
			t.Errorf("entry %s: named %q with no user read wired", e.GetUniqueId(), before.GetEntries()[i].GetActorName())
		}

		bare := proto.Clone(e).(*settlementv1.SettlementEntry)
		bare.ActorName = ""

		if !proto.Equal(bare, before.GetEntries()[i]) {
			t.Errorf("entry %d = %v, want it unchanged but for its name: %v", i, bare, before.GetEntries()[i])
		}
	}
}

// A USER READ THAT IS DOWN fails the panel as Unavailable, the way ShopSettlementEntryList does — never a ledger
// quietly drawn with every adder's id where names were promised.
func TestOrderSettlementDetail_AFailedNameReadIsUnavailable(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, failingNames{})

	seedNamedLedger(t, svc)

	_, err := detail(t, svc, team, order)
	if connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("err = %v, want Unavailable", err)
	}
}
