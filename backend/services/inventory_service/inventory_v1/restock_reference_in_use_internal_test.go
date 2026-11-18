package inventory_v1

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

// What counts as a save clashing on a reference (a-reference-in-use-stops-the-restock-form): the unique violation in
// both forms GORM may hand back, and the deadlock two edits trading references meet — rare enough that the race test
// (TestRace_RestockReference_TwoEditsTradingResis) seldom draws it, so its classification is pinned here.
func TestIsReferenceClash(t *testing.T) {
	for name, tc := range map[string]struct {
		err  error
		want bool
	}{
		"translated unique violation": {gorm.ErrDuplicatedKey, true},
		"raw unique violation":        {&pgconn.PgError{Code: "23505"}, true},
		"deadlock, wrapped":           {fmt.Errorf("update: %w", &pgconn.PgError{Code: "40P01"}), true},
		"a check violation":           {&pgconn.PgError{Code: "23514"}, false},
		"anything else":               {errors.New("connection reset"), false},
		"nil":                         {nil, false},
	} {
		if got := isReferenceClash(tc.err); got != tc.want {
			t.Errorf("%s: isReferenceClash = %v, want %v", name, got, tc.want)
		}
	}
}
