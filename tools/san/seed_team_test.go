package main

import (
	"context"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// `san seed` finds its dev teams BY CODE (risk 6 of #141's scope): once the owner edits Dev Selling's code
// (TeamCodeUpdate, backlog #149), the next seed must find that same team by the code it HELD — not create a second
// *Dev Selling* carrying the first one's former code, which is never given to another team.
func TestEnsureTeam_FindsATeamByACodeItHeldOnce(t *testing.T) {
	sqlDB, err := san_testdb.Pool(t).DB()
	if err != nil {
		t.Fatal(err)
	}

	tx, err := sqlDB.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() {
		_ = tx.Rollback()
	})

	ctx := context.Background()

	first, err := ensureTeam(ctx, tx, "selling", "Dev Selling", "SEEDSELL149")
	if err != nil {
		t.Fatal(err)
	}

	// The owner renames the code: the team now holds SEEDXYZ149, and SEEDSELL149 is its former code.
	_, err = tx.ExecContext(ctx, `UPDATE teams SET team_code = 'SEEDXYZ149' WHERE id = $1`, first)
	if err != nil {
		t.Fatal(err)
	}

	_, err = tx.ExecContext(ctx, `INSERT INTO team_former_codes (team_code, team_id) VALUES ('SEEDSELL149', $1)`, first)
	if err != nil {
		t.Fatal(err)
	}

	again, err := ensureTeam(ctx, tx, "selling", "Dev Selling", "SEEDSELL149")
	if err != nil {
		t.Fatal(err)
	}

	if again != first {
		t.Fatalf("the seed made team %d beside %d — a second Dev Selling under the first one's former code", again, first)
	}

	var n int

	err = tx.QueryRowContext(ctx, `SELECT count(*) FROM teams WHERE name = 'Dev Selling' AND team_code IN ('SEEDSELL149', 'SEEDXYZ149')`).Scan(&n)
	if err != nil {
		t.Fatal(err)
	}

	if n != 1 {
		t.Fatalf("%d Dev Selling teams, want 1", n)
	}
}
