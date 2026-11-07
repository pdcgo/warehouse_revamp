//go:build perfaudit

package region_v1_test

import (
	"context"
	"encoding/csv"
	"os"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	regionv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/region/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/region_service/region_service_models"
	region_v1 "github.com/pdcgo/warehouse_revamp/backend/services/region_service/region_v1"
)

// RegionMatch over the REAL region list — the pinned 91.599-row seed, loaded into the test's transaction (it rolls back
// with it). The cases are the shapes a draft brings: one place, the country's commonest desa name (Sidomulyo, 98 desa),
// two desa of one name in one kecamatan, and a provinsi alias no row carries.
func TestPerf_RegionMatch(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	file, err := os.Open("../db_migrations/seed/regions.csv")
	if err != nil {
		t.Fatalf("open seed: %v", err)
	}
	defer file.Close()

	records, err := csv.NewReader(file).ReadAll()
	if err != nil {
		t.Fatalf("read seed: %v", err)
	}

	rows := make([]region_service_models.Region, 0, len(records))

	for _, rec := range records[1:] {
		level, _ := strconv.Atoi(rec[2])
		row := region_service_models.Region{Code: rec[0], Level: level, Name: rec[3]}

		if rec[1] != "" {
			parent := rec[1]
			row.ParentCode = &parent
		}

		if rec[4] != "" {
			kodePos := strings.TrimSpace(rec[4])
			row.KodePos = &kodePos
		}

		rows = append(rows, row)
	}

	// Parents before children — parent_code is a real self-FK.
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Level < rows[j].Level })
	san_perf.SeedRows(t, db, rows)

	svc := region_v1.NewService(db)

	cases := map[string]*regionv1.RegionMatchRequest{
		"one place": {
			ProvinsiName: "Jawa Barat", KabupatenName: "Kab. Bogor", KecamatanName: "Cibinong", DesaName: "Pakansari",
		},
		"commonest desa name": {
			ProvinsiName: "Jawa Timur", KabupatenName: "Kabupaten Lamongan", KecamatanName: "Sambeng",
			DesaName: "Sidomulyo",
		},
		"two desa of one name": {
			ProvinsiName: "Jambi", KabupatenName: "Kabupaten Tanjung Jabung Barat", KecamatanName: "Merlung",
			DesaName: "Merlung",
		},
		"an alias no row carries": {
			ProvinsiName: "DKI Jakarta", KabupatenName: "Kota Jakarta Utara", KecamatanName: "Koja", DesaName: "Tugu Utara",
		},
	}

	for name, req := range cases {
		call := func() (*regionv1.RegionMatchResponse, error) {
			res, callErr := svc.RegionMatch(context.Background(), connect.NewRequest(req))
			if callErr != nil {
				return nil, callErr
			}

			return res.Msg, nil
		}

		got, err := call()
		if err != nil {
			t.Fatalf("%s warm-up: %v", name, err)
		}

		t.Logf("%s: matches=%d", name, got.GetMatches())

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() { _, err = call() })
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}

			walls = append(walls, wall)
			t.Logf("%s wall=%v db=%v queries=%d", name, wall, dbTime, probe.Count())
		}

		t.Logf("%s MEDIAN wall %v", name, san_perf.Median(walls))

		for _, q := range probe.Queries() {
			t.Log(san_perf.Explain(t, db, q.SQL))
		}
	}
}
