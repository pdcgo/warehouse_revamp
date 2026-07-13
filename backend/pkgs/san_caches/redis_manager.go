package san_caches

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

const scanBatch = 200

type redisCacheManager struct {
	client *redis.Client
}

// NewRedisCacheManager is the production cache: shared across every process, so an eviction
// on one instance is seen by all of them.
func NewRedisCacheManager(client *redis.Client) CacheManager {
	return &redisCacheManager{client: client}
}

func (m *redisCacheManager) Set(ctx context.Context, key CacheKey, value any, ttl time.Duration) error {
	keyStr, err := key.GetKey()
	if err != nil {
		return err
	}

	data, err := encode(value)
	if err != nil {
		return err
	}

	return m.client.Set(ctx, keyStr, data, ttl).Err()
}

func (m *redisCacheManager) Get(ctx context.Context, key CacheKey, value any) error {
	keyStr, err := key.GetKey()
	if err != nil {
		return err
	}

	data, err := m.client.Get(ctx, keyStr).Bytes()
	if err != nil {
		// Translate redis's own miss sentinel into ours, so callers never import go-redis
		// just to recognise a miss.
		if errors.Is(err, redis.Nil) {
			return ErrCacheMiss
		}

		return err
	}

	return decode(data, value)
}

func (m *redisCacheManager) Del(ctx context.Context, key CacheKey) error {
	keyStr, err := key.GetKey()
	if err != nil {
		return err
	}

	return m.client.Del(ctx, keyStr).Err()
}

// DelNamespace SCANs the keyspace by prefix and deletes in batches.
//
// This is O(keyspace), not O(matches) — SCAN walks everything and filters. It is fine for the
// occasional eviction (a logout, a role change) and NOT fine on a hot path.
func (m *redisCacheManager) DelNamespace(ctx context.Context, namespace string) error {
	pattern := namespace + "*"

	var cursor uint64

	for {
		keys, next, err := m.client.Scan(ctx, cursor, pattern, scanBatch).Result()
		if err != nil {
			return err
		}

		if len(keys) > 0 {
			err = m.client.Del(ctx, keys...).Err()
			if err != nil {
				return err
			}
		}

		cursor = next
		if cursor == 0 {
			return nil
		}
	}
}
