package san_verification

import (
	"github.com/twilio/twilio-go"
	verify "github.com/twilio/twilio-go/rest/verify/v2"
)

// TwilioConfiguration carries the Twilio Verify credentials. The env tags line up with
// backend/pkgs/san_config, so it loads the same layered way as the rest of the config.
type TwilioConfiguration struct {
	AppID     string `env:"TWILIO_APP_ID" yaml:"app_id"`
	Token     string `env:"TWILIO_TOKEN" yaml:"token"`
	ServiceID string `env:"TWILIO_SERVICE_ID" yaml:"service_id"`
}

// configured reports whether enough is set to talk to Twilio. Used by NewFromConfig to fall
// back to the mock in dev.
func (c *TwilioConfiguration) configured() bool {
	return c.AppID != "" && c.Token != "" && c.ServiceID != ""
}

type twilioVerification struct {
	cfg *TwilioConfiguration
}

// NewTwilioOtpVerification uses Twilio's Verify service, which generates, stores, and expires the
// code on Twilio's side — so this process never holds a raw OTP.
func NewTwilioOtpVerification(cfg *TwilioConfiguration) OtpVerification {
	return &twilioVerification{cfg: cfg}
}

func (t *twilioVerification) client() *twilio.RestClient {
	return twilio.NewRestClientWithParams(twilio.ClientParams{
		Username: t.cfg.AppID,
		Password: t.cfg.Token,
	})
}

// Send implements [OtpVerification] — asks Twilio to SMS a fresh code to phone.
func (t *twilioVerification) Send(phone string) error {
	params := &verify.CreateVerificationParams{}
	params.SetChannel("sms")
	params.SetTo(phone)

	_, err := t.client().VerifyV2.CreateVerification(t.cfg.ServiceID, params)

	return err
}

// Verify implements [OtpVerification] — checks code against Twilio's record for phone.
func (t *twilioVerification) Verify(code, phone string) (bool, error) {
	params := &verify.CreateVerificationCheckParams{}
	params.SetTo(phone)
	params.SetCode(code)

	resp, err := t.client().VerifyV2.CreateVerificationCheck(t.cfg.ServiceID, params)
	if err != nil {
		return false, err
	}

	// A nil or non-"approved" status is a rejection, not an error — the user simply typed the
	// wrong code.
	return resp.Status != nil && *resp.Status == "approved", nil
}

// NewFromConfig picks the backend: Twilio when it is fully configured, otherwise the mock.
//
// This is the one place that decides mock-vs-real, so a missing Twilio config in production
// surfaces as "the mock code works" — which the caller should guard against by requiring Twilio
// config in the production profile.
func NewFromConfig(cfg *TwilioConfiguration) OtpVerification {
	if cfg != nil && cfg.configured() {
		return NewTwilioOtpVerification(cfg)
	}

	return NewMockOtpVerification()
}
