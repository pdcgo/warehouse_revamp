//go:build raceaudit

// Concurrency audit for THE REPRINT CLEARS THE TAG (backlog #151; products-have-their-own-tag-list, its 🔄 *what clears*).
// product_service's RecordReprint (inventory's ProductReprintRecord) and AddArrivalReprintWaits (a transfer accept) write
// `product_reprint_waits` and `need_reprint_code`'s links beside the team code change (#149). What must hold when people
// act at the same second — each pinned by an INTERLEAVING: one transaction is PARKED at a chosen statement (a GORM
// callback, armed by the context) while the other runs, so the outcome never depends on the scheduler:
//
//   - two warehouses recording the last two waits of one product take the tag off ONCE, no error — the second waits for
//     the first's commit and sees its wait gone; without the lock each sees the other's wait and the tag stays on with
//     no wait left;
//   - a record racing a new team code change never clears a wait for a code that was not printed — the record holds the
//     team's lock from before it reads the live code, so the change re-sets the waits only after it; without the lock
//     the record deletes the change's fresh wait for a code nobody printed;
//   - a record racing a transfer arrival (both orders) never leaves a wait with no tag.
//
// Build-tagged: san_race COMMITS. It empties the product tables (as the product audits do) and removes its own teams
// (codes RCE…) before and after.
//
//	go test -tags raceaudit -p 1 -count=1 -run 'TestRace_ProductReprint' -v ./backend/cmd/app_development/
package main

import (
	"context"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// A PARK holds the transaction whose context carries it right AFTER its first statement containing `at` ran — until
// released.
type reprintParkKey struct{}

type reprintPark struct {
	at      string
	reached chan struct{}
	release chan struct{}
	once    sync.Once
}

func parkedAt(ctx context.Context, at string) (context.Context, *reprintPark) {
	p := &reprintPark{at: at, reached: make(chan struct{}), release: make(chan struct{})}

	return context.WithValue(ctx, reprintParkKey{}, p), p
}

var reprintParkInstalled sync.Once

func installReprintPark(t *testing.T, db *gorm.DB) {
	t.Helper()

	reprintParkInstalled.Do(func() {
		hold := func(tx *gorm.DB) {
			if tx.Statement == nil || tx.Statement.Context == nil {
				return
			}

			p, ok := tx.Statement.Context.Value(reprintParkKey{}).(*reprintPark)
			if !ok || !strings.Contains(tx.Statement.SQL.String(), p.at) {
				return
			}

			p.once.Do(func() {
				close(p.reached)
				<-p.release
			})
		}

		err := db.Callback().Row().After("gorm:row").Register("reprint_race:park_row", hold)
		if err != nil {
			t.Fatal(err)
		}

		err = db.Callback().Raw().After("gorm:raw").Register("reprint_race:park_raw", hold)
		if err != nil {
			t.Fatal(err)
		}
	})
}

type reprintRaceWorld struct {
	raceCodeWorld
	inventory *inventory_v1.Service
	reader    inventory_v1.ProductReader
}

func newReprintRaceWorld(t *testing.T, shelf uint64) reprintRaceWorld {
	t.Helper()

	w := newRaceCodeWorld(t, shelvedEverywhere{warehouse: shelf})
	installReprintPark(t, w.h.DB())

	reader := NewInventoryProductReader(w.products)

	return reprintRaceWorld{
		raceCodeWorld: w,
		inventory:     inventory_v1.NewService(w.h.DB(), nil, nil, nil, nil, reader, nil, nil, nil, nil),
		reader:        reader,
	}
}

// waiting tags the product and makes it wait for the warehouses — as a code change leaves it.
func (w reprintRaceWorld) waiting(t *testing.T, product uint64, warehouses ...uint64) {
	t.Helper()

	for _, wh := range warehouses {
		err := w.h.DB().Exec("INSERT INTO product_reprint_waits (product_id, warehouse_id) VALUES (?, ?)", product, wh).Error
		if err != nil {
			t.Fatal(err)
		}
	}

	err := w.h.DB().Exec(`INSERT INTO product_tag_links (product_id, tag_id, added_by_user_id, added_by_is_override, added_at)
		SELECT ?, id, 0, false, NOW() FROM product_tags WHERE app_task = ?`, product, product_v1.AppTaskReprintCode).Error
	if err != nil {
		t.Fatal(err)
	}
}

func (w reprintRaceWorld) record(ctx context.Context, warehouse, product uint64, code string) (*inventoryv1.ProductReprintRecordResponse, error) {
	res, err := w.inventory.ProductReprintRecord(ctx, connect.NewRequest(&inventoryv1.ProductReprintRecordRequest{
		WarehouseId: warehouse, Items: []*inventoryv1.ProductReprintPrinted{{ProductId: product, ProductCode: code}},
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// arrive is a transfer accept's arrival call, on its own committing transaction.
func (w reprintRaceWorld) arrive(ctx context.Context, warehouse, product uint64) error {
	return w.h.DB().WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return w.reader.ReprintArrivals(ctx, tx, warehouse, []uint64{product})
	})
}

// state is the product's waits and whether it carries the app's tag — read committed.
func (w reprintRaceWorld) state(t *testing.T, product uint64) ([]uint64, bool) {
	t.Helper()

	var waits []uint64

	err := w.h.DB().Raw("SELECT warehouse_id FROM product_reprint_waits WHERE product_id = ? ORDER BY warehouse_id", product).
		Scan(&waits).Error
	if err != nil {
		t.Fatal(err)
	}

	var n int64

	err = w.h.DB().Raw(`SELECT COUNT(*) FROM product_tag_links l JOIN product_tags g ON g.id = l.tag_id
		WHERE l.product_id = ? AND g.app_task = ?`, product, product_v1.AppTaskReprintCode).Scan(&n).Error
	if err != nil {
		t.Fatal(err)
	}

	return waits, n > 0
}

// interleave runs `first` parked at its statement `at`, then `second` while it is parked, and requires `second` to WAIT
// for `first` (it shares the team's lock); then releases. Answers both errors.
func interleave(t *testing.T, at string, first func(ctx context.Context) error, second func(ctx context.Context) error) (error, error) {
	t.Helper()

	ctx, park := parkedAt(context.Background(), at)

	firstDone := make(chan error, 1)
	go func() { firstDone <- first(ctx) }()

	select {
	case <-park.reached:
	case err := <-firstDone:
		t.Fatalf("the first finished (%v) without reaching %q", err, at)
	case <-time.After(20 * time.Second):
		t.Fatalf("the first never reached %q", at)
	}

	secondDone := make(chan error, 1)
	go func() { secondDone <- second(context.Background()) }()

	var secondErr error

	waited := true

	select {
	case secondErr = <-secondDone:
		waited = false
	case <-time.After(500 * time.Millisecond):
	}

	close(park.release)

	firstErr := <-firstDone

	if waited {
		select {
		case secondErr = <-secondDone:
		case <-time.After(20 * time.Second):
			t.Fatalf("the second never finished after the first committed")
		}
	} else {
		t.Errorf("the second finished while the first held the team's lock — it must wait for it")
	}

	return firstErr, secondErr
}

// TWO WAREHOUSES PRINT THE LAST TWO WAITS AT ONCE — the tag comes off ONCE, no error: Pusat's record is parked after its
// tag check (before its commit) while Cabang's runs.
func TestRace_ProductReprint_TwoWarehousesTakeTheTagOffOnce(t *testing.T) {
	const pusat, cabang uint64 = 9_151_001, 9_151_002

	w := newReprintRaceWorld(t, pusat)
	team := w.team(t, "Race Reprint A", "RCE51A")
	oil := w.product(t, team, "RCE51A-MINYAK")
	w.waiting(t, oil, pusat, cabang)

	var first, second *inventoryv1.ProductReprintRecordResponse

	errA, errB := interleave(t, "DELETE FROM product_tag_links",
		func(ctx context.Context) error {
			var err error
			first, err = w.record(ctx, pusat, oil, "RCE51A-MINYAK")

			return err
		},
		func(ctx context.Context) error {
			var err error
			second, err = w.record(ctx, cabang, oil, "RCE51A-MINYAK")

			return err
		})
	if errA != nil || errB != nil {
		t.Fatalf("errors: Pusat %v, Cabang %v — want none", errA, errB)
	}

	waits, tagged := w.state(t, oil)
	if len(waits) != 0 || tagged {
		t.Fatalf("after both prints: waits %v, tagged %v — want no wait and the tag OFF", waits, tagged)
	}

	untagged := len(first.GetUntaggedIds()) + len(second.GetUntaggedIds())
	if untagged != 1 || !slices.Equal(second.GetUntaggedIds(), []uint64{oil}) {
		t.Errorf("tag taken off %d times (Pusat %v, Cabang %v), want once, by the later", untagged, first.GetUntaggedIds(), second.GetUntaggedIds())
	}
}

// A RECORD AGAINST A NEW TEAM CODE CHANGE — the record printed RCE51B-…, read the live code and is parked right after it;
// the change to RCE51C must wait, then re-set the waits for the code nobody printed. The wait and the tag stay.
func TestRace_ProductReprint_ARecordNeverClearsACodeNotPrinted(t *testing.T) {
	const pusat uint64 = 9_151_011

	w := newReprintRaceWorld(t, pusat)
	team := w.team(t, "Race Reprint B", "RCE51B")
	oil := w.product(t, team, "RCE51B-MINYAK")

	err := w.change(team, "RCE51C")
	if err != nil {
		t.Fatalf("setup change: %v", err)
	}

	if waits, tagged := w.state(t, oil); !slices.Equal(waits, []uint64{pusat}) || !tagged {
		t.Fatalf("after the first change: waits %v tagged %v, want Pusat waiting, tagged", waits, tagged)
	}

	errRecord, errChange := interleave(t, `id, product_code FROM "products"`,
		func(ctx context.Context) error {
			_, err := w.record(ctx, pusat, oil, "RCE51C-MINYAK")

			return err
		},
		func(context.Context) error { return w.change(team, "RCE51D") })
	if errRecord != nil || errChange != nil {
		t.Fatalf("errors: record %v, change %v — want none", errRecord, errChange)
	}

	if code := w.codesOfTeam(t, team); !slices.Equal(code, []string{"RCE51D-MINYAK"}) {
		t.Fatalf("codes = %v, want RCE51D-MINYAK", code)
	}

	waits, tagged := w.state(t, oil)
	if !slices.Equal(waits, []uint64{pusat}) || !tagged {
		t.Errorf("after the record and the change: waits %v, tagged %v — want Pusat still waiting for RCE51D, tagged", waits, tagged)
	}
}

// A RECORD AGAINST A TRANSFER ARRIVAL, the arrival first: units of the tagged product arrive at Cabang (parked after its
// insert) while Pusat — the only warehouse waiting — prints. The print waits, then sees Cabang's wait and keeps the tag.
func TestRace_ProductReprint_AnArrivalThenARecordKeepTheTag(t *testing.T) {
	const pusat, cabang uint64 = 9_151_021, 9_151_022

	w := newReprintRaceWorld(t, pusat)
	team := w.team(t, "Race Reprint C", "RCE51E")
	oil := w.product(t, team, "RCE51E-MINYAK")
	w.waiting(t, oil, pusat)

	errArrive, errRecord := interleave(t, "INSERT INTO product_reprint_waits",
		func(ctx context.Context) error { return w.arrive(ctx, cabang, oil) },
		func(ctx context.Context) error {
			_, err := w.record(ctx, pusat, oil, "RCE51E-MINYAK")

			return err
		})
	if errArrive != nil || errRecord != nil {
		t.Fatalf("errors: arrival %v, record %v", errArrive, errRecord)
	}

	waits, tagged := w.state(t, oil)
	if !slices.Equal(waits, []uint64{cabang}) || !tagged {
		t.Errorf("waits %v, tagged %v — want Cabang waiting and the tag ON", waits, tagged)
	}
}

// …and the record first: Pusat's print is parked after its tag check; the arrival at Cabang waits, then finds no warehouse
// waiting (the tag is off) and adds nothing — never a wait with no tag.
func TestRace_ProductReprint_ARecordThenAnArrivalLeaveNoUntaggedWait(t *testing.T) {
	const pusat, cabang uint64 = 9_151_031, 9_151_032

	w := newReprintRaceWorld(t, pusat)
	team := w.team(t, "Race Reprint D", "RCE51F")
	oil := w.product(t, team, "RCE51F-MINYAK")
	w.waiting(t, oil, pusat)

	errRecord, errArrive := interleave(t, "DELETE FROM product_tag_links",
		func(ctx context.Context) error {
			_, err := w.record(ctx, pusat, oil, "RCE51F-MINYAK")

			return err
		},
		func(ctx context.Context) error { return w.arrive(ctx, cabang, oil) })
	if errArrive != nil || errRecord != nil {
		t.Fatalf("errors: record %v, arrival %v", errRecord, errArrive)
	}

	waits, tagged := w.state(t, oil)
	if len(waits) != 0 || tagged {
		t.Errorf("waits %v, tagged %v — want neither (the print was the last; the arrival came after)", waits, tagged)
	}
}

// THE SMOKE — eight rounds of two warehouses printing one product's last two waits at the same instant: never an error,
// and the tag is on exactly while a wait is left.
func TestRace_ProductReprint_SimultaneousPrintsKeepTheTagTrue(t *testing.T) {
	const pusat, cabang uint64 = 9_151_041, 9_151_042

	w := newReprintRaceWorld(t, pusat)
	team := w.team(t, "Race Reprint E", "RCE51G")

	for round := range 8 {
		oil := w.product(t, team, "RCE51G-R"+string(rune('A'+round)))
		w.waiting(t, oil, pusat, cabang)

		start := make(chan struct{})
		errs := make(chan error, 2)

		var wg sync.WaitGroup

		for _, wh := range []uint64{pusat, cabang} {
			wg.Add(1)

			go func(wh uint64) {
				defer wg.Done()
				<-start

				_, err := w.record(context.Background(), wh, oil, "RCE51G-R"+string(rune('A'+round)))
				errs <- err
			}(wh)
		}

		close(start)
		wg.Wait()
		close(errs)

		for err := range errs {
			if err != nil {
				t.Fatalf("round %d: %v", round, err)
			}
		}

		if waits, tagged := w.state(t, oil); len(waits) != 0 || tagged {
			t.Fatalf("round %d: waits %v, tagged %v — want neither", round, waits, tagged)
		}
	}
}
