package user_v1

import (
	"errors"
	"regexp"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// phoneShape is what a typed phone may look like: digits, spaces, dashes, dots and brackets, and a + only at the start.
var phoneShape = regexp.MustCompile(`^\+?[0-9 ().\-]+$`)

// normalizePhone reads a typed phone into the one form it is stored in — `+`, the country code, the number
// (a-phone-is-saved-in-international-form). "" stays "": a phone is optional.
//
//	0812-3456-7890     → +6281234567890   a leading 0 is Indonesia's trunk prefix
//	+62 812 3456 7890  → +6281234567890
//	62-812-3456-7890   → +6281234567890
//	+1 555 123 4567    → +15551234567
//
// Refused (InvalidArgument): anything but digits and separators, fewer than 8 or more than 15 digits
// (a-phone-has-8-to-15-digits), and a number starting with neither 0, + and a country code, nor 62
// (a-phone-starts-with-0-or-a-country-code) — a guess would send someone's reset code to a stranger.
//
// ⚠ Migration 00008's `user_phone_international` is this function in SQL, for the stored numbers it rewrote once.
// TestNormalizePhone_AgreesWithTheMigration holds the two to the same answers.
func normalizePhone(typed string) (string, error) {
	typed = strings.TrimSpace(typed)
	if typed == "" {
		return "", nil
	}

	if !phoneShape.MatchString(typed) {
		return "", phoneRefused("a phone is digits, with spaces, dashes, dots or brackets, and a + only at the start (a-phone-has-8-to-15-digits)")
	}

	var digits strings.Builder

	for _, r := range typed {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
		}
	}

	d := digits.String()
	if len(d) < 8 || len(d) > 15 {
		return "", phoneRefused("a phone has 8 to 15 digits (a-phone-has-8-to-15-digits)")
	}

	var out string

	switch {
	case strings.HasPrefix(typed, "+") && !strings.HasPrefix(d, "0"):
		out = "+" + d
	case strings.HasPrefix(typed, "+"):
		return "", phoneRefused("no country code starts with 0 — start with 0, or with + and the country code (a-phone-starts-with-0-or-a-country-code)")
	case strings.HasPrefix(d, "0"):
		out = "+62" + d[1:]
	case strings.HasPrefix(d, "62"):
		out = "+" + d
	default:
		return "", phoneRefused("start with 0, or with + and the country code (a-phone-starts-with-0-or-a-country-code)")
	}

	if len(out)-1 > 15 {
		return "", phoneRefused("a phone has 8 to 15 digits with its country code (a-phone-has-8-to-15-digits)")
	}

	return out, nil
}

func phoneRefused(why string) error {
	return connect.NewError(connect.CodeInvalidArgument, errors.New(why))
}

// refuseTakenContact refuses a phone or an email already on ANOTHER account (a-phone-or-email-belongs-to-one-account),
// saying which, so the popup can offer to add that person instead. `phone` is already normalised, `email` lower-cased;
// "" is not checked. The unique indexes stay the guarantee: two saves of one number at the same moment both pass this
// check, and the second is refused by the index (AlreadyExists, without the field named).
func refuseTakenContact(tx *gorm.DB, exceptUserID uint64, email, phone string) error {
	if phone != "" {
		var count int64

		err := tx.
			Model(&user_service_models.User{}).
			Where("phone_number = ? AND id <> ?", phone, exceptUserID).
			Count(&count).
			Error
		if err != nil {
			return err
		}

		if count > 0 {
			return connect.NewError(connect.CodeAlreadyExists,
				errors.New("that phone number is already another account's — add that person instead (a-phone-or-email-belongs-to-one-account)"))
		}
	}

	if email != "" {
		var count int64

		err := tx.
			Model(&user_service_models.User{}).
			Where("email <> '' AND LOWER(email) = ? AND id <> ?", email, exceptUserID).
			Count(&count).
			Error
		if err != nil {
			return err
		}

		if count > 0 {
			return connect.NewError(connect.CodeAlreadyExists,
				errors.New("that email is already another account's — add that person instead (a-phone-or-email-belongs-to-one-account)"))
		}
	}

	return nil
}
