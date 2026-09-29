package settlement_importer_v1_test

import (
	"os"
	"path/filepath"
	"testing"

	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The real sample workbooks live outside the package and outside git; like the reader's tests, this
// skips when they are not in the checkout.
const samples = "../../../../examples/settlement_samples"

func sampleFiles(t *testing.T, platform string) []string {
	t.Helper()

	entries, err := os.ReadDir(filepath.Join(samples, platform))
	if os.IsNotExist(err) {
		t.Skipf("no %s samples in this checkout", platform)
	}

	if err != nil {
		t.Fatal(err)
	}

	names := []string{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".xlsx" || entry.Name()[0] == '.' {
			continue
		}

		names = append(names, filepath.Join(samples, platform, entry.Name()))
	}

	return names
}

// Every real statement imports to the end — no sample is refused as a whole, every row lands somewhere,
// and the tallies add up to the rows read. With no orders known, every order line goes to the shop.
func TestImport_EverySampleStatementImports(t *testing.T) {
	for _, platform := range []string{"shopee", "tiktok"} {
		for _, path := range sampleFiles(t, platform) {
			t.Run(filepath.Base(path), func(t *testing.T) {
				db := san_testdb.DB(t)
				w := newWorld(t, db)

				content, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}

				var end message

				if platform == "shopee" {
					end = last(w.importShopee(t, shopeeShop, content))
				} else {
					end = last(w.importTiktok(t, tiktokShop, content))
				}

				file := end.file
				if file.GetStatus() != settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_DONE {
					t.Fatalf("ended %v: %s", file.GetStatus(), end.text)
				}

				tally := file.GetTally()
				if tally.GetPosted()+tally.GetExisting()+tally.GetHeld()+tally.GetSkipped() != tally.GetTotal() {
					t.Fatalf("tallies do not add up: %+v", tally)
				}

				t.Logf("%d rows: %d posted (%d to the shop), %d held, %d skipped",
					tally.GetTotal(), tally.GetPosted(), tally.GetPostedToShop(), tally.GetHeld(), tally.GetSkipped())
			})
		}
	}
}
