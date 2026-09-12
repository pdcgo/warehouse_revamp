package user_v1_test

import (
	"testing"

	"buf.build/go/protovalidate"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
)

// CreateUser's username must be LOWERCASE ALPHANUMERIC (#87). The rule lives on the proto
// (buf.validate pattern ^[a-z0-9]+$) and is enforced by the protovalidate interceptor before any
// handler runs — this asserts the contract directly, so the backend gate can't silently regress.
func TestCreateUserRequest_UsernameLowercaseAlnum(t *testing.T) {
	v, err := protovalidate.New()
	if err != nil {
		t.Fatalf("protovalidate.New: %v", err)
	}

	// Only username varies; password is the other constrained field.
	req := func(username string) *userv1.CreateUserRequest {
		return &userv1.CreateUserRequest{Username: username, Password: "password1"}
	}

	for _, ok := range []string{"john", "john123", "abc", "user2024"} {
		if err := v.Validate(req(ok)); err != nil {
			t.Errorf("valid username %q rejected: %v", ok, err)
		}
	}

	for _, bad := range []string{"John", "JOHN", "john_doe", "john doe", "john!", "jöhn", "a b"} {
		if err := v.Validate(req(bad)); err == nil {
			t.Errorf("invalid username %q was accepted, want rejected", bad)
		}
	}
}
