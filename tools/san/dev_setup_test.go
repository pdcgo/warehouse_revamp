package main

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// The data half of `dev setup`, run TWICE against a database of its own. The second run is the
// "pulled new migrations, ran setup again" case: it must neither fail nor duplicate a row.
func TestDevSetupDatabaseIsRepeatable(t *testing.T) {
	ctx := context.Background()

	admin, err := adminConn(ctx, "")
	if err != nil {
		t.Skipf("no local Postgres (docker compose up -d): %v", err)
	}

	t.Cleanup(func() { _ = admin.Close() })

	// Its own database, never warehouse_test: that one is shared with every other package's tests,
	// running beside this one, and never the dev database the owner reviews on.
	name := fmt.Sprintf("warehouse_setup_test_%d", time.Now().UnixNano())

	_, err = admin.ExecContext(ctx, `CREATE DATABASE "`+name+`"`)
	if err != nil {
		t.Fatalf("creating %s: %v", name, err)
	}

	t.Cleanup(func() {
		_, _ = admin.ExecContext(context.Background(), `DROP DATABASE IF EXISTS "`+name+`" WITH (FORCE)`)
	})

	t.Setenv("POSTGRES_DB", name)

	db, err := openDatabase(ctx, localDSN(), name)
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() { _ = db.Close() })

	seeds, err := readDevSeeds()
	if err != nil {
		t.Fatal(err)
	}

	for run := 1; run <= 2; run++ {
		err = setupDatabase(ctx, db, targetLocal, "devpassword123", seeds)
		if err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}

	count := func(query string) int {
		t.Helper()

		var n int

		err := db.QueryRowContext(ctx, query).Scan(&n)
		if err != nil {
			t.Fatalf("%s: %v", query, err)
		}

		return n
	}

	checks := []struct {
		what  string
		query string
		want  int
	}{
		{"dev logins", `SELECT count(*) FROM users WHERE username IN ('dev', 'wh_owner', 'wh_staff', 'seller')`, 4},
		{"dev teams", `SELECT count(*) FROM teams WHERE team_code IN ('DEVWH', 'DEVSELL')`, 2},
		{"categories", `SELECT count(*) FROM categories`, countCategories(seeds.categories)},
		{"regions", `SELECT count(*) FROM regions`, len(seeds.regions)},
	}

	for _, c := range checks {
		got := count(c.query)
		if got != c.want {
			t.Errorf("%s after two runs: got %d rows, want %d", c.what, got, c.want)
		}
	}
}

// Only a NEVER-checked-out submodule is initialised. One at another commit ("+") is somebody's work,
// and `update` would move it back.
func TestOnlyEmptySubmodulesAreInitialised(t *testing.T) {
	listing := "-0123abcd backend/packages/never_cloned\n" +
		"+4567ef01 backend/packages/moved_by_hand (v1.2-3-g4567ef0)\n" +
		" 89ab2345 backend/packages/up_to_date (v1.0)\n"

	got := uninitialisedSubmodules(listing)
	if len(got) != 1 || got[0] != "backend/packages/never_cloned" {
		t.Fatalf("got %q, want only the never-cloned one", got)
	}
}

func countCategories(nodes []categorySeed) int {
	n := len(nodes)
	for _, node := range nodes {
		n += countCategories(node.Children)
	}

	return n
}
