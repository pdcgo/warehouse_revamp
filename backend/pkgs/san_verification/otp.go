// Package san_verification is a small OTP (one-time-code) abstraction: send a code to a phone,
// then verify what the user typed. It has a mock for dev/tests and a Twilio backend for
// production, behind one interface so callers never know which is in play.
package san_verification

// OtpVerification sends a one-time code to a phone and checks a code the user submitted.
//
// The code itself is never handled by the caller — where it is generated, stored, and how long
// it lives is the implementation's concern (Twilio's Verify service holds it server-side; the
// mock hard-codes it). That keeps callers out of the business of storing raw codes.
type OtpVerification interface {
	// Send delivers a fresh code to the phone (e.g. by SMS).
	Send(phone string) error

	// Verify reports whether code is the one currently valid for phone.
	Verify(code, phone string) (bool, error)
}
