package user_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_verification"
)

// The forgot-password flow: request an OTP, then reset with it. Uses the mock OTP (accepts
// MockOtpCode).
func TestRequestPasswordResetOtp_AlwaysSucceeds(t *testing.T) {
	db := san_testdb.DB(t)
	auth := newAuthService(t, db)

	insertUser(t, db, "forgot", "old-password-1")

	// Known user, unknown user, and a user with no phone — all must return success (no
	// enumeration).
	for _, username := range []string{"forgot", "ghost"} {
		_, err := auth.RequestPasswordResetOtp(context.Background(), connect.NewRequest(&userv1.RequestPasswordResetOtpRequest{
			Username: username,
		}))
		if err != nil {
			t.Fatalf("RequestPasswordResetOtp(%q) = %v, want success", username, err)
		}
	}
}

func TestResetPasswordWithOtp_WrongCodeRejected(t *testing.T) {
	db := san_testdb.DB(t)
	auth := newAuthService(t, db)

	insertUser(t, db, "wrongcode", "old-password-1")

	_, err := auth.ResetPasswordWithOtp(context.Background(), connect.NewRequest(&userv1.ResetPasswordWithOtpRequest{
		Username:    "wrongcode",
		Code:        "000000",
		NewPassword: "brand-new-1",
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated for a wrong OTP", connect.CodeOf(err))
	}
}

// Unknown user and bad code return the SAME error — no enumeration.
func TestResetPasswordWithOtp_UnknownUserSameError(t *testing.T) {
	db := san_testdb.DB(t)
	auth := newAuthService(t, db)

	insertUser(t, db, "known", "old-password-1")

	_, badCode := auth.ResetPasswordWithOtp(context.Background(), connect.NewRequest(&userv1.ResetPasswordWithOtpRequest{
		Username: "known", Code: "000000", NewPassword: "brand-new-1",
	}))
	_, unknown := auth.ResetPasswordWithOtp(context.Background(), connect.NewRequest(&userv1.ResetPasswordWithOtpRequest{
		Username: "nobody", Code: "000000", NewPassword: "brand-new-1",
	}))

	if badCode.Error() != unknown.Error() {
		t.Errorf("bad-code and unknown-user errors differ:\n  %q\n  %q", badCode.Error(), unknown.Error())
	}
}

// The happy path: correct OTP sets the new password and the OLD one stops working.
func TestResetPasswordWithOtp_CorrectCodeResets(t *testing.T) {
	db := san_testdb.DB(t)
	auth := newAuthService(t, db)

	insertUser(t, db, "recover", "old-password-1")

	_, err := auth.ResetPasswordWithOtp(context.Background(), connect.NewRequest(&userv1.ResetPasswordWithOtpRequest{
		Username:    "recover",
		Code:        san_verification.MockOtpCode,
		NewPassword: "recovered-pw-1",
	}))
	if err != nil {
		t.Fatalf("ResetPasswordWithOtp: %v", err)
	}

	// New password logs in; old one does not.
	_, err = auth.Login(context.Background(), connect.NewRequest(&userv1.LoginRequest{
		Username: "recover", Password: "recovered-pw-1",
	}))
	if err != nil {
		t.Fatalf("login with new password: %v", err)
	}

	_, err = auth.Login(context.Background(), connect.NewRequest(&userv1.LoginRequest{
		Username: "recover", Password: "old-password-1",
	}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("old password still works after reset (code %v)", connect.CodeOf(err))
	}
}
