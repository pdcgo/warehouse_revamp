package region_v1_test

import (
	"testing"

	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	region_v1 "github.com/pdcgo/warehouse_revamp/backend/services/region_service/region_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/region_service/region_service_models"
)

func newService(t *testing.T, db *gorm.DB) *region_v1.Service {
	t.Helper()

	return region_v1.NewService(db)
}

func page(limit uint32) *commonv1.PageFilter {
	return &commonv1.PageFilter{Page: 1, Limit: limit}
}

func pageAt(number, limit uint32) *commonv1.PageFilter {
	return &commonv1.PageFilter{Page: number, Limit: limit}
}

// insertRegion seeds one region. Parents must go in BEFORE their children — parent_code is a real
// self-FK.
func insertRegion(t *testing.T, db *gorm.DB, code, parent string, level int, name, kodePos string) {
	t.Helper()

	row := region_service_models.Region{Code: code, Level: level, Name: name}

	if parent != "" {
		row.ParentCode = &parent
	}

	if kodePos != "" {
		row.KodePos = &kodePos
	}

	err := db.Create(&row).Error
	if err != nil {
		t.Fatalf("insert region %s: %v", code, err)
	}
}

// seedTree plants a small, real slice of the hierarchy — two provinsi and one full chain down to the
// desa. These tests deliberately do NOT load the 91.599-row seed: a unit test should assert on rows
// it can see, not on upstream reference data.
//
//	Aceh (11)
//	  Kabupaten Aceh Selatan (11.01)
//	    Bakongan (11.01.01)
//	      Keude Bakongan (…2001, 23773)
//	      Keude Baru      (…2002, 23774)
//	      Aceh Jaya       (…2003, 23775)
//	  Kabupaten Aceh Tenggara (11.02)
//	Sumatera Utara (12)
//	  Kabupaten Nias (12.01)
func seedTree(t *testing.T, db *gorm.DB) {
	t.Helper()

	insertRegion(t, db, "11", "", 1, "Aceh", "")
	insertRegion(t, db, "11.01", "11", 2, "Kabupaten Aceh Selatan", "")
	insertRegion(t, db, "11.01.01", "11.01", 3, "Bakongan", "")
	insertRegion(t, db, "11.01.01.2001", "11.01.01", 4, "Keude Bakongan", "23773")
	insertRegion(t, db, "11.01.01.2002", "11.01.01", 4, "Keude Baru", "23774")
	// Shares a name PREFIX with the provinsi — that is what makes the level filter testable.
	insertRegion(t, db, "11.01.01.2003", "11.01.01", 4, "Aceh Jaya", "23775")
	insertRegion(t, db, "11.02", "11", 2, "Kabupaten Aceh Tenggara", "")
	insertRegion(t, db, "12", "", 1, "Sumatera Utara", "")
	insertRegion(t, db, "12.01", "12", 2, "Kabupaten Nias", "")
}
