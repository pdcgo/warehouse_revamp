package user_v1_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// recordingOtp records the phone Send was asked to text. Verify is unused by
// RequestPasswordResetOtp, so it just refuses everything.
type recordingOtp struct {
	sentTo []string
	err    error
}

func (r *recordingOtp) Send(phone string) error {
	r.sentTo = append(r.sentTo, phone)

	return r.err
}

func (r *recordingOtp) Verify(string, string) (bool, error) {
	return false, nil
}

// A user WITH a phone gets a code sent to exactly that number.
func TestRequestPasswordResetOtp_SendsToPhone(t *testing.T) {
	db := san_testdb.DB(t)

	otp := &recordingOtp{}
	auth := newAuthServiceWithOtp(t, db, otp)

	insertUser(t, db, "haphone", "old-password-1")

	err := db.Exec(
		"UPDATE users SET phone_number = ? WHERE LOWER(username) = ?",
		"+15551230000", "haphone",
	).Error
	if err != nil {
		t.Fatalf("set phone: %v", err)
	}

	_, err = auth.RequestPasswordResetOtp(context.Background(), connect.NewRequest(&userv1.RequestPasswordResetOtpRequest{
		Username: "haphone",
	}))
	if err != nil {
		t.Fatalf("RequestPasswordResetOtp: %v", err)
	}

	if len(otp.sentTo) != 1 || otp.sentTo[0] != "+15551230000" {
		t.Fatalf("Send called with %v, want exactly [+15551230000]", otp.sentTo)
	}
}

// A user with NO phone is a silent no-op: success, and nothing sent (not having a phone is not
// the caller's to learn).
func TestRequestPasswordResetOtp_NoPhoneSendsNothing(t *testing.T) {
	db := san_testdb.DB(t)

	otp := &recordingOtp{}
	auth := newAuthServiceWithOtp(t, db, otp)

	insertUser(t, db, "nophone", "old-password-1")

	_, err := auth.RequestPasswordResetOtp(context.Background(), connect.NewRequest(&userv1.RequestPasswordResetOtpRequest{
		Username: "nophone",
	}))
	if err != nil {
		t.Fatalf("RequestPasswordResetOtp: %v", err)
	}

	if len(otp.sentTo) != 0 {
		t.Fatalf("Send called %v times for a user with no phone, want 0", otp.sentTo)
	}
}

// A provider failure IS surfaced (CodeInternal) — it leaks nothing about the account, unlike an
// unknown user or a missing phone, which stay silent.
func TestRequestPasswordResetOtp_SendFailureSurfaces(t *testing.T) {
	db := san_testdb.DB(t)

	otp := &recordingOtp{err: errors.New("provider down")}
	auth := newAuthServiceWithOtp(t, db, otp)

	insertUser(t, db, "sendfail", "old-password-1")

	err := db.Exec(
		"UPDATE users SET phone_number = ? WHERE LOWER(username) = ?",
		"+15559999999", "sendfail",
	).Error
	if err != nil {
		t.Fatalf("set phone: %v", err)
	}

	_, err = auth.RequestPasswordResetOtp(context.Background(), connect.NewRequest(&userv1.RequestPasswordResetOtpRequest{
		Username: "sendfail",
	}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("code = %v, want Internal when the OTP provider fails", connect.CodeOf(err))
	}
}
