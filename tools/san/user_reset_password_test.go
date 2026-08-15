package main

import (
	"context"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
)

// newTestSan builds the tool against the test transaction — the same object withSan hands a
// command, minus Wire (which would open its own pool and escape the rollback).
//
// The team client is nil on purpose: it exists only to complete user_service's construction, and
// a test that passes a fake would be claiming the reset path calls it. It does not.
func newTestSan(t *testing.T, db *gorm.DB) *San {
	t.Helper()

	resolver := access_interceptors.NewDBRoleResolver(db, san_caches.NewSkipCacheManager())
	users := user_v1.NewService(db, san_auth.NewSigner("test-secret", time.Hour), resolver, nil, san_caches.NewSkipCacheManager())

	return &San{db: db, users: users, target: "test"}
}

func insertUser(t *testing.T, db *gorm.DB, username, email, password string) *user_service_models.User {
	t.Helper()

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}

	user := user_service_models.User{Username: username, Email: email, Password: string(hash)}

	err = db.Create(&user).Error
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	return &user
}

func reload(t *testing.T, db *gorm.DB, id uint64) *user_service_models.User {
	t.Helper()

	var user user_service_models.User

	err := db.Where("id = ?", id).First(&user).Error
	if err != nil {
		t.Fatalf("reload user: %v", err)
	}

	return &user
}

func TestResetUserPasswordByUsername(t *testing.T) {
	db := san_testdb.DB(t)
	san := newTestSan(t, db)

	user := insertUser(t, db, "ani", "ani@x.local", "oldpassword")

	got, err := san.ResetUserPassword(context.Background(), userSelector{username: "ani"}, "newpassword")
	if err != nil {
		t.Fatalf("reset: %v", err)
	}

	if got.ID != user.ID {
		t.Fatalf("reset the wrong account: got %d, want %d", got.ID, user.ID)
	}

	fresh := reload(t, db, user.ID)

	err = bcrypt.CompareHashAndPassword([]byte(fresh.Password), []byte("newpassword"))
	if err != nil {
		t.Fatalf("the new password does not match the stored hash: %v", err)
	}

	// The stamp is the half of the reset a hand-written UPDATE would miss: without it the
	// account's existing tokens keep working after an operator has "locked it down".
	if fresh.LastPasswordReset == nil {
		t.Fatal("last_password_reset was not stamped — existing tokens would survive the reset")
	}
}

func TestResetUserPasswordByEmailIsCaseInsensitive(t *testing.T) {
	db := san_testdb.DB(t)
	san := newTestSan(t, db)

	user := insertUser(t, db, "budi", "budi@x.local", "oldpassword")

	got, err := san.ResetUserPassword(context.Background(), userSelector{email: "  BUDI@X.Local "}, "newpassword")
	if err != nil {
		t.Fatalf("reset by email: %v", err)
	}

	if got.ID != user.ID {
		t.Fatalf("got user %d, want %d", got.ID, user.ID)
	}
}

func TestResetUserPasswordUnknownAccount(t *testing.T) {
	db := san_testdb.DB(t)
	san := newTestSan(t, db)

	_, err := san.ResetUserPassword(context.Background(), userSelector{username: "nobody"}, "newpassword")
	if err == nil {
		t.Fatal("expected an error for an account that does not exist")
	}
}

// A CLI call bypasses the validation interceptor, so the proto's own minimum has to be enforced
// by the command. If this ever passes, `san` can set a password the API would refuse.
func TestResetUserPasswordRejectsShortPassword(t *testing.T) {
	db := san_testdb.DB(t)
	san := newTestSan(t, db)

	user := insertUser(t, db, "citra", "citra@x.local", "oldpassword")

	_, err := san.ResetUserPassword(context.Background(), userSelector{username: "citra"}, "short")
	if err == nil {
		t.Fatal("expected a validation error for a 5-character password")
	}

	fresh := reload(t, db, user.ID)

	err = bcrypt.CompareHashAndPassword([]byte(fresh.Password), []byte("oldpassword"))
	if err != nil {
		t.Fatalf("a rejected reset still wrote to the row: %v", err)
	}
}

func TestNewUserSelector(t *testing.T) {
	tests := []struct {
		name     string
		id       uint64
		username string
		email    string
		wantErr  bool
	}{
		{name: "username only", username: "ani"},
		{name: "email only", email: "ani@x.local"},
		{name: "id only", id: 7},
		{name: "nothing given", wantErr: true},
		{name: "whitespace is not an identifier", username: "   ", wantErr: true},
		// Two identifiers is where a script resets the wrong account, so it is refused rather
		// than resolved by precedence.
		{name: "id and username", id: 7, username: "ani", wantErr: true},
		{name: "username and email", username: "ani", email: "ani@x.local", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := newUserSelector(tc.id, tc.username, tc.email)

			if tc.wantErr && err == nil {
				t.Fatal("expected an error")
			}

			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}
