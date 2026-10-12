package remote

import (
	"context"
	"runtime"
	"testing"
	"time"

	"connectrpc.com/connect"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

func TestInfoDescribesTheServer(t *testing.T) {
	h := newHarness(t, nil)

	resp, err := h.client.Info(context.Background(), connect.NewRequest(&remotev1.InfoRequest{}))
	if err != nil {
		t.Fatalf("Info: %v", err)
	}

	info := resp.Msg

	if info.GetWorkspaceRoot() != h.root {
		t.Fatalf("workspace_root = %q, want %q", info.GetWorkspaceRoot(), h.root)
	}

	if len(info.GetShell()) == 0 {
		t.Fatal("no shell reported — a caller cannot know which syntax to write")
	}

	if info.GetOs() != runtime.GOOS {
		t.Fatalf("os = %q, want %q", info.GetOs(), runtime.GOOS)
	}

	if info.GetDefaultTimeoutSeconds() != 30 {
		t.Fatalf("default_timeout_seconds = %d, want 30", info.GetDefaultTimeoutSeconds())
	}

	if info.GetMaxTimeoutSeconds() != 60 {
		t.Fatalf("max_timeout_seconds = %d, want 60", info.GetMaxTimeoutSeconds())
	}
}

// An unset expiry means "lives as long as the server", and must stay UNSET rather than becoming
// a zero timestamp a caller would read as 1970 — i.e. as already expired.
func TestInfoLeavesExpiryUnsetWhenTheTokenDoesNotExpire(t *testing.T) {
	h := newHarness(t, nil)

	resp, err := h.client.Info(context.Background(), connect.NewRequest(&remotev1.InfoRequest{}))
	if err != nil {
		t.Fatalf("Info: %v", err)
	}

	if resp.Msg.GetTokenExpiresAt() != nil {
		t.Fatalf("token_expires_at = %v, want unset", resp.Msg.GetTokenExpiresAt())
	}
}

func TestInfoReportsTokenExpiry(t *testing.T) {
	expiry := time.Now().Add(2 * time.Hour).Truncate(time.Second)

	h := newHarness(t, func(cfg *Config) {
		cfg.TokenExpiresAt = expiry
	})

	resp, err := h.client.Info(context.Background(), connect.NewRequest(&remotev1.InfoRequest{}))
	if err != nil {
		t.Fatalf("Info: %v", err)
	}

	got := resp.Msg.GetTokenExpiresAt()
	if got == nil {
		t.Fatal("token_expires_at unset — an agent cannot renew before it is cut off")
	}

	if !got.AsTime().Equal(expiry) {
		t.Fatalf("token_expires_at = %s, want %s", got.AsTime(), expiry)
	}
}
