package san_caches

import (
	"context"
	"strings"
	"sync"
	"time"
)

type memoryEntry struct {
	data      []byte
	expiresAt time.Time
}

type memoryCacheManager struct {
	mu      sync.RWMutex
	entries map[string]memoryEntry
}

// NewMemoryCacheManager caches in-process. Use it for local development and tests, so a
// single binary needs no Redis.
//
// ⚠ NOT safe for a multi-instance deployment. Eviction is per-process: revoke a permission on
// instance A and instance B keeps serving the stale value until its own TTL lapses. Anything
// whose freshness is a correctness property (authorization, most obviously) must use Redis in
// production.
func NewMemoryCacheManager() CacheManager {
	return &memoryCacheManager{entries: map[string]memoryEntry{}}
}

func (m *memoryCacheManager) Set(_ context.Context, key CacheKey, value any, ttl time.Duration) error {
	keyStr, err := key.GetKey()
	if err != nil {
		return err
	}

	data, err := encode(value)
	if err != nil {
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	m.entries[keyStr] = memoryEntry{data: data, expiresAt: time.Now().Add(ttl)}

	return nil
}

func (m *memoryCacheManager) Get(_ context.Context, key CacheKey, value any) error {
	keyStr, err := key.GetKey()
	if err != nil {
		return err
	}

	m.mu.RLock()
	entry, found := m.entries[keyStr]
	m.mu.RUnlock()

	if !found {
		return ErrCacheMiss
	}

	if time.Now().After(entry.expiresAt) {
		// Expired. Drop it so the map does not grow without bound — there is no background
		// reaper, so eviction happens lazily, on read.
		m.mu.Lock()
		delete(m.entries, keyStr)
		m.mu.Unlock()

		return ErrCacheMiss
	}

	return decode(entry.data, value)
}

func (m *memoryCacheManager) Del(_ context.Context, key CacheKey) error {
	keyStr, err := key.GetKey()
	if err != nil {
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	delete(m.entries, keyStr)

	return nil
}

func (m *memoryCacheManager) DelNamespace(_ context.Context, namespace string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for key := range m.entries {
		if strings.HasPrefix(key, namespace) {
			delete(m.entries, key)
		}
	}

	return nil
}
