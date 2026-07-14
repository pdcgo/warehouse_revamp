// Package docstore is the storage seam for document_service: the Signer/ObjectStore interfaces the
// handlers depend on, plus a local filesystem backend for dev and tests. A cloud backend (GCS/S3)
// implements the same two interfaces and drops in without touching the handlers.
package docstore

import (
	"os"
	"path/filepath"
	"time"
)

// Config configures the storage backend and the upload lifecycle.
type Config struct {
	// Dir is the local filesystem root the local backend stores objects under.
	Dir string

	// BaseURL is the public URL of the file endpoint clients PUT to / GET from (the local
	// FileHandler is mounted at BaseURL's path). E.g. "http://localhost:8080/local-storage".
	BaseURL string

	// TokenSecret signs upload tokens (HMAC). Must be non-empty in production.
	TokenSecret string

	// MaxSizeBytes caps an upload; URLTTL is how long an upload/download URL is valid.
	MaxSizeBytes int64
	URLTTL       time.Duration
}

// The two prefixes an object moves between: incoming (unconfirmed) → assets (permanent).
const (
	IncomingPrefix = "incoming"
	AssetPrefix    = "assets"
)

// DefaultConfig fills dev-friendly defaults for anything unset.
func DefaultConfig(cfg Config) Config {
	if cfg.Dir == "" {
		cfg.Dir = filepath.Join(os.TempDir(), "warehouse_document_storage")
	}

	if cfg.MaxSizeBytes == 0 {
		cfg.MaxSizeBytes = 10 << 20 // 10 MiB
	}

	if cfg.URLTTL == 0 {
		cfg.URLTTL = 15 * time.Minute
	}

	return cfg
}

// Signer mints the URLs clients use to move bytes directly to/from storage.
type Signer interface {
	// SignedPutURL is where the client PUTs the bytes for a not-yet-confirmed object.
	SignedPutURL(key, contentType string) string
	// SignedGetURL is a time-limited URL to read a private object.
	SignedGetURL(key string) string
	// PublicURL is the stable URL of a public object.
	PublicURL(key string) string
}

// ObjectStore is the metadata/lifecycle side: the bytes themselves travel over the signed URLs.
type ObjectStore interface {
	// Stat returns the stored object's size. contentType may be empty (the local backend does not
	// persist it), in which case the caller skips the type check.
	Stat(key string) (size int64, contentType string, err error)
	// Move relocates an object (incoming → assets on confirm).
	Move(srcKey, dstKey string) error
	// Delete removes an object.
	Delete(key string) error
}
