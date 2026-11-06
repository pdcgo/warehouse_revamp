// Package san_money holds the ONE rule for comparing rupiah amounts (stock-money-is-float64-compared-at-4-digits).
//
// It holds no rounding: the backend never rounds money (the-backend-never-rounds-money) — every figure is stored,
// posted and carried exact, and only the screen rounds it for display (a-fraction-of-a-rupiah-shows-three-decimals).
//
// Money is float64 everywhere — in the ledgers, the feature tables and on the wire (money-is-double-in-the-api-too).
// Float is inexact, so two amounts are never compared with ==: they are equal when they agree to 4 decimal places.
// Keeping that in one function is the point — a second copy is a second precision.
package san_money

import "math"

// Places is the precision money is compared and reconciled at.
const Places = 4

var scale = math.Pow10(Places)

// Round rounds an amount to Places decimal places, half away from zero.
func Round(amount float64) float64 {
	return math.Round(amount*scale) / scale
}

// Equal reports whether two amounts agree to Places decimal places: their DIFFERENCE is zero to Places. Not
// Round(a) == Round(b): two exact figures a hair apart on either side of a half (316,67474999… and 316,67475) round
// to different 4th places, and since the backend never rounds money (the-backend-never-rounds-money) such fractions
// are everywhere — the difference is what the tolerance is about.
func Equal(a, b float64) bool {
	return IsZero(a - b)
}

// IsZero reports whether an amount is zero to Places decimal places.
func IsZero(amount float64) bool {
	return Round(amount) == 0
}

// Positive reports whether an amount is a real, positive movement: finite, above 0, and not zero to Places — the
// check a posting or a refusal makes where an amount must be above 0 (the-backend-never-rounds-money: an amount is
// never rounded to decide it; float dust below Places is no movement, as IsZero says).
func Positive(amount float64) bool {
	if math.IsNaN(amount) || math.IsInf(amount, 0) {
		return false
	}

	return amount > 0 && !IsZero(amount)
}

// ZeroBelow is IsZero's bound written for SQL: an amount whose absolute value is under it is zero to Places. A query
// that must tell 0 from a figure (a balance that settled, an unrecorded sale) compares `abs(x) < ZeroBelow`, never
// `x = 0`: exact doubles summed in another order can leave dust.
const ZeroBelow = "0.00005"

// IsWhole reports whether an amount is already whole rupiah — to Places, so a figure carried through float arithmetic
// (1000.0000000001) still counts. NaN and the infinities are not. A CHECK, never a rounding: the statement importer
// holds a line that fails it (a-fractional-statement-line-is-still-held).
func IsWhole(amount float64) bool {
	if math.IsNaN(amount) || math.IsInf(amount, 0) {
		return false
	}

	return Equal(amount, math.Round(amount))
}
