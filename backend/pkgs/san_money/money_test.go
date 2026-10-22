package san_money_test

import (
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
)

// Rp 10.000 over 3 units, summed back, is not 10.000 in float — and must still compare equal.
func TestEqual_FloatDustBelowFourPlacesIsEqual(t *testing.T) {
	third := 10000.0 / 3

	if !san_money.Equal(third+third+third, 10000) {
		t.Fatalf("3 × %v should equal 10000 at 4 places", third)
	}
}

func TestEqual_ADifferenceAtTheFourthPlaceIsReal(t *testing.T) {
	if san_money.Equal(3333.3333, 3333.3334) {
		t.Fatal("a difference at the 4th place is a real difference")
	}
}

func TestIsZero(t *testing.T) {
	if !san_money.IsZero(0.00004) {
		t.Fatal("0.00004 rounds to 0 at 4 places")
	}

	if san_money.IsZero(0.0001) {
		t.Fatal("0.0001 is not zero at 4 places")
	}
}
