// Package san_money holds the ONE rule for comparing rupiah amounts (stock-money-is-float64-compared-at-4-digits).
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

// Equal reports whether two amounts agree to Places decimal places.
func Equal(a, b float64) bool {
	return Round(a) == Round(b)
}

// IsZero reports whether an amount is zero to Places decimal places.
func IsZero(amount float64) bool {
	return Round(amount) == 0
}
