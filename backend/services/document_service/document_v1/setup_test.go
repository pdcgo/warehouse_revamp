package document_v1_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
	document_v1 "github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
)

const testBaseURL = "http://test.local/local-storage"

func newService(t *testing.T, db *gorm.DB) (*document_v1.Service, docstore.Config) {
	t.Helper()

	cfg := docstore.DefaultConfig(docstore.Config{
		Dir:         t.TempDir(),
		BaseURL:     testBaseURL,
		TokenSecret: "test-secret",
	})

	return document_v1.NewService(db, cfg), cfg
}

// putBytes simulates the browser's direct cross-origin PUT: it writes the object at the key
// embedded in the signed upload URL, straight into the local store's directory.
func putBytes(t *testing.T, cfg docstore.Config, uploadURL string, data []byte) {
	t.Helper()

	key := strings.TrimPrefix(uploadURL, strings.TrimRight(cfg.BaseURL, "/")+"/")
	path := filepath.Join(cfg.Dir, filepath.FromSlash(key))

	err := os.MkdirAll(filepath.Dir(path), 0o755)
	if err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	err = os.WriteFile(path, data, 0o644)
	if err != nil {
		t.Fatalf("write object: %v", err)
	}
}
