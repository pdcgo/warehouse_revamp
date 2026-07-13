package san_caches

import (
	"context"
	"time"
)

type skipCacheManager struct{}

// NewSkipCacheManager caches nothing: every Get is a miss. Use it to take the cache out of
// the picture — in a test that must observe every underlying read, or to rule the cache out
// while debugging a staleness bug.
func NewSkipCacheManager() CacheManager {
	return &skipCacheManager{}
}

func (s *skipCacheManager) Set(_ context.Context, _ CacheKey, _ any, _ time.Duration) error {
	return nil
}

func (s *skipCacheManager) Get(_ context.Context, _ CacheKey, _ any) error {
	return ErrCacheMiss
}

func (s *skipCacheManager) Del(_ context.Context, _ CacheKey) error {
	return nil
}

func (s *skipCacheManager) DelNamespace(_ context.Context, _ string) error {
	return nil
}
