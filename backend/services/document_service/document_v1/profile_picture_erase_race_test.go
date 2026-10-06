//go:build raceaudit

package document_v1_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
)

// The concurrency audit of ProfilePictureErase (audit-sql). It takes no lock: it deletes files a missing key cannot
// fail on, then rows by id. Two erases of one person at the same second — a double click — must both succeed and
// leave nothing: no row, no file, no share.
const racers = 4

func TestRace_ProfilePictureErase_Twice(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	svc, cfg := newService(t, db)

	person := uint64(900_000 + time.Now().UnixNano()%100_000)
	prefix := fmt.Sprintf("race-%d-", person)

	t.Cleanup(func() {
		db.Where("document_id LIKE ?", prefix+"%").Delete(&document_service_models.DocumentShare{})
		db.Where("id LIKE ?", prefix+"%").Delete(&document_service_models.Document{})
	})

	for round := 0; round < 20; round++ {
		var docs []document_service_models.Document
		for i := 0; i < 3; i++ {
			docs = append(docs, storedPhoto(t, db, cfg, fmt.Sprintf("%s%d-%d", prefix, round, i), "profile_picture", person))
		}

		db.Create(&document_service_models.DocumentShare{DocumentID: docs[0].ID, TeamID: 12, GrantedBy: person})

		res := h.Race(t, racers, func(int) error {
			_, err := svc.ProfilePictureErase(context.Background(), connect.NewRequest(&documentv1.ProfilePictureEraseRequest{UserId: person}))
			return err
		})

		if res.Failed() > 0 {
			res.Report(t)
			for _, o := range res.Outcomes {
				if o.Err != nil {
					t.Log(o.Err)
				}
			}
			t.Fatalf("round %d: an erase failed — a second erase of the same person must succeed", round)
		}

		for _, doc := range docs {
			if rowExists(db, doc.ID) || fileExists(cfg, doc.ObjectKey) || fileExists(cfg, doc.ThumbnailKey) {
				t.Fatalf("round %d: %s survived two erases", round, doc.ID)
			}
		}
	}
}
