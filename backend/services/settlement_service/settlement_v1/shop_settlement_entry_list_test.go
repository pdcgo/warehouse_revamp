package settlement_v1_test

import (
	"context"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// SHOP ENTRIES (the-shop-entries-page-is-accepted): the rows addressed to a shop and no order.

// fakeStatements answers StatementSources from a fixed map and records the scope it was asked under.
type fakeStatements struct {
	lines  map[uint64]settlement_v1.StatementLine
	teamID uint64
	asked  []uint64
}

func (f *fakeStatements) StatementLines(_ context.Context, teamID uint64, ids []uint64) (map[uint64]settlement_v1.StatementLine, error) {
	f.teamID = teamID
	f.asked = append(f.asked, ids...)

	out := map[uint64]settlement_v1.StatementLine{}

	for _, id := range ids {
		line, ok := f.lines[id]
		if ok {
			out[id] = line
		}
	}

	return out, nil
}

type fakeNames map[uint64]string

func (f fakeNames) UserNames(_ context.Context, ids []uint64) (map[uint64]string, error) {
	out := map[uint64]string{}

	for _, id := range ids {
		name, ok := f[id]
		if ok {
			out[id] = name
		}
	}

	return out, nil
}

// seedShopRow writes one shop-addressed row directly, on a chosen learned day.
func seedShopRow(t *testing.T, db *gorm.DB, row settlement_service_models.SettlementLog) settlement_service_models.SettlementLog {
	t.Helper()

	if row.TeamID == 0 {
		row.TeamID = team
	}

	if row.ShopID == 0 {
		row.ShopID = shop
	}

	if row.SourceType == "" {
		row.SourceType = "manual"
	}

	if row.SettlementType == "" {
		row.SettlementType = "other"
	}

	if row.OccurredOn.IsZero() {
		row.OccurredOn = row.PostedOn
	}

	if row.UniqueID == "" {
		row.UniqueID = "seed-" + time.Now().Format("150405.000000000")
	}

	err := db.Create(&row).Error
	if err != nil {
		t.Fatalf("seed a shop row: %v", err)
	}

	return row
}

func day(raw string) time.Time {
	d, err := time.Parse("2006-01-02", raw)
	if err != nil {
		panic(err)
	}

	return d
}

func listShopEntries(
	t *testing.T,
	svc *settlement_v1.Service,
	teamID uint64,
	filter *settlementv1.ShopSettlementEntryListFilter,
	page, limit uint32,
) *settlementv1.ShopSettlementEntryListResponse {
	t.Helper()

	res, err := svc.ShopSettlementEntryList(context.Background(), connect.NewRequest(&settlementv1.ShopSettlementEntryListRequest{
		TeamId: teamID,
		Filter: filter,
		Page:   &commonv1.CommonPagination{Page: page, Limit: limit},
	}))
	if err != nil {
		t.Fatalf("ShopSettlementEntryList: %v", err)
	}

	return res.Msg
}

func entriesOf(res *settlementv1.ShopSettlementEntryListResponse) map[uint64]*settlementv1.ShopSettlementEntry {
	for _, item := range res.GetItems() {
		return item.GetEntry().GetMapData()
	}

	return nil
}

// A shop's own rows only: never an order's, never another team's — and newest learned first.
func TestShopSettlementEntryList_ListsOnlyTheTeamsShopRowsNewestFirst(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	older := seedShopRow(t, db, settlement_service_models.SettlementLog{UniqueID: "a", Change: -5_000, PostedOn: day("2026-11-01")})
	newer := seedShopRow(t, db, settlement_service_models.SettlementLog{UniqueID: "b", Change: 7_000, PostedOn: day("2026-11-03")})
	sameDay := seedShopRow(t, db, settlement_service_models.SettlementLog{UniqueID: "c", Change: 1_000, PostedOn: day("2026-11-03")})
	// Another team's shop row, and an order's row of this team.
	seedShopRow(t, db, settlement_service_models.SettlementLog{UniqueID: "x", TeamID: team + 1, ShopID: shop + 1, Change: 9_999, PostedOn: day("2026-11-03")})

	orderID := order
	seedShopRow(t, db, settlement_service_models.SettlementLog{UniqueID: "o", OrderID: &orderID, Change: 50_000, PostedOn: day("2026-11-03")})

	res := listShopEntries(t, svc, team, &settlementv1.ShopSettlementEntryListFilter{}, 1, 20)

	want := []uint64{sameDay.ID, newer.ID, older.ID}
	if len(res.GetIds()) != len(want) {
		t.Fatalf("ids = %v, want %v", res.GetIds(), want)
	}

	for i := range want {
		if res.GetIds()[i] != want[i] {
			t.Fatalf("ids = %v, want %v (newest learned, then id, first)", res.GetIds(), want)
		}
	}

	if res.GetPageInfo().GetTotalItems() != 3 {
		t.Errorf("total = %d, want 3", res.GetPageInfo().GetTotalItems())
	}

	// ANOTHER TEAM SEES NOTHING of this team's.
	other := listShopEntries(t, svc, team+5, &settlementv1.ShopSettlementEntryListFilter{}, 1, 20)
	if len(other.GetIds()) != 0 || other.GetPageInfo().GetTotalItems() != 0 || other.GetTotalReceived() != 0 {
		t.Errorf("another team read %v (total %d, received %v), want nothing", other.GetIds(), other.GetPageInfo().GetTotalItems(), other.GetTotalReceived())
	}

	// The root team reads every team's, as the report's reads do.
	root := listShopEntries(t, svc, san_auth.RootTeamID, &settlementv1.ShopSettlementEntryListFilter{}, 1, 20)
	if root.GetPageInfo().GetTotalItems() != 4 {
		t.Errorf("root total = %d, want 4 (both teams' shop rows, no order row)", root.GetPageInfo().GetTotalItems())
	}
}

// The totals are the WHOLE filtered set — Received leaves the withdrawals out, Withdrawn is their opposite — and the
// filters narrow BEFORE the page is cut.
func TestShopSettlementEntryList_FiltersBeforePagingAndTotalsTheWholeSet(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	for i, row := range []settlement_service_models.SettlementLog{
		{SettlementType: "withdrawal", Change: -200_000, PostedOn: day("2026-11-02")},
		{SettlementType: "withdrawal", Change: -1_500_000, PostedOn: day("2026-11-03")},
		{SettlementType: "fund", Change: 185_000, PostedOn: day("2026-11-03")},
		{SettlementType: "other", Change: -1_234.5, PostedOn: day("2026-11-04")},
		{SettlementType: "fund", Change: 64_000, PostedOn: day("2026-11-05")},
		// Another shop of the team.
		{SettlementType: "fund", Change: 999, ShopID: shop + 1, PostedOn: day("2026-11-05")},
	} {
		row.UniqueID = "row-" + string(rune('a'+i))
		seedShopRow(t, db, row)
	}

	shopOnly := &settlementv1.ShopSettlementEntryListFilter{ShopId: shop}

	first := listShopEntries(t, svc, team, shopOnly, 1, 2)
	if len(first.GetIds()) != 2 || first.GetPageInfo().GetTotalItems() != 5 || first.GetPageInfo().GetTotalPage() != 3 {
		t.Fatalf("page 1 = %d ids, total %d, pages %d — want 2, 5, 3", len(first.GetIds()), first.GetPageInfo().GetTotalItems(), first.GetPageInfo().GetTotalPage())
	}

	// Received = 185.000 − 1.234,5 + 64.000; Withdrawn = 1.700.000 — over the five, not the page's two.
	if !san_money.Equal(first.GetTotalReceived(), 247_765.5) {
		t.Errorf("received = %v, want 247765.5", first.GetTotalReceived())
	}

	if !san_money.Equal(first.GetTotalWithdrawn(), 1_700_000) {
		t.Errorf("withdrawn = %v, want 1700000", first.GetTotalWithdrawn())
	}

	last := listShopEntries(t, svc, team, shopOnly, 3, 2)
	if len(last.GetIds()) != 1 {
		t.Errorf("page 3 = %d ids, want the last 1", len(last.GetIds()))
	}

	// The kind filter: withdrawals alone — Received 0, Withdrawn their sum, 2 entries.
	kinds := listShopEntries(t, svc, team, &settlementv1.ShopSettlementEntryListFilter{
		SettlementTypes: []settlementv1.SettlementType{settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL},
	}, 1, 1)
	if kinds.GetPageInfo().GetTotalItems() != 2 || !san_money.IsZero(kinds.GetTotalReceived()) || !san_money.Equal(kinds.GetTotalWithdrawn(), 1_700_000) {
		t.Errorf("withdrawals: total %d, received %v, withdrawn %v — want 2, 0, 1700000",
			kinds.GetPageInfo().GetTotalItems(), kinds.GetTotalReceived(), kinds.GetTotalWithdrawn())
	}

	// The learned-day window, inclusive at both ends.
	window := listShopEntries(t, svc, team, &settlementv1.ShopSettlementEntryListFilter{
		ShopId:     shop,
		PostedFrom: "2026-11-03",
		PostedTo:   "2026-11-04",
	}, 1, 20)
	if window.GetPageInfo().GetTotalItems() != 3 {
		t.Errorf("3–4 Nov: %d entries, want 3", window.GetPageInfo().GetTotalItems())
	}
}

// THE LEARNED DAY IS JAKARTA'S: a row learned at 23:30 UTC on 6 Nov is 06:30 WIB on 7 Nov, and the day filter finds it
// on the 7th, never the 6th.
func TestShopSettlementEntryList_TheLearnedDayIsAJakartaDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	row := seedShopRow(t, db, settlement_service_models.SettlementLog{UniqueID: "late", Change: 1_000, PostedOn: day("2026-11-01")})

	// posted_on as the column's DEFAULT CURRENT_DATE stamps it — the session's (Jakarta) date of that instant.
	err := db.Exec(
		`UPDATE settlement_logs SET posted_on = (?::timestamptz)::date WHERE id = ?`,
		time.Date(2026, 11, 6, 23, 30, 0, 0, time.UTC), row.ID,
	).Error
	if err != nil {
		t.Fatalf("stamp the late row: %v", err)
	}

	on := func(d string) uint64 {
		return listShopEntries(t, svc, team, &settlementv1.ShopSettlementEntryListFilter{PostedFrom: d, PostedTo: d}, 1, 20).
			GetPageInfo().GetTotalItems()
	}

	if on("2026-11-07") != 1 {
		t.Errorf("7 Nov (Jakarta) lists %d, want the row learned at 06:30 WIB", on("2026-11-07"))
	}

	if on("2026-11-06") != 0 {
		t.Errorf("6 Nov lists %d, want 0 — 23:30 UTC is already the 7th in Jakarta", on("2026-11-06"))
	}

	res := listShopEntries(t, svc, team, &settlementv1.ShopSettlementEntryListFilter{}, 1, 20)
	if got := entriesOf(res)[row.ID].GetEntry().GetPostedOn(); got != "2026-11-07" {
		t.Errorf("posted_on = %q, want 2026-11-07", got)
	}
}

// Each row says what the screen draws beside it: its reversal, its statement and every name.
func TestShopSettlementEntryList_RowsCarryTheirReversalStatementAndNames(t *testing.T) {
	db := san_testdb.DB(t)
	statements := &fakeStatements{lines: map[uint64]settlement_v1.StatementLine{}}
	names := fakeNames{61: "Dewi", 62: "Budi"}
	svc := settlement_v1.NewService(db, nil, nil, primaryIs(shopPrimaryCS), nil, statements, names)

	imported, err := postShop(t, svc, settlement_v1.PostInput{
		UniqueID:       "shopee:Rincian:1",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_IMPORTER,
		Change:         185_000,
		ActorID:        62,
	})
	if err != nil {
		t.Fatalf("import a shop row: %v", err)
	}

	statements.lines[imported.Entry.ID] = settlement_v1.StatementLine{
		UploadedFileID: 905,
		Platform:       marketplacev1.Marketplace_MARKETPLACE_SHOPEE,
		PeriodFrom:     "2026-11-01",
		PeriodTo:       "2026-11-02",
		Sheet:          "Rincian Transaksi",
		OrderRef:       "241101ABCD",
		Reason:         "no_order",
		UploadedBy:     62,
	}

	byHand, err := postShop(t, svc, settlement_v1.PostInput{
		UniqueID:       "manual-1",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_SYSTEM_ADJUSTMENT,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         12_000,
		ActorID:        61,
	})
	if err != nil {
		t.Fatalf("a hand row: %v", err)
	}

	reversal, err := postShop(t, svc, settlement_v1.PostInput{
		UniqueID:       "reverse-" + strconv.FormatUint(byHand.Entry.ID, 10),
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_SYSTEM_ADJUSTMENT,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         -12_000,
		ReversesID:     byHand.Entry.ID,
		ActorID:        61,
	})
	if err != nil {
		t.Fatalf("reverse the hand row: %v", err)
	}

	rows := entriesOf(listShopEntries(t, svc, team, &settlementv1.ShopSettlementEntryListFilter{}, 1, 20))

	got := rows[imported.Entry.ID]
	if got.GetStatement().GetUploadedFileId() != 905 ||
		got.GetStatement().GetReason() != settlementv1.ShopEntryStatementReason_SHOP_ENTRY_STATEMENT_REASON_NO_ORDER ||
		got.GetStatement().GetUploadedByName() != "Budi" ||
		got.GetEntry().GetActorName() != "Budi" {
		t.Errorf("imported row = %v, want file 905, no_order, uploaded by Budi", got)
	}

	if rows[byHand.Entry.ID].GetStatement() != nil {
		t.Errorf("a hand row named a statement: %v", rows[byHand.Entry.ID].GetStatement())
	}

	if rows[byHand.Entry.ID].GetReversedById() != reversal.Entry.ID {
		t.Errorf("reversed_by = %d, want %d", rows[byHand.Entry.ID].GetReversedById(), reversal.Entry.ID)
	}

	if rows[byHand.Entry.ID].GetEntry().GetActorName() != "Dewi" {
		t.Errorf("poster = %q, want Dewi", rows[byHand.Entry.ID].GetEntry().GetActorName())
	}

	if rows[reversal.Entry.ID].GetReversedById() != 0 {
		t.Errorf("the reversal itself reads reversed")
	}

	// Only the imported row was asked about, under the reader's scope.
	if len(statements.asked) != 1 || statements.asked[0] != imported.Entry.ID || statements.teamID != team {
		t.Errorf("asked the importer for %v under team %d, want [%d] under %d", statements.asked, statements.teamID, imported.Entry.ID, team)
	}
}

// The sale and its cancel are never shop rows — a filter naming them is refused, not answered empty.
func TestShopSettlementEntryList_RefusesTheSaleKinds(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	for _, kind := range []settlementv1.SettlementType{
		settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL,
		settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL_CANCEL,
	} {
		_, err := svc.ShopSettlementEntryList(context.Background(), connect.NewRequest(&settlementv1.ShopSettlementEntryListRequest{
			TeamId: team,
			Filter: &settlementv1.ShopSettlementEntryListFilter{SettlementTypes: []settlementv1.SettlementType{kind}},
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
		}))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("%v: got %v, want InvalidArgument", kind, err)
		}
	}
}

// ENTRI TOKO READS THE OVERRIDE STAMP (an-override-shows-a-platform-badge): a hand row Root posted from outside the team
// reads is_override, the CS's does not; an imported row's statement says whether its UPLOAD was an override, as the
// importer answers it — the "by Root team" badge beside the uploader.
func TestShopSettlementEntryList_ReadsTheOverrideStamp(t *testing.T) {
	db := san_testdb.DB(t)
	statements := &fakeStatements{lines: map[uint64]settlement_v1.StatementLine{}}
	svc := settlement_v1.NewService(db, nil, nil, primaryIs(shopPrimaryCS), nil, statements, fakeNames{1: "Fajar", 7: "Ani"})

	byRoot, err := postShop(t, svc, settlement_v1.PostInput{
		UniqueID: "manual-root", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_SYSTEM_ADJUSTMENT,
		SourceType: settlementv1.SourceType_SOURCE_TYPE_MANUAL, Change: 12_000, ActorID: 1, IsOverride: true,
	})
	if err != nil {
		t.Fatalf("Root's row: %v", err)
	}

	byCS, err := postShop(t, svc, settlement_v1.PostInput{
		UniqueID: "manual-cs", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_SYSTEM_ADJUSTMENT,
		SourceType: settlementv1.SourceType_SOURCE_TYPE_MANUAL, Change: 8_000, ActorID: 7,
	})
	if err != nil {
		t.Fatalf("the CS's row: %v", err)
	}

	imported, err := postShop(t, svc, settlement_v1.PostInput{
		UniqueID: "shopee:Rincian:9", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
		SourceType: settlementv1.SourceType_SOURCE_TYPE_IMPORTER, Change: 185_000, ActorID: 1, IsOverride: true,
	})
	if err != nil {
		t.Fatalf("an imported row: %v", err)
	}

	statements.lines[imported.Entry.ID] = settlement_v1.StatementLine{
		UploadedFileID: 905, Platform: marketplacev1.Marketplace_MARKETPLACE_SHOPEE, UploadedBy: 1, UploadedByIsOverride: true,
	}

	rows := entriesOf(listShopEntries(t, svc, team, &settlementv1.ShopSettlementEntryListFilter{}, 1, 20))

	if !rows[byRoot.Entry.ID].GetEntry().GetIsOverride() || rows[byCS.Entry.ID].GetEntry().GetIsOverride() {
		t.Fatalf("is_override: Root's row %v, the CS's %v — want true, false",
			rows[byRoot.Entry.ID].GetEntry().GetIsOverride(), rows[byCS.Entry.ID].GetEntry().GetIsOverride())
	}

	statement := rows[imported.Entry.ID].GetStatement()
	if !statement.GetUploadedByIsOverride() || statement.GetUploadedByName() != "Fajar" {
		t.Fatalf("imported row's statement = %+v, want Fajar's upload read as an override", statement)
	}

	if rows[byCS.Entry.ID].GetStatement() != nil {
		t.Fatalf("a hand row carries a statement: %+v", rows[byCS.Entry.ID].GetStatement())
	}
}
