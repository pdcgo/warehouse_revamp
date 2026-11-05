// Command batched mirrors a large table in batches: the handler collects changes, writes each batch
// on the new side in one transaction, and acknowledges it with one AckAll. That is the shape for a
// first run over a big table, where one Ack per row costs a round trip per row.
//
//	go run ./backend/pkgs/san_table_mirroring/examples/batched [-rows 50000] [-batch 1000] [-keep]
//
// It needs the local docker Postgres (`go run ./tools/san dev setup`) and refuses any other host.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_table_mirroring"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_table_mirroring/examples/internal/demo"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func main() {
	rows := flag.Int("rows", 50000, "users in the old table")
	batch := flag.Int("batch", 1000, "changes per batch")
	keep := flag.Bool("keep", false, "leave the example schemas in place to look at them")
	flag.Parse()

	err := run(*rows, *batch, *keep)
	if err != nil {
		log.Fatal(err)
	}
}

func run(rows, batch int, keep bool) (err error) {
	ctx := context.Background()

	db, cleanup, err := demo.Start(rows, keep)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, cleanup()) }()

	oldDB, newDB := db, db

	err = mirror(ctx, oldDB, newDB, batch, fmt.Sprintf("run 1 — first run over %d rows", rows))
	if err != nil {
		return err
	}

	err = demo.Exec(oldDB,
		`UPDATE `+demo.OldSchema+`.users SET name = name || ' (edited)' WHERE id % 100 = 0`,
		`DELETE FROM `+demo.OldSchema+`.users WHERE id % 1000 = 1`,
	)
	if err != nil {
		return err
	}

	err = mirror(ctx, oldDB, newDB, batch, "run 2 — 1% edited, 0.1% deleted")
	if err != nil {
		return err
	}

	err = mirror(ctx, oldDB, newDB, batch, "run 3 — nothing changed")
	if err != nil {
		return err
	}

	oldRows, err := demo.Count(oldDB, demo.OldSchema+".users")
	if err != nil {
		return err
	}

	newRows, err := demo.Count(newDB, demo.NewSchema+".users")
	if err != nil {
		return err
	}

	fmt.Printf("\nold table %d rows, mirror %d rows\n", oldRows, newRows)

	return nil
}

func mirror(ctx context.Context, oldDB, newDB *gorm.DB, size int, label string) error {
	start := time.Now()
	b := &batcher{oldDB: oldDB, newDB: newDB, size: size}

	err := san_table_mirroring.TrackTable[*demo.User](ctx, oldDB, demo.OldSchema+".users", b.add)

	// The LAST, partial batch is still pending when TrackTable returns. Flush it — or those changes are
	// not lost, but they come again next run. Flush after an error too: every change still pending was
	// handed over correctly before the run stopped.
	err = errors.Join(err, b.flush(ctx))
	if err != nil {
		return err
	}

	fmt.Printf("%-34s %6d upserted, %4d deleted, in %d batches, %v\n",
		label, b.upserted, b.deleted, b.batches, time.Since(start).Round(time.Millisecond))

	return nil
}

// batcher collects changes and writes them a batch at a time.
type batcher struct {
	oldDB, newDB *gorm.DB
	size         int
	pending      []san_table_mirroring.Change[*demo.User]

	upserted, deleted, batches int
}

func (b *batcher) add(ctx context.Context, change san_table_mirroring.Change[*demo.User]) error {
	b.pending = append(b.pending, change)
	if len(b.pending) < b.size {
		return nil
	}

	return b.flush(ctx)
}

// flush writes the pending changes on the new side in ONE transaction, then acknowledges them on the
// old side with ONE AckAll. If the write fails nothing is acknowledged, and the whole batch comes again
// next run. If AckAll fails after the write landed, the batch also comes again — and is written again,
// which is why both writes are an upsert and a delete by ID.
func (b *batcher) flush(ctx context.Context) error {
	if len(b.pending) == 0 {
		return nil
	}

	defer func() { b.pending = b.pending[:0] }()

	var (
		upserts []*demo.User
		deletes []uint64
	)

	for _, c := range b.pending {
		if c.Change == san_table_mirroring.ChangeTypeDeleted {
			deletes = append(deletes, c.ID)
		} else {
			upserts = append(upserts, c.Data)
		}
	}

	err := b.newDB.
		WithContext(ctx).
		Transaction(func(tx *gorm.DB) error {
			if len(upserts) > 0 {
				err := tx.
					Table(demo.NewSchema + ".users").
					Clauses(clause.OnConflict{
						Columns:   []clause.Column{{Name: "id"}},
						DoUpdates: clause.AssignmentColumns([]string{"name", "username", "deleted_at"}),
					}).
					Create(&upserts).
					Error
				if err != nil {
					return err
				}
			}

			if len(deletes) > 0 {
				err := tx.
					Exec(`DELETE FROM `+demo.NewSchema+`.users WHERE id IN ?`, deletes).
					Error
				if err != nil {
					return err
				}
			}

			return nil
		})
	if err != nil {
		return err
	}

	err = san_table_mirroring.AckAll(b.oldDB, b.pending)
	if err != nil {
		return err
	}

	b.upserted += len(upserts)
	b.deleted += len(deletes)
	b.batches++

	return nil
}
