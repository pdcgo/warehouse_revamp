package san_verification

import "testing"

func TestMock_ApprovesOnlyTheMockCode(t *testing.T) {
	otp := NewMockOtpVerification()

	err := otp.Send("+62811")
	if err != nil {
		t.Fatalf("Send must be a no-op, got: %v", err)
	}

	ok, err := otp.Verify(MockOtpCode, "+62811")
	if err != nil || !ok {
		t.Fatalf("Verify(MockOtpCode) = (%v, %v), want (true, nil)", ok, err)
	}

	ok, err = otp.Verify("000000", "+62811")
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}

	if ok {
		t.Error("Verify approved a wrong code")
	}
}

// NewFromConfig falls back to the mock when Twilio is not configured, and only then.
func TestNewFromConfig_FallsBackToMock(t *testing.T) {
	otp := NewFromConfig(nil)

	ok, _ := otp.Verify(MockOtpCode, "x")
	if !ok {
		t.Error("nil config should yield the mock (which accepts MockOtpCode)")
	}

	otp = NewFromConfig(&TwilioConfiguration{}) // empty = not configured
	ok, _ = otp.Verify(MockOtpCode, "x")
	if !ok {
		t.Error("empty config should yield the mock")
	}
}

func TestTwilioConfiguration_configured(t *testing.T) {
	if (&TwilioConfiguration{}).configured() {
		t.Error("empty config must not count as configured")
	}

	full := &TwilioConfiguration{AppID: "a", Token: "t", ServiceID: "s"}
	if !full.configured() {
		t.Error("fully-populated config must count as configured")
	}
}
