package product_v1

import (
	"context"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// THE RECORD'S AND THE ARRIVAL'S LOCK IS THE CODE CHANGE'S (backlog #151): lockTeamsOfProducts takes, for every team owning
// one of the products, exactly the advisory lock lockTeamProductCodes takes — the key productCodeLockKey hashes — so a
// record, an arrival and a team code change of the same team queue on ONE lock. Read back from pg_locks: a bigint
// advisory key is held as classid (high 32 bits) and objid (low 32 bits), objsubid 1.
func TestLockTeamsOfProducts_TakesEachTeamsProductCodeLock(t *testing.T) {
	db := san_testdb.DB(t)

	ids := make([]uint64, 0, 3)

	for _, p := range []product_service_models.Product{
		{TeamID: 7301, ProductCode: "LK-1", Name: "a", CategoryID: 1},
		{TeamID: 7301, ProductCode: "LK-2", Name: "b", CategoryID: 1},
		{TeamID: 7302, ProductCode: "LK-3", Name: "c", CategoryID: 1},
	} {
		err := db.Create(&p).Error
		if err != nil {
			t.Fatal(err)
		}

		ids = append(ids, p.ID)
	}

	err := lockTeamsOfProducts(db.WithContext(context.Background()), ids)
	if err != nil {
		t.Fatal(err)
	}

	for _, team := range []uint64{7301, 7302} {
		var held int64

		err = db.Raw(`SELECT COUNT(*) FROM pg_locks l,
				LATERAL (SELECT hashtextextended(?, 0) AS k) h
			WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted AND l.objsubid = 1
			  AND l.classid::bigint = ((h.k >> 32) & 4294967295) AND l.objid::bigint = (h.k & 4294967295)`,
			productCodeLockKey(team)).Scan(&held).Error
		if err != nil {
			t.Fatal(err)
		}

		if held != 1 {
			t.Errorf("team %d's product-code lock held %d times, want once", team, held)
		}
	}
}
