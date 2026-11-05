// Command scheduled is the shape of the real migration job: on every tick it mirrors a list of tables,
// and treats each error the package returns the way a scheduler should.
//
//	go run ./backend/pkgs/san_table_mirroring/examples/scheduled [-every 1s] [-keep]
//
// It plays three ticks:
//   - tick 1: a normal run, plus a table the package cannot track (a configuration error);
//   - tick 2: 80 of the 100 users vanish at once, so the delete guard stops that table and sends nothing;
//   - tick 3: an operator decides the purge is real, raises the limit for one run, and sets it back.
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
)

func main() {
	every := flag.Duration("every", time.Second, "time between ticks")
	keep := flag.Bool("keep", false, "leave the example schemas in place to look at them")
	flag.Parse()

	err := run(*every, *keep)
	if err != nil {
		log.Fatal(err)
	}
}

// job is one table the scheduler mirrors.
type job struct {
	table string
	run   func(ctx context.Context) error
}

func run(every time.Duration, keep bool) (err error) {
	ctx := context.Background()

	db, cleanup, err := demo.Start(100, keep)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, cleanup()) }()

	oldDB, newDB := db, db

	// A join table: its key is two columns, which the package does not support.
	err = demo.Exec(oldDB, `CREATE TABLE `+demo.OldSchema+`.user_teams (user_id bigint, team_id bigint, PRIMARY KEY (user_id, team_id))`)
	if err != nil {
		return err
	}

	type userTeam struct {
		UserID uint64
		TeamID uint64
	}

	jobs := []job{
		{
			table: demo.OldSchema + ".users",
			run: func(ctx context.Context) error {
				return san_table_mirroring.TrackTable[*demo.User](ctx, oldDB, demo.OldSchema+".users",
					func(ctx context.Context, change san_table_mirroring.Change[*demo.User]) error {
						err := demo.ApplyUser(ctx, newDB, change)
						if err != nil {
							return err
						}

						return change.Ack(oldDB)
					})
			},
		},
		{
			table: demo.OldSchema + ".user_teams",
			run: func(ctx context.Context) error {
				return san_table_mirroring.TrackTable[*userTeam](ctx, oldDB, demo.OldSchema+".user_teams",
					func(ctx context.Context, change san_table_mirroring.Change[*userTeam]) error {
						return change.Ack(oldDB)
					})
			},
		},
	}

	config := demo.OldSchema + "_track.configurations"

	ticker := time.NewTicker(every)
	defer ticker.Stop()

	for tick := 1; tick <= 3; tick++ {
		switch tick {
		case 2:
			fmt.Println("\n(between ticks: 80 of the 100 users are deleted in the old database)")

			err = demo.Exec(oldDB, `DELETE FROM `+demo.OldSchema+`.users WHERE id <= 80`)
		case 3:
			fmt.Println("\n(an operator confirms the purge is real and lets it through for ONE run)")

			err = demo.Exec(oldDB, `UPDATE `+config+` SET value = '100' WHERE name = 'max_delete_percent'`)
		}

		if err != nil {
			return err
		}

		fmt.Printf("\ntick %d\n", tick)

		for _, j := range jobs {
			runJob(ctx, j)
		}

		if tick == 3 {
			fmt.Println("\n(the operator sets the limit back)")

			err = demo.Exec(oldDB, `UPDATE `+config+` SET value = '10' WHERE name = 'max_delete_percent'`)
			if err != nil {
				return err
			}

			break
		}

		<-ticker.C
	}

	mirrored, err := demo.Count(newDB, demo.NewSchema+".users")
	if err != nil {
		return err
	}

	fmt.Printf("\nthe mirror holds %d users, like the old table\n", mirrored)

	return nil
}

// runJob runs one table and decides what its error means. One table's error never stops the others.
func runJob(ctx context.Context, j job) {
	start := time.Now()
	err := j.run(ctx)

	var tooMany *san_table_mirroring.TooManyDeletesError

	switch {
	case err == nil:
		fmt.Printf("  ok      %s (%v)\n", j.table, time.Since(start).Round(time.Millisecond))

	case errors.Is(err, san_table_mirroring.ErrStillRunning):
		// The previous run on this table has not finished — a slow run, or a second scheduler (two
		// instances, an overlapping cron). Not a failure: nothing was touched, the next tick picks it up.
		fmt.Printf("  skip    %s: the previous run is still going\n", j.table)

	case errors.As(err, &tooMany):
		// NOTHING was sent for this table — not even its new and modified rows. Usually the table was
		// caught half-empty (being truncated and refilled, or restored) and the next tick is fine. If
		// the purge is real, a person lets it through once. Alert, don't retry in a loop.
		fmt.Printf("  ALERT   %s: %d of %d tracked rows are gone, over max_delete_percent %g. Nothing was sent.\n"+
			"          If the purge is real: UPDATE %s SET value = '100' WHERE name = 'max_delete_percent';\n"+
			"          wait for one run, then set it back to '10'.\n",
			tooMany.Table, tooMany.Deletions, tooMany.Tracked, tooMany.LimitPercent, tooMany.ConfigTable)

	case errors.Is(err, san_table_mirroring.ErrUnsupportedTable), errors.Is(err, san_table_mirroring.ErrTableNotFound):
		// A configuration error, not a passing one: this table can never be tracked as listed (a
		// two-column key, a text key, no key, a wrong name). Fix the job's table list.
		fmt.Printf("  CONFIG  %s: %v\n", j.table, err)

	default:
		// The handler failed (the new database is down, a row does not fit) or the old database did.
		// What was acknowledged stays acknowledged; the rest comes again on the next tick.
		fmt.Printf("  ERROR   %s: %v\n", j.table, err)
	}
}
