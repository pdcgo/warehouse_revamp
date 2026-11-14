package supplier_v1_test

import (
	"context"
	"strconv"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// THE LINK (supplier_channel_products) and THE LINE'S SUPPLIER: every accepted line naming a supplier links its own
// product under its store, or under the supplier with no store (restock-accepted-links-the-product-to-its-channel,
// every-accepted-line-links-its-own-product, a-line-with-no-store-links-under-the-supplier), and its figures credit the
// line's own supplier (the-supplier-comes-from-the-restock-until-lines-name-a-store — its switch).

const (
	lkMelati = uint64(41) // a supplier with stores
	lkBudi   = uint64(42) // a market stall — no store
	lkShopee = uint64(901)
	lkTokped = uint64(902)
)

// sline is one restock line as inventory sends it now: its own supplier and store (0 = not named) and its counts.
type sline struct {
	supplier, channel uint64
	line
}

// lineAccept builds the RestockAccepted inventory's builder sends for lines naming their own supplier — the restock's
// supplier is the one EVERY line names, 0 when they disagree or one names none (commonLineSupplier) — accepted at `at`.
func lineAccept(restockID, team uint64, at time.Time, lines ...sline) *eventsv1.Event {
	wire := make([]*eventsv1.RestockAcceptedLine, 0, len(lines))

	var common uint64

	for i, l := range lines {
		wire = append(wire, &eventsv1.RestockAcceptedLine{
			ProductId: l.product, OrderedCount: l.ordered, TotalPrice: float64(l.total),
			AcceptedCount: l.accepted, BrokenCount: l.broken, MissingCount: l.lost,
			SupplierId: l.supplier, SupplierChannelId: l.channel,
		})

		switch {
		case i == 0:
			common = l.supplier
		case common != l.supplier:
			common = 0
		}
	}

	ref := strconv.FormatUint(restockID, 10)

	return &eventsv1.Event{
		EventId:     "restock-accepted:" + ref,
		OccurredAt:  timestamppb.New(at),
		AggregateId: "restock:" + ref,
		Message: &eventsv1.Event_RestockAccepted{RestockAccepted: &eventsv1.RestockAccepted{
			RestockId: restockID, TeamId: team, WarehouseId: 5, SupplierId: common,
			AcceptedOn: at.In(lkJakarta).Format("2006-01-02"), Lines: wire, AcceptedAtUnix: at.Unix(),
		}},
	}
}

var lkJakarta = time.FixedZone("WIB", 7*60*60)

// at is noon WIB on a day of October 2026.
func at(day int) time.Time {
	return time.Date(2026, 10, day, 12, 0, 0, 0, lkJakarta)
}

// link is one stored link as a test reads it — channel 0 = no store.
type link struct {
	team, supplier, channel, product uint64
	first, last                      time.Time
	restock                          uint64
}

// links reads every stored link, in key order.
func links(t *testing.T, db *gorm.DB) []link {
	t.Helper()

	var rows []supplier_service_models.SupplierChannelProduct

	err := db.Order("supplier_id, channel_id NULLS FIRST, product_id, team_id").Find(&rows).Error
	if err != nil {
		t.Fatalf("read links: %v", err)
	}

	out := make([]link, 0, len(rows))

	for _, r := range rows {
		var channel uint64
		if r.ChannelID != nil {
			channel = *r.ChannelID
		}

		out = append(out, link{
			team: r.TeamID, supplier: r.SupplierID, channel: channel, product: r.ProductID,
			first: r.FirstRestockedAt, last: r.LastRestockedAt, restock: r.LastRestockID,
		})
	}

	return out
}

func requireLinks(t *testing.T, got []link, want ...link) {
	t.Helper()

	if len(got) != len(want) {
		t.Fatalf("%d links %+v, want %d %+v", len(got), got, len(want), want)
	}

	for i := range want {
		g, w := got[i], want[i]
		if g.team != w.team || g.supplier != w.supplier || g.channel != w.channel || g.product != w.product ||
			!g.first.Equal(w.first) || !g.last.Equal(w.last) || g.restock != w.restock {
			t.Fatalf("link %d = %+v, want %+v", i, g, w)
		}
	}
}

// linkVersions is the ctid of every link — any UPDATE moves it (the test is one transaction, so `updated_at` cannot
// tell).
func linkVersions(t *testing.T, db *gorm.DB) map[uint64]string {
	t.Helper()

	rows := []struct {
		ID   uint64
		Ctid string
	}{}

	err := db.Raw(`SELECT id, ctid::text AS ctid FROM supplier_channel_products`).Scan(&rows).Error
	if err != nil {
		t.Fatalf("link versions: %v", err)
	}

	out := map[uint64]string{}
	for _, r := range rows {
		out[r.ID] = r.Ctid
	}

	return out
}

func sameLinkVersions(a, b map[uint64]string) bool {
	if len(a) != len(b) {
		return false
	}

	for k, v := range a {
		if b[k] != v {
			return false
		}
	}

	return true
}

// AN ACCEPT LINKS EVERY LINE NAMING A SUPPLIER — its own product, under the store it names, or under the supplier with
// no store; a line whose units ALL broke links too; a line naming no supplier links nothing. Each link remembers this
// accept as its first and last.
func TestFold_AnAcceptLinksEveryLineNamingASupplier(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	fold(t, svc, lineAccept(7, sellingA, at(3),
		sline{supplier: lkMelati, channel: lkShopee, line: line{product: 100, ordered: 5, total: 50_000, accepted: 5}},
		sline{supplier: lkMelati, channel: lkShopee, line: line{product: 100, ordered: 1, total: 10_000, accepted: 1}},
		sline{supplier: lkMelati, channel: lkTokped, line: line{product: 100, ordered: 2, total: 20_000, accepted: 2}},
		sline{supplier: lkBudi, line: line{product: 200, ordered: 3, total: 9_000, broken: 3}},
		sline{line: line{product: 300, ordered: 4, total: 4_000, accepted: 4}},
	))

	requireLinks(t, links(t, db),
		link{team: sellingA, supplier: lkMelati, channel: lkShopee, product: 100, first: at(3), last: at(3), restock: 7},
		link{team: sellingA, supplier: lkMelati, channel: lkTokped, product: 100, first: at(3), last: at(3), restock: 7},
		link{team: sellingA, supplier: lkBudi, product: 200, first: at(3), last: at(3), restock: 7},
	)
}

// TWO TEAMS BUYING ONE ITEM FROM ONE STORE ARE TWO LINKS, each naming its own team's product
// (every-accepted-line-links-its-own-product).
func TestFold_TwoTeamsAtOneStoreAreTwoLinks(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	fold(t, svc, lineAccept(7, sellingA, at(3),
		sline{supplier: lkMelati, channel: lkShopee, line: line{product: 100, ordered: 1, total: 1_000, accepted: 1}}))
	fold(t, svc, lineAccept(8, sellingB, at(4),
		sline{supplier: lkMelati, channel: lkShopee, line: line{product: 900, ordered: 1, total: 1_000, accepted: 1}}))

	requireLinks(t, links(t, db),
		link{team: sellingA, supplier: lkMelati, channel: lkShopee, product: 100, first: at(3), last: at(3), restock: 7},
		link{team: sellingB, supplier: lkMelati, channel: lkShopee, product: 900, first: at(4), last: at(4), restock: 8},
	)
}

// A MIXED RESTOCK CREDITS EACH LINE'S OWN SUPPLIER. Before the switch the restock named no supplier as a whole (its lines
// disagree), and the fold credited NOBODY; now Melati gets its line, Budi its broken line, and the line naming no
// supplier credits none.
func TestFold_AMixedRestockCreditsEachLinesSupplier(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	event := lineAccept(7, sellingA, at(3),
		sline{supplier: lkMelati, channel: lkShopee, line: line{product: 100, ordered: 10, total: 30_000, accepted: 7, lost: 1, broken: 2}},
		sline{supplier: lkBudi, line: line{product: 200, ordered: 3, total: 9_000, broken: 3}},
		sline{line: line{product: 300, ordered: 4, total: 4_000, accepted: 4}},
	)

	if event.GetRestockAccepted().GetSupplierId() != 0 {
		t.Fatal("the restock as a whole should name no supplier — its lines disagree")
	}

	fold(t, svc, event)

	if got, want := figureRow(t, db, "2026-10-03", lkMelati, 100, sellingA), columns(7, 21_000, 1, 3_000, 2, 6_000); got != want {
		t.Fatalf("Melati's product 100 = %+v, want %+v", got, want)
	}

	if got, want := figureRow(t, db, "2026-10-03", lkBudi, 200, sellingA), columns(0, 0, 0, 0, 3, 9_000); got != want {
		t.Fatalf("Budi's product 200 = %+v, want %+v", got, want)
	}

	if n := countRows(t, db, &supplier_service_models.SupplierProductDailyReport{}); n != 2 {
		t.Fatalf("%d figure rows, want 2 — the line naming no supplier credits none", n)
	}
}

// A LINE NAMING NO SUPPLIER LINKS AND CREDITS NOTHING — a restock whose every line names none is not even claimed: it
// will never be anything else.
func TestFold_LinesNamingNoSupplierFoldNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	fold(t, svc, lineAccept(7, sellingA, at(3), sline{line: line{product: 300, ordered: 4, total: 4_000, accepted: 4}}))

	for name, model := range map[string]any{
		"figure": &supplier_service_models.SupplierProductDailyReport{},
		"link":   &supplier_service_models.SupplierChannelProduct{},
		"claim":  &supplier_service_models.SupplierEventLog{},
	} {
		if n := countRows(t, db, model); n != 0 {
			t.Fatalf("%d %s rows, want none", n, name)
		}
	}
}

// A LINK REMEMBERS ITS LAST RESTOCK (a-link-remembers-its-last-restock): a later accept moves `last` and its restock; an
// OLDER accept arriving late only lowers `first` — it never lowers `last`.
func TestFold_ALinkRemembersItsFirstAndLastAccept(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	melati := func(restockID uint64, day int) *eventsv1.Event {
		return lineAccept(restockID, sellingA, at(day),
			sline{supplier: lkMelati, channel: lkShopee, line: line{product: 100, ordered: 1, total: 1_000, accepted: 1}})
	}

	fold(t, svc, melati(10, 5))
	fold(t, svc, melati(11, 9))
	fold(t, svc, melati(9, 2)) // older, delivered late

	requireLinks(t, links(t, db),
		link{team: sellingA, supplier: lkMelati, channel: lkShopee, product: 100, first: at(2), last: at(9), restock: 11},
	)
}

// A REDELIVERED ACCEPT WRITES NO LINK — the claim gates the link as it gates the figures, so the row is not even
// rewritten (its ctid stays).
func TestFold_ARedeliveredAcceptWritesNoLink(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	event := lineAccept(7, sellingA, at(3),
		sline{supplier: lkMelati, channel: lkShopee, line: line{product: 100, ordered: 1, total: 1_000, accepted: 1}},
		sline{supplier: lkBudi, line: line{product: 200, ordered: 1, total: 1_000, accepted: 1}})

	fold(t, svc, event)

	before := linkVersions(t, db)

	fold(t, svc, event)

	if !sameLinkVersions(before, linkVersions(t, db)) {
		t.Fatal("the redelivery rewrote a link")
	}

	if n := countRows(t, db, &supplier_service_models.SupplierChannelProduct{}); n != 2 {
		t.Fatalf("%d links, want 2", n)
	}

	if got, want := figureRow(t, db, "2026-10-03", lkMelati, 100, sellingA), columns(1, 1_000, 0, 0, 0, 0); got != want {
		t.Fatalf("figures = %+v, want %+v — folded twice", got, want)
	}
}

// A RECEIVED-COUNT CORRECTION MOVES ITS LINE'S SUPPLIER'S FIGURES AND LINKS NOTHING — only an accept links.
func TestFold_ACorrectionCreditsItsLinesSupplierAndLinksNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	fold(t, svc, &eventsv1.Event{
		EventId:    "restock-count-corrected:55",
		OccurredAt: timestamppb.New(at(6)),
		Message: &eventsv1.Event_RestockReceivedCountCorrected{RestockReceivedCountCorrected: &eventsv1.RestockReceivedCountCorrected{
			RestockId: 7, TeamId: sellingA, CorrectedOn: "2026-10-06", TransactionId: 55,
			Lines: []*eventsv1.RestockAcceptedLine{
				{ProductId: 100, OrderedCount: 10, TotalPrice: 30_000, AcceptedCount: -2, MissingCount: 2, SupplierId: lkMelati, SupplierChannelId: lkShopee},
				{ProductId: 300, OrderedCount: 4, TotalPrice: 4_000, AcceptedCount: -1, MissingCount: 1},
			},
		}},
	})

	if got, want := figureRow(t, db, "2026-10-06", lkMelati, 100, sellingA), columns(-2, -6_000, 2, 6_000, 0, 0); got != want {
		t.Fatalf("Melati's correction = %+v, want %+v", got, want)
	}

	if n := countRows(t, db, &supplier_service_models.SupplierProductDailyReport{}); n != 1 {
		t.Fatalf("%d figure rows, want 1 — the line naming no supplier credits none", n)
	}

	if n := countRows(t, db, &supplier_service_models.SupplierChannelProduct{}); n != 0 {
		t.Fatalf("%d links, want none — a correction links nothing", n)
	}
}

// THE BACKFILL REBUILDS THE LINKS AND IS REPEATABLE: two accepts naming one link merge into ONE row (earliest first,
// latest last); a link the live fold already wrote with a later accept keeps it; a dry run writes nothing yet counts
// exactly what the real run then does; a second run inserts and moves nothing. A mixed accept is reported as switched.
func TestLinkBackfill_RebuildsTheLinksAndIsRepeatable(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	// The live fold already linked Melati·Shopee·100 at the 9th.
	fold(t, svc, lineAccept(30, sellingA, at(9),
		sline{supplier: lkMelati, channel: lkShopee, line: line{product: 100, ordered: 1, total: 1_000, accepted: 1}}))

	past := eventsOf(
		lineAccept(10, sellingA, at(2),
			sline{supplier: lkMelati, channel: lkShopee, line: line{product: 100, ordered: 1, total: 1_000, accepted: 1}}),
		lineAccept(11, sellingA, at(4),
			sline{supplier: lkMelati, channel: lkShopee, line: line{product: 100, ordered: 1, total: 1_000, accepted: 1}},
			sline{supplier: lkBudi, line: line{product: 200, ordered: 2, total: 2_000, broken: 2}},
			sline{line: line{product: 300, ordered: 1, total: 1_000, accepted: 1}}),
		lineAccept(12, sellingB, at(5),
			sline{supplier: lkMelati, channel: lkTokped, line: line{product: 900, ordered: 1, total: 1_000, accepted: 1}}),
		lineAccept(30, sellingA, at(9),
			sline{supplier: lkMelati, channel: lkShopee, line: line{product: 100, ordered: 1, total: 1_000, accepted: 1}}),
	)

	dry, err := svc.LinkBackfill(ctx, past, true)
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}

	if n := countRows(t, db, &supplier_service_models.SupplierChannelProduct{}); n != 1 {
		t.Fatalf("the dry run wrote: %d links, want only the live one", n)
	}

	done, err := svc.LinkBackfill(ctx, past, false)
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}

	if dry.Accepts != 4 || dry.Lines != 5 || dry.Links != 3 || dry.Inserted != 2 || dry.Moved != 1 || dry.Unchanged != 0 || !dry.DryRun {
		t.Fatalf("dry run = %+v, want 4 accepts · 5 lines · 3 links: 2 new, 1 moved (its first accept), 0 unchanged", dry)
	}

	if done.Inserted != dry.Inserted || done.Moved != dry.Moved || done.Unchanged != dry.Unchanged || done.DryRun {
		t.Fatalf("real run = %+v — the dry run said %+v", done, dry)
	}

	if len(done.Switched) != 1 || done.Switched[0].RestockID != 11 || done.Switched[0].Day != "2026-10-04" ||
		len(done.Switched[0].Suppliers) != 2 || done.Switched[0].Suppliers[0] != lkMelati || done.Switched[0].Suppliers[1] != lkBudi {
		t.Fatalf("switched = %+v, want restock 11 on the 4th, Melati and Budi", done.Switched)
	}

	requireLinks(t, links(t, db),
		link{team: sellingA, supplier: lkMelati, channel: lkShopee, product: 100, first: at(2), last: at(9), restock: 30},
		link{team: sellingB, supplier: lkMelati, channel: lkTokped, product: 900, first: at(5), last: at(5), restock: 12},
		link{team: sellingA, supplier: lkBudi, product: 200, first: at(4), last: at(4), restock: 11},
	)

	versions := linkVersions(t, db)

	again, err := svc.LinkBackfill(ctx, past, false)
	if err != nil {
		t.Fatalf("second backfill: %v", err)
	}

	if again.Inserted != 0 || again.Moved != 0 || again.Unchanged != 3 || !sameLinkVersions(versions, linkVersions(t, db)) {
		t.Fatalf("second run = %+v and rewrote links — want 3 unchanged, nothing written", again)
	}

	// The backfill never claims an event or folds a figure — those are the fold's and the re-fold's.
	if n := countRows(t, db, &supplier_service_models.SupplierEventLog{}); n != 1 {
		t.Fatalf("%d claims, want only the live fold's", n)
	}
}

// A LOST MIXED ACCEPT IS RE-FOLDED PER SUPPLIER: Melati's re-fold claims it, counts Melati's line only, links every
// line, and names Budi's day as short; Budi's re-fold then counts Budi's line from that claim.
func TestDayRefold_Restock_ALostMixedAcceptCountsEachSuppliersLines(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	lost := lineAccept(40, sellingA, at(10),
		sline{supplier: lkMelati, channel: lkShopee, line: line{product: 100, ordered: 10, total: 30_000, accepted: 9, broken: 1}},
		sline{supplier: lkBudi, line: line{product: 200, ordered: 2, total: 8_000, accepted: 2}},
		sline{line: line{product: 300, ordered: 1, total: 1_000, accepted: 1}},
	)
	log := refoldLog{accepts: map[string][]*eventsv1.Event{rfDay: {lost}}}

	melati := supplierRefold(t, svc, supplier_v1.ReportRestockDaily, lkMelati, rfDay, false, log)

	if melati.Counted != 1 || melati.Claimed != 1 || len(melati.Rows) != 1 {
		t.Fatalf("Melati's re-fold = %+v, want the accept claimed and counted, one row", melati)
	}

	if len(melati.Short) != 1 || melati.Short[0] != (supplier_v1.ShortScope{SupplierID: lkBudi, Day: rfDay}) {
		t.Fatalf("short = %+v, want Budi's day", melati.Short)
	}

	if got, want := figureRow(t, db, rfDay, lkMelati, 100, sellingA), columns(9, 27_000, 0, 0, 1, 3_000); got != want {
		t.Fatalf("Melati's product 100 = %+v, want %+v", got, want)
	}

	if got := figureRow(t, db, rfDay, lkBudi, 200, sellingA); got != columns(0, 0, 0, 0, 0, 0) {
		t.Fatalf("Budi's row moved in Melati's re-fold: %+v", got)
	}

	requireLinks(t, links(t, db),
		link{team: sellingA, supplier: lkMelati, channel: lkShopee, product: 100, first: at(10), last: at(10), restock: 40},
		link{team: sellingA, supplier: lkBudi, product: 200, first: at(10), last: at(10), restock: 40},
	)

	budi := supplierRefold(t, svc, supplier_v1.ReportRestockDaily, lkBudi, rfDay, false, log)

	if budi.Counted != 1 || budi.Claimed != 0 || len(budi.Short) != 0 {
		t.Fatalf("Budi's re-fold = %+v, want the claim counted, nothing claimed or short", budi)
	}

	if got, want := figureRow(t, db, rfDay, lkBudi, 200, sellingA), columns(2, 8_000, 0, 0, 0, 0); got != want {
		t.Fatalf("Budi's product 200 = %+v, want %+v", got, want)
	}

	fold(t, svc, lost) // the late redelivery — claimed already

	if got, want := figureRow(t, db, rfDay, lkMelati, 100, sellingA), columns(9, 27_000, 0, 0, 1, 3_000); got != want {
		t.Fatalf("after the redelivery Melati's product 100 = %+v — counted twice", got)
	}
}
