//go:build raceaudit

// Concurrency audit for the warehouse link's owner (the-warehouse-link-names-its-owner-team): two writers naming
// DIFFERENT owners for one new (warehouse, product) link. The second's upsert waits on the first's uncommitted insert,
// then does nothing; its read of the stored owners must see the first's committed row — so the first owner is kept and
// the disagreement is reported, never overwritten and never missed.
//
//	go test -tags raceaudit -p 1 -count=1 -run 'TestInterleave_WarehouseProductLink' -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// The tables this audit writes, CHILDREN FIRST.
var raceOwnerTables = []string{
	"restock_logs",
	"restock_items",
	"restocks",
	"warehouse_products",
}

const (
	raceOwnerWarehouse uint64 = 7
	raceOwnerProduct   uint64 = 100
	raceOwnerFirst     uint64 = 77
	raceOwnerSecond    uint64 = 2
)

func TestInterleave_WarehouseProductLink_ASecondOwnerWaitsThenKeepsTheFirst(t *testing.T) {
	h := san_race.New(t, raceOwnerTables...)
	logged := capturedWarnings(t)

	const (
		first  = "A: links product 100 under team 77 — not committed yet"
		second = "B: RestockRequestCreate of team 2 links the same product — waits on A's insert"
	)

	sched := h.Interleave(t,
		san_race.Do("A", first, func(tx *gorm.DB) error {
			return tx.Exec(`INSERT INTO warehouse_products (warehouse_id, product_id, owner_team_id) VALUES (?, ?, ?)`,
				raceOwnerWarehouse, raceOwnerProduct, raceOwnerFirst).Error
		}),
		san_race.Block("B", second, func(tx *gorm.DB) error {
			_, err := inventory_v1.NewService(tx, nil, nil, nil, nil, nil, nil, nil).RestockRequestCreate(ctxUser(1),
				connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
					TeamId: raceOwnerSecond, WarehouseId: raceOwnerWarehouse,
					Items: []*inventoryv1.RestockRequestItem{
						{ProductId: raceOwnerProduct, ProductCode: "SKU1", Name: "Widget", Count: 1, Total: 100},
					},
				}))

			return err
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	b := sched.Get(second)
	if b.Err != nil {
		t.Fatalf("B, the restock, failed: %v", b.Err)
	}

	if !b.Blocked || !b.Released {
		t.Fatalf("B blocked %v, released %v — want it to wait on A's uncommitted link, then go on", b.Blocked, b.Released)
	}

	owners := linkOwners(t, h.DB(), raceOwnerWarehouse)
	if len(owners) != 1 || owners[raceOwnerProduct] != raceOwnerFirst {
		t.Fatalf("links = %v, want product 100 once, under the first writer's team 77", owners)
	}

	var restocks int64

	h.DB().Raw(`SELECT count(*) FROM restocks WHERE team_id = ? AND warehouse_id = ?`, raceOwnerSecond, raceOwnerWarehouse).
		Scan(&restocks)
	if restocks != 1 {
		t.Fatalf("%d restocks of team 2, want the one B created", restocks)
	}

	warning := logged.String()
	for _, want := range []string{"stored under another owner team", "product_id=100", "stored_owner_team_id=77", "writer_owner_team_id=2"} {
		if !strings.Contains(warning, want) {
			t.Fatalf("B's report %q does not say %q — the first owner was missed", warning, want)
		}
	}
}
