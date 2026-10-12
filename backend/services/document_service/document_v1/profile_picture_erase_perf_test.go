//go:build perfaudit

package document_v1_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
)

// The performance audit of ProfilePictureErase (audit-rpc-performance). documents is a growing table — every
// receipt, statement and photo — so 50 000 rows, of which one in ten is a profile picture, spread over 5 000 people.
func TestPerf_ProfilePictureErase(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	docs := make([]document_service_models.Document, 50_000)
	for i := range docs {
		kind := "general"
		if i%10 == 0 {
			kind = "profile_picture"
		}

		docs[i] = document_service_models.Document{
			ID:           fmt.Sprintf("perf-%d", i),
			TeamID:       uint64(i % 300),
			ResourceType: kind,
			ObjectKey:    fmt.Sprintf("perf/%d", i),
			CreatedByID:  uint64(i % 5_000),
			Status:       "active",
		}
	}
	san_perf.SeedRows(t, db, &docs)

	svc, _ := newService(t, db)

	call := func(person uint64) {
		_, err := svc.ProfilePictureErase(context.Background(), connect.NewRequest(&documentv1.ProfilePictureEraseRequest{UserId: person}))
		if err != nil {
			t.Fatalf("ProfilePictureErase: %v", err)
		}
	}

	call(4_999) // warm-up

	walls := make([]time.Duration, 0, 5)

	for i := range 5 {
		probe.Reset()

		wall, dbTime := probe.Measure(func() { call(uint64(10 * (i + 1))) })

		walls = append(walls, wall)
		t.Logf("wall=%v db=%v go=%v queries=%d", wall, dbTime, wall-dbTime, probe.Count())
	}

	t.Logf("ProfilePictureErase median wall %v", san_perf.Median(walls))
	probe.Report(t, "ProfilePictureErase")

	t.Log(san_perf.Explain(t, db, `SELECT "id","object_key","thumbnail_key" FROM "documents" WHERE resource_type = 'profile_picture' AND created_by_id = 20`))
}
