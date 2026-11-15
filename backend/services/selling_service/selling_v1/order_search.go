package selling_v1

import (
	"strconv"
	"unicode"
)

// orderSearchMatch is the order search's condition on `orders` for a trimmed, non-empty term (the-order-search-matches-ids-first),
// returned with its named arguments. scopedOrders ANDs it with the scope and every other filter, so OrderList, OrderStat
// and OrderExport all search through it.
//
// A variable only so the old-vs-new test can run the real handlers with the previous clause on one fixture
// (order_search_ids_first_test.go, via export_test.go). Nothing else assigns it.
var orderSearchMatch = orderSearchIDsFirst

// orderSearchIDsFirst finds the matches as ORDER IDS FIRST (the-order-search-matches-ids-first): the union of three id sets,
// each read through its GIN trigram index (selling 00048) — the orders whose address row matches (the customer's name or
// phone), whose marketplace ref matches, whose tracking number matches — and, for an all-digits term, the id itself.
// `orders.id = ANY(ARRAY(…))` FENCES the set before the scope: the array is an InitPlan computed once, without the team,
// and the scope and the page then read only those orders through the primary key. Written inside one condition, the
// orders side could not BitmapOr an `IN (subquery)` with its two ILIKEs, so the ref and receipt were filtered over every
// order in scope (OrderList audit finding 1: 35–80 ms a query, 2 ms ids first, custom and generic plans alike).
//
// The same text match as before: each column's `ILIKE '%term%'`, a typed `%`, `_` or `\` matching itself (likeEscaper).
// What is searched, and why:
//
//   - the customer's NAME and PHONE, on the order's one address row (00045, one-address-per-order-and-per-draft);
//   - the MARKETPLACE REFERENCE — what the buyer quotes, what a payout report lists, what the storefront's support asks for;
//   - the TRACKING NUMBER — a parcel in somebody's hand carries its slip (a-label-scan-reads-the-ref-or-the-receipt);
//   - the ORDER ID when the term is all digits, as well as the text columns, never instead of them: a phone number is
//     digits too, and matching only the id would lose the more likely hit.
//
// A term the trigram index cannot serve (no run of three letters or digits — "08", "a b") keeps the scan of the orders in
// scope (orderSearchScan): with no trigram to look up, every arm of the union would read its whole table and the ids
// first shape is two to three times slower (measured in the audit).
func orderSearchIDsFirst(term string) (string, map[string]any) {
	if !trigramsServe(term) {
		return orderSearchScan(term)
	}

	args := map[string]any{"like": "%" + likeEscaper.Replace(term) + "%"}

	ids := `SELECT a.order_id FROM order_addresses a WHERE a.customer_name ILIKE @like ESCAPE '\'` +
		` OR a.customer_phone ILIKE @like ESCAPE '\'` +
		` UNION SELECT r.id FROM orders r WHERE r.order_external_ref_id ILIKE @like ESCAPE '\'` +
		` UNION SELECT r.id FROM orders r WHERE r.receipt ILIKE @like ESCAPE '\'`

	id, err := strconv.ParseUint(term, 10, 64)
	if err == nil && id > 0 {
		ids += ` UNION SELECT CAST(@id AS bigint)`
		args["id"] = id
	}

	return `(orders.id = ANY(ARRAY(` + ids + `)))`, args
}

// orderSearchScan is the search tested on every order in scope: the address rows' match as one hashed SubPlan beside the
// order's own two ILIKEs — the shape for a term no trigram serves.
//
// The whole disjunction is ONE parenthesised clause, written by hand rather than chained through GORM's Or(): it sits
// between the scope's OR and the status filter, and an unparenthesised `a OR b AND c` would let a search leak orders from
// teams the caller cannot see — a data-exposure bug, so precedence is stated rather than inherited.
func orderSearchScan(term string) (string, map[string]any) {
	args := map[string]any{"like": "%" + likeEscaper.Replace(term) + "%"}

	clause := `(orders.id IN (SELECT a.order_id FROM order_addresses a WHERE a.customer_name ILIKE @like ESCAPE '\'` +
		` OR a.customer_phone ILIKE @like ESCAPE '\')` +
		` OR order_external_ref_id ILIKE @like ESCAPE '\' OR receipt ILIKE @like ESCAPE '\'`

	id, err := strconv.ParseUint(term, 10, 64)
	if err == nil && id > 0 {
		clause += ` OR id = @id`
		args["id"] = id
	}

	return clause + `)`, args
}

// trigramsServe reports whether pg_trgm can look an infix `ILIKE '%term%'` up in its index: the pattern needs a run of
// three word characters (letters or digits) to take a trigram from. Shorter runs yield none, and the GIN index then reads
// every entry — slower than the scan it was meant to replace.
func trigramsServe(term string) bool {
	run := 0

	for _, r := range term {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			run = 0

			continue
		}

		run++
		if run >= 3 {
			return true
		}
	}

	return false
}
