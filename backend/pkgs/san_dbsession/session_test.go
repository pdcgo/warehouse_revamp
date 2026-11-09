package san_dbsession_test

import (
	"testing"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_dbsession"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// Whatever zone a DSN names, in whatever form it arrives, the session is Jakarta — one calendar, never one
// environment variable away from a second.
func TestConfig_PinsJakartaOverWhateverTheDSNSays(t *testing.T) {
	cases := map[string]string{
		"key=value, no zone":   "host=localhost port=5433 user=u dbname=d sslmode=disable",
		"key=value, UTC":       "host=localhost port=5433 user=u dbname=d sslmode=disable TimeZone=UTC",
		"key=value, lowercase": "host=localhost user=u dbname=d timezone=UTC",
		"URL, no zone":         "postgres://u:p@localhost:5433/d?sslmode=disable",
		"URL, UTC":             "postgres://u:p@localhost:5433/d?sslmode=disable&TimeZone=UTC",
	}

	for name, dsn := range cases {
		cfg, err := san_dbsession.Config(dsn)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		zones := 0

		for key, value := range cfg.RuntimeParams {
			if key == "timezone" && value == san_dbsession.TimeZone {
				zones++

				continue
			}

			if key == "TimeZone" || key == "timezone" {
				t.Fatalf("%s: a second zone %s=%s reaches the server", name, key, value)
			}
		}

		if zones != 1 {
			t.Fatalf("%s: runtime params %v — want exactly timezone=%s", name, cfg.RuntimeParams, san_dbsession.TimeZone)
		}
	}
}

// THE CHANGE LIST's step 5 (docs/development_state/architecture/context.md): the session the tests run on — opened by
// the same opener as the server's — is Jakarta. An instant at 23:30 UTC is 06:30 WIB the NEXT day, and CURRENT_DATE is
// today in Jakarta, never in UTC.
func TestSession_IsOnTheJakartaCalendar(t *testing.T) {
	db := san_testdb.DB(t)

	var zone string

	err := db.Raw(`SELECT current_setting('TimeZone')`).Scan(&zone).Error
	if err != nil {
		t.Fatal(err)
	}

	if zone != san_dbsession.TimeZone {
		t.Fatalf("the session's TimeZone is %q, want %q", zone, san_dbsession.TimeZone)
	}

	var day string

	err = db.Raw(`SELECT to_char(CAST(TIMESTAMPTZ '2026-11-04 23:30:00+00' AS date), 'YYYY-MM-DD')`).Scan(&day).Error
	if err != nil {
		t.Fatal(err)
	}

	if day != "2026-11-05" {
		t.Fatalf("23:30 UTC on 4 Nov is day %s, want 2026-11-05 — 06:30 WIB", day)
	}

	wib := time.FixedZone("WIB", 7*60*60)
	before := time.Now().In(wib).Format(time.DateOnly)

	var today string

	err = db.Raw(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD')`).Scan(&today).Error
	if err != nil {
		t.Fatal(err)
	}

	after := time.Now().In(wib).Format(time.DateOnly)

	if today != before && today != after {
		t.Fatalf("CURRENT_DATE is %s, the Jakarta day is %s", today, after)
	}
}
