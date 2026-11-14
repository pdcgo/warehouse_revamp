//go:build perfaudit

package supplier_v1_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// THE LINK WRITE ON THE FOLD (supplier_channel_products, 00005): the fold's statements and time with the link upsert
// added, over 40 000 stored links (2 000 suppliers × 20 products — the scoping's volume: 30k products × ~1.3 stores),
// a third of them store-less. Each accept's lines alternate between a link that exists (an UPDATE moving its last
// accept) and a new one (inserted by the warm-up, moved by every measured run). A fresh restock id and instant per call,
// or the claim would fold nothing.
//
//	go test -tags perfaudit -p 1 -run TestPerf_LinkFold -v ./backend/services/supplier_service/supplier_v1/
func TestPerf_LinkFold(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	const links, team = 40_000, uint64(60_000)

	err := quiet.Exec(`
INSERT INTO supplier_channel_products (
    team_id, supplier_id, channel_id, product_id, first_restocked_at, last_restocked_at, last_restock_id)
SELECT 60000 + g % 8, 1 + g / 20, CASE WHEN g % 3 = 0 THEN NULL ELSE 10000 + g / 7 END, 900000 + g,
       NOW() - interval '400 days', NOW() - (g % 365) * interval '1 day', g
FROM generate_series(0, ? - 1) g
ORDER BY NOW() - (g % 365) * interval '1 day'`, links).Error
	if err != nil {
		t.Fatalf("seed links: %v", err)
	}

	err = quiet.Exec(`ANALYZE supplier_channel_products`).Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	b := perfBook{db: db, probe: probe, svc: supplier_v1.NewService(db, nil, nil, nil, nil, nil), team: team}
	handler := b.svc.FoldHandler()
	restock := uint64(9_000_000)
	clock := time.Now()

	for _, size := range []int{1, 20, 100} {
		perfRun(t, b, fmt.Sprintf("FoldHandler+links/lines=%d", size), func(int) error {
			restock++
			clock = clock.Add(time.Second)

			lines := make([]sline, 0, size)

			for i := range size {
				// An existing link of team 60000 (g ≡ 0 mod 8), or a new store-less one of supplier 1.
				g := uint64(i * 8)
				l := sline{supplier: 1 + g/20, line: line{product: 900_000 + g, ordered: 24, total: 24 * 15_000, accepted: 22, broken: 1, lost: 1}}

				if g%3 != 0 {
					l.channel = 10_000 + g/7
				}

				if i%2 == 1 {
					l = sline{supplier: 1, line: line{product: 2_000_000 + uint64(i), ordered: 2, total: 30_000, accepted: 2}}
				}

				lines = append(lines, l)
			}

			return handler(context.Background(), lineAccept(restock, team, clock, lines...))
		})
	}
}
