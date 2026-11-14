package main

import (
	"context"
	"reflect"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
)

// DISCOVER'S KUNCI THROUGH THE REAL WIRING (discover-filters-by-lock, a-minimum-closes-only-under-it): ProductDiscover
// asks inventory's own batches through the composition root's productStockNarrower, for the minimum products of EVERY
// team in one ask. The catalogue is newNarrowerFixture's (product_stock_narrower_test.go):
//
//	product              team     lock              ready (every warehouse)   Kunci
//	Kaos Terbuka         Melati   open              50                        Terbuka
//	Kaos Min Kurang      Melati   min 20            19 (+100 of Sinar's)      Terkunci — 19 < 20; Sinar's units are not Melati's
//	Celana Min Pas       Melati   min 20            20                        Terbuka — AT its minimum
//	Celana Min Lebih     Melati   min 20            21                        Terbuka
//	Celana Min Kosong    Melati   min 5             0                         Terkunci — nothing is under any minimum
//	Kaos Selalu          Melati   locked, min 3     0                         Terkunci — its owner locked it
//	Kaos Arsip           Melati   min 7, archived   0                         — not on Discover
//	Kaos Sinar           Sinar    min 2             0                         Terkunci — the second team, in the same ask
func (f narrowerFixture) discover(t *testing.T, lock productv1.ProductLockFilter, includeLocked bool) ([]uint64, uint64) {
	t.Helper()

	res, err := f.svc.ProductDiscover(context.Background(), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId:        nfSinar,
		Filter:        &productv1.ProductListFilter{Lock: lock},
		OwnerTeamIds:  []uint64{nfMelati, nfSinar},
		IncludeLocked: includeLocked,
		Page:          &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductDiscover(%v): %v", lock, err)
	}

	ids := slices.Clone(res.Msg.GetIds())
	slices.Sort(ids)

	return ids, res.Msg.GetPageInfo().GetTotalItems()
}

func TestProductDiscover_KunciOverRealStock(t *testing.T) {
	f := newNarrowerFixture(t)
	closed := productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_CLOSED
	orderable := productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_ORDERABLE

	cases := []struct {
		name          string
		lock          productv1.ProductLockFilter
		includeLocked bool
		want          []uint64
	}{
		{"the page — every product", productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_UNSPECIFIED, true,
			nfIDs(f.open, f.under, f.at, f.over, f.empty, f.always, f.sinars)},
		{"Terkunci — locked by its owner, or under its minimum, of both teams", closed, true,
			nfIDs(f.under, f.empty, f.always, f.sinars)},
		{"Terbuka — exactly at the minimum is open", orderable, true, nfIDs(f.open, f.at, f.over)},
		{"Terkunci for a picker — the locked one stays out", closed, false, nfIDs(f.under, f.empty, f.sinars)},
		{"Terbuka for a picker", orderable, false, nfIDs(f.open, f.at, f.over)},
	}

	for _, c := range cases {
		ids, total := f.discover(t, c.lock, c.includeLocked)
		if !reflect.DeepEqual(ids, c.want) || total != uint64(len(c.want)) {
			t.Fatalf("%s: %v (total %d), want %v", c.name, ids, total, c.want)
		}
	}

	// One unit more for Kaos Min Kurang, in the other warehouse: 20 across both — at its minimum, so open now.
	tx := nfTransaction(t, f.db)
	nfBatch(t, f.db, tx, nfGudang2, nfMelati, f.under, 1, time.Now())

	ids, _ := f.discover(t, orderable, true)
	if !slices.Contains(ids, f.under) {
		t.Fatalf("Terbuka after a 20th unit: %v — 20 of a minimum of 20 is open", ids)
	}
}
