package docstore_test

import (
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
