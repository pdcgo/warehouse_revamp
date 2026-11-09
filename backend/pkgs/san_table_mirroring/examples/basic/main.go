// Command basic mirrors one table, one change at a time, and prints what each run sends: every row as
// new the first time, then only what changed, then nothing.
//
//	go run ./backend/pkgs/san_table_mirroring/examples/basic [-keep]
//
// It needs the local docker Postgres (`go run ./tools/san dev setup`) and refuses any other host.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_table_mirroring"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_table_mirroring/examples/internal/demo"
	"gorm.io/gorm"
)

func main() {
	keep := flag.Bool("keep", false, "leave the example schemas in place to look at them")
	flag.Parse()

	err := run(*keep)
	if err != nil {
		log.Fatal(err)
	}
}

func run(keep bool) (err error) {
	ctx := context.Background()

	db, cleanup, err := demo.Start(3, keep)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, cleanup()) }()

	// In a real migration these are two different databases: the old system's, and revamp's.
	oldDB, newDB := db, db

	fmt.Println("run 1 — the first run sends every row as new:")

	err = mirrorUsers(ctx, oldDB, newDB)
	if err != nil {
		return err
	}

	fmt.Println("\nin the old database: user 2 renamed, user 3 soft-deleted, user 1 hard-deleted, user 4 added")

	err = demo.Exec(oldDB,
		`UPDATE `+demo.OldSchema+`.users SET name = 'Renamed' WHERE id = 2`,
		`UPDATE `+demo.OldSchema+`.users SET deleted_at = now() WHERE id = 3`,
		`DELETE FROM `+demo.OldSchema+`.users WHERE id = 1`,
	)
	if err != nil {
		return err
	}

	err = demo.AddUsers(oldDB, 4, 4)
	if err != nil {
		return err
	}

	fmt.Println("\nrun 2 — only what changed (a soft delete is just an edit, so it arrives as modified):")

	err = mirrorUsers(ctx, oldDB, newDB)
	if err != nil {
		return err
	}

	fmt.Println("\nrun 3 — nothing changed, nothing sent:")

	err = mirrorUsers(ctx, oldDB, newDB)
	if err != nil {
		return err
	}

	var mirror []demo.User

	err = newDB.
		Table(demo.NewSchema + ".users").
		Order("id").
		Find(&mirror).
		Error
	if err != nil {
		return err
	}

	fmt.Println("\nthe mirror now:")

	for _, u := range mirror {
		fmt.Printf("  id=%d  %-8s soft-deleted=%v\n", u.ID, u.Name, u.DeletedAt != nil)
	}

	return nil
}

// mirrorUsers is one run over the old users table.
func mirrorUsers(ctx context.Context, oldDB, newDB *gorm.DB) error {
	sent := 0

	err := san_table_mirroring.TrackTable[*demo.User](
		ctx,
		oldDB,
		demo.OldSchema+".users",
		func(ctx context.Context, change san_table_mirroring.Change[*demo.User]) error {
			sent++

			line := fmt.Sprintf("  %-8s id=%d", change.Change, change.ID)
			if change.Data != nil {
				line += " " + change.Data.Name
			}

			fmt.Println(line)

			// 1. Write the change on the new side. If this fails, return the error WITHOUT acking:
			//    the run stops, and the change comes again next run.
			err := demo.ApplyUser(ctx, newDB, change)
			if err != nil {
				return err
			}

			// 2. Only then acknowledge it — on the OLD database, where the track tables live.
			return change.Ack(oldDB)
		},
	)
	if err != nil {
		return err
	}

	if sent == 0 {
		fmt.Println("  (nothing)")
	}

	return nil
}
