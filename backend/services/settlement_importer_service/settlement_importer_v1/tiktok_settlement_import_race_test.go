//go:build raceaudit

// Concurrency audit for TiktokSettlementImport (the audit-sql skill). It shares importStatement,
// runStatement and importLine with ShopeeSettlementImport, so the same claims are raced here over a
// TikTok statement — whose commissioned orders yield TWO lines under two keys — and then both RPCs are
// raced against each other on one importer.
//
//	go test -tags raceaudit -run "TestRace_TiktokSettlementImport|TestRace_SettlementImports" -count=20 -v ./backend/services/settlement_importer_service/settlement_importer_v1/
package settlement_importer_v1_test

import (
	"testing"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	settlement_importer_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_v1"
)

// ⚠ THE BUG THIS PROVES IS ABSENT: eight uploads of one TikTok statement, released together — a fund and
// its affiliate_fee are two keys, and neither may be created twice.
func TestRace_TiktokSettlementImport_SameFileEightTimes(t *testing.T) {
	h := san_race.New(t, raceTables...)

	content, rows, found := raceTiktokStatement(t)
	imp := newRaceImporter(t, h.DB(), found)
	imp.ledger.delay = 2 * time.Millisecond

	const uploads = 8

	res := h.Race(t, uploads, func(i int) error {
		leave := uint32(0)
		if i%2 == 1 {
			leave = 1
		}

		return imp.raceImport(false, tiktokShop, content, rows, leave)
	})
	res.Report(t)

	imp.svc.Wait()

	if res.Failed() != 0 {
		t.Fatalf("%d of %d uploads failed — every one was a legitimate upload", res.Failed(), uploads)
	}

	_, reached := raceCheckImports(t, h.DB(), tiktokShop, "tiktok", uploads, rows)

	if got := len(imp.ledger.posted()); got != reached {
		t.Fatalf("the ledger created %d rows for %d keys across %d uploads — a key was posted twice", got, reached, uploads)
	}
}

// Both import RPCs at once on ONE importer — four Shopee uploads and four TikTok uploads, released
// together. Each platform's records must come out exactly as if it had raced alone: no line of one file
// under another, no tally crossing between the two RPCs' rows.
func TestRace_SettlementImports_ShopeeAndTiktokAtOnce(t *testing.T) {
	h := san_race.New(t, raceTables...)

	shopee, shopeeRows, shopeeFound := raceShopeeStatement(t)
	tiktok, tiktokRows, tiktokFound := raceTiktokStatement(t)

	found := map[string][]settlement_importer_v1.OrderRef{}
	for ref, orders := range shopeeFound {
		found[ref] = orders
	}

	for ref, orders := range tiktokFound {
		found[ref] = orders
	}

	imp := newRaceImporter(t, h.DB(), found)
	imp.ledger.delay = 2 * time.Millisecond
	imp.ledger.refuse[shopeeKey(t, shopee, 5)] = raceRefused

	const each = 4

	res := h.Race(t, 2*each, func(i int) error {
		leave := uint32(0)
		if i%4 == 3 {
			leave = 1
		}

		if i%2 == 0 {
			return imp.raceImport(true, shopeeShop, shopee, shopeeRows, leave)
		}

		return imp.raceImport(false, tiktokShop, tiktok, tiktokRows, leave)
	})
	res.Report(t)

	imp.svc.Wait()

	if res.Failed() != 0 {
		t.Fatalf("%d of %d uploads failed — every one was a legitimate upload", res.Failed(), 2*each)
	}

	_, shopeeReached := raceCheckImports(t, h.DB(), shopeeShop, "shopee", each, shopeeRows)
	_, tiktokReached := raceCheckImports(t, h.DB(), tiktokShop, "tiktok", each, tiktokRows)

	if got := len(imp.ledger.posted()); got != shopeeReached+tiktokReached {
		t.Fatalf("the ledger created %d rows for %d keys — a key was posted twice", got, shopeeReached+tiktokReached)
	}
}
