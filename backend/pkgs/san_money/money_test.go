package san_money_test

import (
	"math"
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

// Two exact figures a hair apart across a half of the 4th place are still equal — 2,5% of 12.666,99 computed two ways.
func TestEqual_AHairApartAcrossAHalfIsEqual(t *testing.T) {
	if !san_money.Equal(316.67474999999996, 316.67475) {
		t.Fatal("316,67474999… and 316,67475 differ by float dust — they are equal")
	}

	if san_money.Equal(316.6747, 316.6748) {
		t.Fatal("a difference of a whole 4th place is real")
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

// The backend never rounds money (the-backend-never-rounds-money): an amount must be above 0 where it was, judged on
// the exact figure — Rp 0,4 is a real, positive amount, float dust below 4 places is not, and neither are NaN or Inf.
func TestPositive(t *testing.T) {
	cases := []struct {
		in   float64
		want bool
	}{
		{0.4, true},
		{316.675, true},
		{0.0001, true},
		{0.00004, false},
		{0, false},
		{-0.4, false},
		{math.NaN(), false},
		{math.Inf(1), false},
	}

	for _, c := range cases {
		if got := san_money.Positive(c.in); got != c.want {
			t.Fatalf("Positive(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

// Exact fractions summed back as doubles agree with their total within the tolerance — the reason a ledger of exact
// figures reconciles with san_money.Equal and needs no rounding of its own.
func TestEqual_ExactFractionsSumBackWithinTheTolerance(t *testing.T) {
	sum := 0.0
	for range 10000 {
		sum += 316.675
	}

	if !san_money.Equal(sum, 3166750) {
		t.Fatalf("10000 × 316,675 = %v, want 3166750 within 4 places", sum)
	}
}

// Text writes words a person reads the screen's way (a-fraction-of-a-rupiah-shows-three-decimals) — never a sum.
func TestText(t *testing.T) {
	cases := []struct {
		in   float64
		want string
	}{
		{15000, "Rp 15.000"},
		{316.675, "Rp 316,675"},
		{12666.99, "Rp 12.666,99"},
		{12345.5, "Rp 12.345,5"},
		{1.0005, "Rp 1,001"},
		{-600000, "Rp -600.000"},
		{-0.0001, "Rp 0"},
		{0, "Rp 0"},
		{math.NaN(), "Rp 0"},
		{1234567890123.4, "Rp 1.234.567.890.123"},
	}

	for _, c := range cases {
		if got := san_money.Text(c.in); got != c.want {
			t.Fatalf("Text(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestIsWhole(t *testing.T) {
	if !san_money.IsWhole(1000.00000001) {
		t.Fatal("float dust below 4 places is still whole")
	}

	if san_money.IsWhole(1000.5) || san_money.IsWhole(math.NaN()) || san_money.IsWhole(math.Inf(1)) {
		t.Fatal("a fraction, NaN and an infinity are not whole")
	}
}
