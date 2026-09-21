package san_verification

// MockOtpCode is the one code the mock accepts, so local dev and tests can drive the OTP flow
// end to end without sending real SMS.
const MockOtpCode = "123456"

type mockOtpVerification struct{}

// NewMockOtpVerification returns an OtpVerification that contacts no SMS provider: Send is a
// no-op and Verify approves only MockOtpCode.
//
// ⚠ It approves the SAME fixed code for everyone. It exists for dev and tests and must never be
// wired in production — that is a factory decision (see NewFromConfig).
func NewMockOtpVerification() OtpVerification {
	return &mockOtpVerification{}
}

// Send implements [OtpVerification] — a no-op; no SMS is sent.
func (m *mockOtpVerification) Send(_ string) error {
	return nil
}

// Verify implements [OtpVerification] — approves only MockOtpCode, regardless of phone.
func (m *mockOtpVerification) Verify(code, _ string) (bool, error) {
	return code == MockOtpCode, nil
}
