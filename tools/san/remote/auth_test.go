package remote

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

func TestMintTokenIsFreshEveryTime(t *testing.T) {
	now := time.Now()

	first, err := MintToken(0, now)
	if err != nil {
		t.Fatal(err)
	}

	second, err := MintToken(0, now)
	if err != nil {
		t.Fatal(err)
	}

	if first.Value() == second.Value() {
		t.Fatal("two mints produced the same token — the per-run guarantee is the whole design")
	}

	// 32 random bytes, base64url without padding.
	if len(first.Value()) < 40 {
		t.Fatalf("token is only %d characters — too short to be 256 bits", len(first.Value()))
	}
}

func TestTokenVerify(t *testing.T) {
	now := time.Now()
	token := NewToken("correct-horse", 0, now)

	err := token.Verify("correct-horse", now)
	if err != nil {
		t.Fatalf("the right token was refused: %v", err)
	}

	err = token.Verify("wrong", now)
	if err == nil {
		t.Fatal("a wrong token was accepted")
	}

	err = token.Verify("", now)
	if err == nil {
		t.Fatal("an empty token was accepted")
	}
}

// A zero TTL must mean "as long as the process", not "already expired".
func TestTokenWithoutTTLNeverExpires(t *testing.T) {
	now := time.Now()
	token := NewToken("value", 0, now)

	err := token.Verify("value", now.Add(1000*time.Hour))
	if err != nil {
		t.Fatalf("a no-TTL token expired: %v", err)
	}
}

func TestTokenExpires(t *testing.T) {
	now := time.Now()
	token := NewToken("value", time.Hour, now)

	err := token.Verify("value", now.Add(30*time.Minute))
	if err != nil {
		t.Fatalf("token refused while still valid: %v", err)
	}

	err = token.Verify("value", now.Add(2*time.Hour))
	if err != ErrTokenExpired {
		t.Fatalf("err = %v, want ErrTokenExpired", err)
	}
}

// The UNARY path.
func TestInfoRequiresAToken(t *testing.T) {
	h := newHarness(t, nil)

	_, err := h.unauthenticated("").Info(context.Background(), connect.NewRequest(&remotev1.InfoRequest{}))
	if err == nil {
		t.Fatal("Info served with no token")
	}

	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated", connect.CodeOf(err))
	}
}

// The STREAMING path — the one that matters, and the one the warehouse's own interceptor cannot
// guard. If this ever regresses, an unauthenticated caller gets a shell.
func TestExecRequiresAToken(t *testing.T) {
	h := newHarness(t, nil)

	_, err := execWith(t, h.unauthenticated(""), &remotev1.ExecRequest{Command: "echo hello"})
	if err == nil {
		t.Fatal("Exec served with no token — an unauthenticated caller had a shell")
	}

	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated", connect.CodeOf(err))
	}
}

func TestExecRefusesTheWrongToken(t *testing.T) {
	h := newHarness(t, nil)

	_, err := execWith(t, h.unauthenticated("not-the-token"), &remotev1.ExecRequest{Command: "echo hello"})
	if err == nil {
		t.Fatal("Exec served to a caller holding the wrong token")
	}

	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated", connect.CodeOf(err))
	}
}

// A raw token with no "Bearer " scheme must NOT be accepted — san_auth.BearerToken exists
// precisely because the naive TrimPrefix version silently allowed it.
func TestUnschemedAuthorizationHeaderIsRefused(t *testing.T) {
	h := newHarness(t, nil)

	client := h.unauthenticated("")

	req := connect.NewRequest(&remotev1.InfoRequest{})
	req.Header().Set("Authorization", testToken)

	_, err := client.Info(context.Background(), req)
	if err == nil {
		t.Fatal("a bare token with no Bearer scheme was accepted")
	}

	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated", connect.CodeOf(err))
	}
}
