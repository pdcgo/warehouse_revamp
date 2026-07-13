package san_caches

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	event_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/event_base/v1"
)

// managers returns every implementation worth conformance-testing. Redis joins in only when
// REDIS_ADDR points at a live server (docker compose up -d), so the suite stays green on a
// laptop with no broker.
func managers(t *testing.T) map[string]CacheManager {
	t.Helper()

	all := map[string]CacheManager{
		"memory": NewMemoryCacheManager(),
	}

	addr := os.Getenv("REDIS_ADDR")
	if addr == "" {
		return all
	}

	client := redis.NewClient(&redis.Options{Addr: addr})

	err := client.Ping(context.Background()).Err()
	if err != nil {
		t.Logf("REDIS_ADDR=%s is set but unreachable (%v) — skipping the redis conformance run", addr, err)

		return all
	}

	client.FlushDB(context.Background())

	all["redis"] = NewRedisCacheManager(client)

	return all
}

func TestConformance(t *testing.T) {
	ctx := context.Background()

	for name, manager := range managers(t) {
		t.Run(name, func(t *testing.T) {
			t.Run("scalar roundtrip", func(t *testing.T) {
				key := StringKey(name + ":scalar")

				err := manager.Set(ctx, key, uint(9), time.Minute)
				if err != nil {
					t.Fatalf("Set: %v", err)
				}

				var got uint

				err = manager.Get(ctx, key, &got)
				if err != nil {
					t.Fatalf("Get: %v", err)
				}

				if got != 9 {
					t.Errorf("got %d, want 9", got)
				}
			})

			t.Run("proto roundtrip", func(t *testing.T) {
				key := StringKey(name + ":proto")

				err := manager.Set(ctx, key, &event_basev1.HelloExampleEvent{Name: "warehouse"}, time.Minute)
				if err != nil {
					t.Fatalf("Set: %v", err)
				}

				got := &event_basev1.HelloExampleEvent{}

				err = manager.Get(ctx, key, got)
				if err != nil {
					t.Fatalf("Get: %v", err)
				}

				if got.GetName() != "warehouse" {
					t.Errorf("got %q, want warehouse", got.GetName())
				}
			})

			t.Run("miss returns ErrCacheMiss", func(t *testing.T) {
				var got uint

				err := manager.Get(ctx, StringKey(name+":absent"), &got)
				if !errors.Is(err, ErrCacheMiss) {
					t.Fatalf("Get on an absent key = %v, want ErrCacheMiss — callers must be able to tell a miss from an outage", err)
				}
			})

			t.Run("del", func(t *testing.T) {
				key := StringKey(name + ":del")

				err := manager.Set(ctx, key, uint(1), time.Minute)
				if err != nil {
					t.Fatalf("Set: %v", err)
				}

				err = manager.Del(ctx, key)
				if err != nil {
					t.Fatalf("Del: %v", err)
				}

				var got uint

				err = manager.Get(ctx, key, &got)
				if !errors.Is(err, ErrCacheMiss) {
					t.Errorf("after Del, Get = %v, want ErrCacheMiss", err)
				}
			})

			// The trap the namespace design hinges on: a prefix is matched LITERALLY, so
			// evicting "role:1" would also nuke "role:11" unless the caller delimits.
			t.Run("DelNamespace matches a literal prefix", func(t *testing.T) {
				delimited := StringKey(name + ":role:1:")
				sibling := StringKey(name + ":role:11:")

				err := manager.Set(ctx, delimited, uint(1), time.Minute)
				if err != nil {
					t.Fatalf("Set: %v", err)
				}

				err = manager.Set(ctx, sibling, uint(11), time.Minute)
				if err != nil {
					t.Fatalf("Set: %v", err)
				}

				err = manager.DelNamespace(ctx, name+":role:1:")
				if err != nil {
					t.Fatalf("DelNamespace: %v", err)
				}

				var got uint

				err = manager.Get(ctx, delimited, &got)
				if !errors.Is(err, ErrCacheMiss) {
					t.Errorf("the namespaced key survived DelNamespace: %v", err)
				}

				// user 11 must be untouched — this is exactly why the namespace ends in ":".
				err = manager.Get(ctx, sibling, &got)
				if err != nil {
					t.Fatalf("DelNamespace(%q) also evicted %q — the delimiter did not protect it: %v",
						name+":role:1:", sibling, err)
				}

				if got != 11 {
					t.Errorf("sibling = %d, want 11", got)
				}
			})
		})
	}
}

func TestMemoryTTLExpiry(t *testing.T) {
	ctx := context.Background()
	manager := NewMemoryCacheManager()
	key := StringKey("ttl")

	err := manager.Set(ctx, key, uint(1), 20*time.Millisecond)
	if err != nil {
		t.Fatalf("Set: %v", err)
	}

	var got uint

	err = manager.Get(ctx, key, &got)
	if err != nil {
		t.Fatalf("Get before expiry: %v", err)
	}

	time.Sleep(40 * time.Millisecond)

	err = manager.Get(ctx, key, &got)
	if !errors.Is(err, ErrCacheMiss) {
		t.Errorf("Get after the TTL lapsed = %v, want ErrCacheMiss", err)
	}
}

func TestSkipManagerAlwaysMisses(t *testing.T) {
	ctx := context.Background()
	manager := NewSkipCacheManager()
	key := StringKey("anything")

	err := manager.Set(ctx, key, uint(1), time.Minute)
	if err != nil {
		t.Fatalf("Set must be a silent no-op, got: %v", err)
	}

	var got uint

	err = manager.Get(ctx, key, &got)
	if !errors.Is(err, ErrCacheMiss) {
		t.Errorf("Get = %v, want ErrCacheMiss — the skip cache must never return a value", err)
	}
}
