//go:build raceaudit

// Concurrency audit for the RESTOCK LINK write (supplier_channel_products, 00005) — upsertLinks, run by the
// RestockAccepted fold behind its claim, by the day re-fold for the lost accepts it claims, and by
// `san supplier backfill-links` (the audit-sql skill). audits/services/supplier_service/concurrency/lock-order.md holds
// the matrix.
//
// What could go wrong, and what proves it absent:
//
//  1. Two accepts naming ONE link at once (two restocks of the same product from the same store) — a lost date: the
//     loser's INSERT must wait on the winner's uncommitted row, then keep the EARLIER first and the LATER last.
//
//  2. The same accept delivered twice at once — a link written twice: the claim serialises them; the loser writes none.
//
//  3. Two accepts naming the same links in opposite line orders — a deadlock: linksOf sorts by linkKey, the one order.
//
//  4. A re-fold claiming a lost accept beside a live fold naming the same link — a deadlock between the report's lock
//     and the link's row lock: the re-fold writes links only AFTER the report's lock, in the fold's order.
//
//     go test -tags raceaudit -p 1 -run 'TestRace_Link|TestInterleave_Link' -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"testing"
	"time"

	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// linkUpsert is the start of the link statement — what a waiter is checked against.
const linkUpsert = "INSERT INTO supplier_channel_products"

// daysAgoAt is noon WIB `n` days ago — an accept's instant, older than the re-fold's in-flight hour for n ≥ 1.
func daysAgoAt(n int) time.Time {
	now := time.Now().In(lkJakarta)

	return time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, lkJakarta).AddDate(0, 0, -n)
}

// oneLink is an accept of one unit of product A from Melati's Shopee store — every such accept names the SAME link.
func oneLink(restockID uint64, at time.Time) *eventsv1.Event {
	return lineAccept(restockID, sellingA, at,
		sline{supplier: lkMelati, channel: lkShopee, line: line{product: figProductA, ordered: 1, total: 1_000, accepted: 1}})
}

// 1 · Eight accepts naming ONE link, each on its own day (so no figure row is shared — the link is the only contention),
// folded at once: one row, its first the earliest accept, its last the latest with that restock. Even rounds start
// with no link (eight INSERTs race on the unique key), odd rounds from an existing link dated in the middle.
func TestRace_Link_AcceptsNamingOneLinkKeepTheEarliestAndLatest(t *testing.T) {
	h := figHarness(t)
	svc := figService(h.DB(), nil)
	ctx := context.Background()

	for round := range 20 {
		figReset(t, h.DB())

		if round%2 == 1 {
			fold(t, svc, oneLink(uint64(round*100+99), daysAgoAt(5)))
		}

		events := make([]*eventsv1.Event, 8)
		for i := range events {
			events[i] = oneLink(uint64(round*100+i), daysAgoAt(1+i))
		}

		res := h.Race(t, len(events), func(i int) error {
			return svc.FoldHandler()(ctx, events[i])
		})

		if round < 2 {
			res.Report(t)
		}

		if res.Failed() != 0 {
			res.Report(t)
			t.Fatalf("round %d: %d folds failed", round, res.Failed())
		}

		requireLinks(t, links(t, h.DB()), link{
			team: sellingA, supplier: lkMelati, channel: lkShopee, product: figProductA,
			first: daysAgoAt(8), last: daysAgoAt(1), restock: uint64(round * 100),
		})
	}
}

// The proof behind 1: B's link write WAITS on A's — on A's uncommitted INSERT when the link is new, on A's row lock when
// it exists — and, released, keeps the later of the two. The accepts are on different days, so the wait is the link's.
func TestInterleave_Link_SecondAcceptWaitsOnTheLinkThenKeepsTheLater(t *testing.T) {
	for _, existing := range []bool{false, true} {
		name := "no link yet: B waits on A's insert"
		if existing {
			name = "the link exists: B waits on A's row lock"
		}

		t.Run(name, func(t *testing.T) {
			h := figHarness(t)
			ctx := context.Background()

			if existing {
				fold(t, figService(h.DB(), nil), oneLink(1, daysAgoAt(9)))
			}

			var waits []raceWait

			const stepB = "B folds an older accept naming the same link — waits on A"

			sched := h.Interleave(t,
				san_race.Do("A", "A folds the newer accept (uncommitted)", func(tx *gorm.DB) error {
					return figService(tx, nil).FoldHandler()(ctx, oneLink(10, daysAgoAt(2)))
				}),
				san_race.Block("B", stepB, func(tx *gorm.DB) error {
					return figService(tx, nil).FoldHandler()(ctx, oneLink(11, daysAgoAt(4)))
				}),
				san_race.Do("W", "who waits on whom", func(*gorm.DB) error {
					var err error
					waits, err = raceWaiters(h.DB())

					return err
				}),
				san_race.Commit("A"),
				san_race.Commit("B"),
			)
			sched.Report(t)
			raceLogWaiters(t, waits)

			b := sched.Get(stepB)
			if !b.Blocked || !b.Released || b.Err != nil {
				t.Fatalf("B: blocked=%v released=%v err=%v — want blocked, released, ok", b.Blocked, b.Released, b.Err)
			}

			figRequireWaitOn(t, waits, linkUpsert)

			first := daysAgoAt(4)
			if existing {
				first = daysAgoAt(9)
			}

			requireLinks(t, links(t, h.DB()), link{
				team: sellingA, supplier: lkMelati, channel: lkShopee, product: figProductA,
				first: first, last: daysAgoAt(2), restock: 10,
			})
		})
	}
}

// 2 · One accept naming three links delivered eight times at once: claimed once, each link written once.
func TestRace_Link_SameAcceptEightTimesLinksOnce(t *testing.T) {
	h := figHarness(t)
	svc := figService(h.DB(), nil)
	ctx := context.Background()

	for round := range 20 {
		figReset(t, h.DB())

		event := lineAccept(uint64(500+round), sellingA, daysAgoAt(2),
			sline{supplier: lkMelati, channel: lkShopee, line: line{product: figProductA, ordered: 1, total: 1_000, accepted: 1}},
			sline{supplier: lkMelati, channel: lkTokped, line: line{product: figProductA, ordered: 1, total: 1_000, accepted: 1}},
			sline{supplier: lkBudi, line: line{product: figProductB, ordered: 2, total: 2_000, broken: 2}})

		res := h.Race(t, 8, func(int) error {
			return svc.FoldHandler()(ctx, event)
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() != 0 {
			res.Report(t)
			t.Fatalf("round %d: %d deliveries failed", round, res.Failed())
		}

		if n := countRows(t, h.DB(), &supplier_service_models.SupplierChannelProduct{}); n != 3 {
			t.Fatalf("round %d: %d links, want 3", round, n)
		}

		if n := countRows(t, h.DB(), &supplier_service_models.SupplierEventLog{}); n != 1 {
			t.Fatalf("round %d: %d claims, want 1", round, n)
		}
	}
}

// 3 · Two accepts on different days naming the SAME four links in opposite line orders, folded at once, 30 rounds: no
// deadlock (linksOf sorts every write by linkKey), and every link ends at the later accept.
func TestRace_Link_OppositeLineOrdersNeverDeadlock(t *testing.T) {
	h := figHarness(t)
	svc := figService(h.DB(), nil)
	ctx := context.Background()

	stores := []sline{
		{supplier: lkMelati, channel: lkShopee},
		{supplier: lkMelati, channel: lkTokped},
		{supplier: lkMelati},
		{supplier: lkBudi},
	}

	const rounds = 30

	deadlocks := 0

	for round := range rounds {
		figReset(t, h.DB())

		fwd := make([]sline, 0, len(stores))
		rev := make([]sline, 0, len(stores))

		for i := range stores {
			a, b := stores[i], stores[len(stores)-1-i]
			a.line = line{product: figProductA, ordered: 1, total: 1_000, accepted: 1}
			b.line = line{product: figProductA, ordered: 1, total: 1_000, accepted: 1}
			fwd = append(fwd, a)
			rev = append(rev, b)
		}

		events := []*eventsv1.Event{
			lineAccept(uint64(1000+2*round), sellingA, daysAgoAt(3), fwd...),
			lineAccept(uint64(1001+2*round), sellingA, daysAgoAt(2), rev...),
		}

		res := h.Race(t, 2, func(i int) error {
			return svc.FoldHandler()(ctx, events[i])
		})

		deadlocks += res.Count(san_race.Deadlock)

		for _, o := range res.Outcomes {
			switch o.Kind {
			case san_race.None:
			case san_race.Deadlock:
				fold(t, svc, events[o.I]) // Pub/Sub redelivers the 500
			default:
				t.Fatalf("round %d, fold %d: %v", round, o.I, o.Err)
			}
		}

		for _, l := range links(t, h.DB()) {
			if !l.last.Equal(daysAgoAt(2)) || !l.first.Equal(daysAgoAt(3)) || l.restock != uint64(1001+2*round) {
				t.Fatalf("round %d: link %+v — want first 3 days ago, last 2 days ago by restock %d", round, l, 1001+2*round)
			}
		}
	}

	t.Logf("%d deadlocks in %d rounds of 2 crossed folds", deadlocks, rounds)

	if deadlocks > 0 {
		t.Fatalf("%d deadlocks (40P01) — the link write is not in one lock order", deadlocks)
	}
}

// 4 · A re-fold claiming a LOST accept that names a link, beside a live fold of another accept naming the same link: the
// re-fold waits on the REPORT's lock — never on the link — so it holds no link row a fold could wait on while the fold
// holds the report. Released, both accepts are counted and the link keeps the later accept.
func TestInterleave_Link_ARefoldWaitsOnTheReportBeforeTouchingALink(t *testing.T) {
	h := figHarness(t)
	ctx := context.Background()

	lostAt := daysAgoAt(3)
	day := lostAt.In(lkJakarta).Format("2006-01-02")
	lost := oneLink(20, lostAt)
	live := oneLink(21, lostAt.Add(time.Hour))
	log := refoldLog{accepts: map[string][]*eventsv1.Event{day: {lost}}}

	var waits []raceWait

	const stepR = "R re-folds the day, claiming the lost accept — waits on F"

	sched := h.Interleave(t,
		san_race.Do("F", "F folds a live accept naming the same link (uncommitted)", func(tx *gorm.DB) error {
			return figService(tx, nil).FoldHandler()(ctx, live)
		}),
		san_race.Block("R", stepR, func(tx *gorm.DB) error {
			_, err := figService(tx, nil).DayRefold(ctx, supplier_v1.DayRefoldInput{
				Report: supplier_v1.ReportRestockDaily, SupplierID: lkMelati, Day: day,
			}, log)

			return err
		}),
		san_race.Do("W", "who waits on whom", func(*gorm.DB) error {
			var err error
			waits, err = raceWaiters(h.DB())

			return err
		}),
		san_race.Commit("F"),
		san_race.Commit("R"),
	)
	sched.Report(t)
	raceLogWaiters(t, waits)

	r := sched.Get(stepR)
	if !r.Blocked || !r.Released || r.Err != nil {
		t.Fatalf("R: blocked=%v released=%v err=%v — want blocked, released, ok", r.Blocked, r.Released, r.Err)
	}

	figRequireWaitOn(t, waits, "LOCK TABLE supplier_product_daily_reports")

	requireLinks(t, links(t, h.DB()), link{
		team: sellingA, supplier: lkMelati, channel: lkShopee, product: figProductA,
		first: lostAt, last: lostAt.Add(time.Hour), restock: 21,
	})

	if got, want := figureRow(t, h.DB(), day, lkMelati, figProductA, sellingA), columns(2, 2_000, 0, 0, 0, 0); got != want {
		t.Fatalf("the day = %+v, want both accepts counted once: %+v", got, want)
	}
}
