// Package san_caches is a small cache abstraction with three implementations: Redis
// (production), in-memory (single process), and a no-op (tests / cache disabled).
//
// Every read returns [ErrCacheMiss] on a miss, so a caller can tell "not cached" apart from
// "the cache is broken" — a distinction the caller usually wants, since the first is normal
// and the second is worth alerting on.
package san_caches

import (
	"context"
	"errors"
	"time"
)

// ErrCacheMiss is returned by Get when the key is absent or expired. Anything else Get
// returns is a real failure (network, serialisation, a dead Redis).
var ErrCacheMiss = errors.New("san_caches: cache miss")

// CacheKey builds its own key string, so a caller passes a typed key rather than an
// ad-hoc fmt.Sprintf that drifts between the read and the write path.
type CacheKey interface {
	GetKey() (string, error)
}

// StringKey is a CacheKey for keys that are already strings.
type StringKey string

func (k StringKey) GetKey() (string, error) {
	return string(k), nil
}

type CacheManager interface {
	Set(ctx context.Context, key CacheKey, value any, ttl time.Duration) error

	// Get decodes the cached value into value (a pointer). It returns [ErrCacheMiss] when
	// the key is absent or expired.
	Get(ctx context.Context, key CacheKey, value any) error

	Del(ctx context.Context, key CacheKey) error

	// DelNamespace deletes every key with the given PREFIX.
	//
	// The prefix is matched literally, so namespaces must be delimited by the caller:
	// "user:role:1" would also match "user:role:11". End the namespace with a separator
	// ("user:role:1:") to mean what you think it means.
	DelNamespace(ctx context.Context, namespace string) error
}
