//go:build perfaudit

package inventory_v1_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// RestockRequestNoteSet over 50 000 restocks (five selling teams, three warehouses, two lines each): the selling team
// rewriting one accepted restock's note — the row FOR UPDATE by primary key, the note and its writer, the edit's trail row
// and its one change, then the lines by restock — and the same note again, which writes nothing.
func TestPerf_RestockRequestNoteSet(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	now := time.Now()
	rows := make([]inventory_service_models.Restock, 0, 50_000)

	for i := range 50_000 {
		rows = append(rows, inventory_service_models.Restock{
			TeamID:      uint64(2 + i%5),
			WarehouseID: uint64(900 + i%3),
			Status:      "accepted",
			Note:        "catatan " + fmt.Sprint(i),
			CreatedAt:   now.Add(-time.Duration(i) * time.Minute),
			UpdatedAt:   now,
		})
	}

	san_perf.SeedRows(t, db, &rows)

	items := make([]inventory_service_models.RestockItem, 0, 2*len(rows))
	for i := range rows {
		for p := range 2 {
			items = append(items, inventory_service_models.RestockItem{
				RestockID: rows[i].ID, ProductID: uint64(100 + p), ProductCode: "SKU", Name: "Kaos", Count: 10, Total: 1000,
			})
		}
	}

	san_perf.SeedRows(t, db, &items)

	svc := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	restock := rows[25_000]
	ctx := ctxUser(arrBuyer)

	set := func(note string) func() error {
		return func() error {
			_, err := svc.RestockRequestNoteSet(ctx, connect.NewRequest(&inventoryv1.RestockRequestNoteSetRequest{
				TeamId: restock.TeamID, RequestId: restock.ID, Note: note,
			}))

			return err
		}
	}

	for _, c := range []struct {
		name string
		call func(i int) func() error
	}{
		{"RestockRequestNoteSet changed", func(i int) func() error { return set("baru " + fmt.Sprint(i)) }},
		{"RestockRequestNoteSet unchanged", func(int) func() error { return set("tetap") }},
	} {
		err := c.call(-1)()
		if err != nil {
			t.Fatalf("%s warm-up: %v", c.name, err)
		}

		if strings.HasSuffix(c.name, "unchanged") {
			err = set("tetap")()
			if err != nil {
				t.Fatalf("%s seed: %v", c.name, err)
			}
		}

		walls := make([]time.Duration, 0, 5)

		for i := range 5 {
			probe.Reset()

			call := c.call(i)
			wall, dbTime := probe.Measure(func() { err = call() })
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}

			walls = append(walls, wall)
			t.Logf("%s wall=%v db=%v queries=%d", c.name, wall, dbTime, probe.Count())
		}

		t.Logf("%s MEDIAN wall %v", c.name, san_perf.Median(walls))

		for _, q := range probe.Queries() {
			if !strings.HasPrefix(strings.TrimSpace(q.SQL), "SELECT") {
				t.Logf("(not explained) %s", q.SQL)

				continue
			}

			t.Log(san_perf.Explain(t, db, q.SQL))
		}
	}
}
