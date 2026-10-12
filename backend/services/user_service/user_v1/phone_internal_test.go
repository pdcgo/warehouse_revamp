package user_v1

import (
	"database/sql"
	"testing"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// Every way a phone is typed, and what it is stored as ("" with refused = true: InvalidArgument).
var phoneCases = []struct {
	typed   string
	stored  string
	refused bool
}{
	// a-phone-is-saved-in-international-form — one number, however it is written
	{"0812-3456-7890", "+6281234567890", false},
	{"0812 3456 7890", "+6281234567890", false},
	{"+62 812 3456 7890", "+6281234567890", false},
	{"+62 (812) 3456-7890", "+6281234567890", false},
	{"62-812-3456-7890", "+6281234567890", false},
	{"6281234567890", "+6281234567890", false},
	{"  0812.3456.7890  ", "+6281234567890", false},
	{"+1 555 123 4567", "+15551234567", false},
	{"021-1234567", "+62211234567", false}, // a Jakarta landline, 10 digits
	{"", "", false},                        // a phone is optional

	// a-phone-has-8-to-15-digits
	{"0811", "", true},
	{"abc", "", true},
	{"0812-3456-7890 ext 2", "", true},
	{"0812+3456", "", true},         // a + only at the start
	{"+1234567890123456", "", true}, // 16 digits
	{"0123456789012345", "", true},  // 16 digits
	{"012345678901234", "", true},   // 15 typed, 16 once +62 replaces the 0
	{"1234567", "", true},           // 7 digits

	// a-phone-starts-with-0-or-a-country-code
	{"812-3456-7890", "", true},
	{"+0812 3456 7890", "", true},
}

func TestNormalizePhone(t *testing.T) {
	for _, c := range phoneCases {
		got, err := normalizePhone(c.typed)

		if c.refused {
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Errorf("%q: stored %q, err %v — want it refused", c.typed, got, err)
			}

			continue
		}

		if err != nil || got != c.stored {
			t.Errorf("%q: stored %q, err %v — want %q", c.typed, got, err, c.stored)
		}
	}
}

// Migration 00008 rewrote the stored numbers with user_phone_international, normalizePhone's SQL twin. A number one of
// them reads and the other refuses would be stored by the migration and refused on the next edit — or the reverse.
func TestNormalizePhone_AgreesWithTheMigration(t *testing.T) {
	db := san_testdb.DB(t)

	for _, c := range phoneCases {
		if c.typed == "" {
			continue // STRICT: NULL in, NULL out — and an empty phone is never rewritten
		}

		var stored sql.NullString

		err := db.Raw("SELECT user_phone_international(?)", c.typed).Scan(&stored).Error
		if err != nil {
			t.Fatalf("user_phone_international(%q): %v", c.typed, err)
		}

		if c.refused != !stored.Valid || stored.String != c.stored {
			t.Errorf("%q: SQL says %v %q, Go says refused=%v %q", c.typed, stored.Valid, stored.String, c.refused, c.stored)
		}
	}
}
