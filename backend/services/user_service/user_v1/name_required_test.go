package user_v1_test

import (
	"testing"

	"buf.build/go/protovalidate"
	"google.golang.org/protobuf/proto"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
)

// only-name-and-username-are-required: a name is never blank — not at create, and not by an edit, your own or an
// admin's. The rule is on the contract, so the validation interceptor enforces it for every caller.
func TestTheNameIsNeverBlank(t *testing.T) {
	name := func(s string) *string { return &s }

	cases := []struct {
		what  string
		req   proto.Message
		valid bool
	}{
		{"create, named", &userv1.CreateUserRequest{Username: "ani", Password: "password123", Name: "Ani"}, true},
		{"create, no name", &userv1.CreateUserRequest{Username: "ani", Password: "password123"}, false},
		{"create, only spaces", &userv1.CreateUserRequest{Username: "ani", Password: "password123", Name: "   "}, false},
		{"edit, renamed", &userv1.UpdateUserRequest{UserId: 7, Name: name("Ani Lestari")}, true},
		{"edit, name left alone", &userv1.UpdateUserRequest{UserId: 7}, true},
		{"edit, blanked", &userv1.UpdateUserRequest{UserId: 7, Name: name("")}, false},
		{"your own, blanked", &userv1.UpdateProfileRequest{Name: name(" ")}, false},
		{"your own, renamed", &userv1.UpdateProfileRequest{Name: name("Ani")}, true},
	}

	for _, c := range cases {
		err := protovalidate.Validate(c.req)

		if c.valid && err != nil {
			t.Errorf("%s: refused — %v", c.what, err)
		}

		if !c.valid && err == nil {
			t.Errorf("%s: accepted, want refused", c.what)
		}
	}
}
