package san_money

import (
	"math"
	"strconv"
	"strings"
)

// textPlaces is how many places a fraction of a rupiah is WRITTEN to (a-fraction-of-a-rupiah-shows-three-decimals) —
// the screen's rule, used where the backend writes a figure into words a person reads (a log note, a refusal).
const textPlaces = 3

// textFractionLimit is where a double holds no thousandth of a rupiah anyway; past it the figure is written whole.
const textFractionLimit = 1e12

// Text is an amount as a person reads it, in the Indonesian form the screen writes: "Rp 15.000", "Rp 316,675",
// "Rp -600.000". A fraction is written to up to 3 places, half away from zero, trailing zeros dropped; a whole figure
// has none. It is WORDS only — the amount itself is stored and posted exact (the-backend-never-rounds-money), and
// this text never feeds a sum. NaN and the infinities read as "Rp 0"; a figure that writes as 0 is never "-Rp 0".
func Text(amount float64) string {
	if math.IsNaN(amount) || math.IsInf(amount, 0) {
		return "Rp 0"
	}

	abs := math.Abs(amount)

	var whole, fraction string

	if abs >= textFractionLimit {
		whole = strconv.FormatFloat(math.Round(abs), 'f', 0, 64)
	} else {
		// 15 significant digits clear binary dust first (1,0005 is stored as 1,000499…; × 1000 must read 1000,5).
		scaled, err := strconv.ParseFloat(strconv.FormatFloat(abs*math.Pow10(textPlaces), 'g', 15, 64), 64)
		if err != nil {
			scaled = abs * math.Pow10(textPlaces)
		}

		milli := int64(math.Round(scaled))
		unit := int64(math.Pow10(textPlaces))
		whole = strconv.FormatInt(milli/unit, 10)
		fraction = strings.TrimRight(leftPad(strconv.FormatInt(milli%unit, 10), textPlaces), "0")
	}

	sign := ""
	if amount < 0 && (whole != "0" || fraction != "") {
		sign = "-"
	}

	text := "Rp " + sign + grouped(whole)
	if fraction != "" {
		text += "," + fraction
	}

	return text
}

// grouped writes thousands with a dot, the Indonesian way: "1234567" → "1.234.567".
func grouped(digits string) string {
	var b strings.Builder

	for i, r := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte('.')
		}

		b.WriteRune(r)
	}

	return b.String()
}

func leftPad(s string, width int) string {
	if len(s) >= width {
		return s
	}

	return strings.Repeat("0", width-len(s)) + s
}
