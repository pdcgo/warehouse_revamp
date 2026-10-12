package docstore_test

import (
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
)

// A key that tries to climb out of the storage root must be refused, not resolved.
func TestLocalStore_RejectsPathTraversal(t *testing.T) {
	store := docstore.NewLocalStore(docstore.Config{Dir: t.TempDir()})

	for _, key := range []string{"../escape", "../../etc/passwd", "assets/../../x"} {
		_, _, err := store.Stat(key)
		if err == nil {
			t.Errorf("Stat(%q) = nil error, want a rejection", key)
		}
	}
}

// Deleting is idempotent: a missing key is not an error, and neither is the same file deleted by several callers at
// the same instant — on Windows the later ones are refused while the first is still finishing, and must not fail.
func TestLocalStore_DeleteTwiceAtOnce(t *testing.T) {
	dir := t.TempDir()
	store := docstore.NewLocalStore(docstore.Config{Dir: dir})

	for round := 0; round < 50; round++ {
		err := os.WriteFile(filepath.Join(dir, "photo.png"), []byte("png!"), 0o644)
		if err != nil {
			t.Fatalf("write: %v", err)
		}

		var wg sync.WaitGroup

		errs := make(chan error, 4)

		for range 4 {
			wg.Add(1)

			go func() {
				defer wg.Done()
				errs <- store.Delete("photo.png")
			}()
		}

		wg.Wait()
		close(errs)

		for err := range errs {
			if err != nil {
				t.Fatalf("round %d: a simultaneous delete failed: %v", round, err)
			}
		}
	}

	err := store.Delete("never-there.png")
	if err != nil {
		t.Errorf("deleting a missing key: %v", err)
	}
}
