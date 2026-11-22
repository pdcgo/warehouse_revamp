package inventory_v1

import (
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// restockListScope is THE restock list's predicate — the caller's restocks narrowed by the list's filter — and the ONE
// place it is written. RestockRequestList counts and pages it; the list's statistics and its export are to read the
// same set through it, so the screen, its cards and its file cannot disagree about which restocks a filter means (as
// `scopedOrders` serves the order list, its stat and its export).
//
// The result is a query on `restocks` with every condition applied and nothing selected, ordered or paged: a caller
// adds its own Count, Order/Offset/Limit or aggregate. A caller that must ignore one filter (a census across the
// status tabs ignores the status) passes a copy of the filter with that field cleared, never a second predicate.
func restockListScope(db *gorm.DB, teamID uint64, filter *inventoryv1.RestockRequestListFilter) *gorm.DB {
	query := db.
		Model(&inventory_service_models.Restock{}).
		// The parentheses are explicit, not load-bearing here: GORM wraps a chained Where containing an
		// OR before AND-ing the next one, so the status filter below already applies to both legs.
		// (Verified against the emitted SQL — an earlier comment here claimed they were required, and
		// that was wrong.) They stay because precedence is what makes an OR-plus-filter go wrong, and
		// this should be readable from the line rather than resting on ORM behaviour.
		Where("(team_id = ? OR warehouse_id = ?)", teamID, teamID)

	// One status, or all of them (#130). Filtered HERE and not in the client because the list is
	// paginated: a client-side tab would filter this page only, and the count would still be the
	// unfiltered total.
	if status := restockStatusToText(filter.GetStatus()); status != "" {
		query = query.Where("status = ?", status)
	}

	// Only requests carrying THIS product on a line (#159). EXISTS rather than a JOIN, for the same
	// reason: a join against the lines would return a request once per matching line, double-counting
	// both the rows and the paginated total.
	if productID := filter.GetProductId(); productID != 0 {
		query = query.Where(
			"EXISTS (SELECT 1 FROM restock_items i "+
				"WHERE i.restock_id = restocks.id AND i.product_id = ?)",
			productID,
		)
	}

	// Only restocks going to ONE warehouse (owner). A selling team ships to several, and this is how
	// it asks "what is going to Jakarta" rather than "what is going anywhere".
	if warehouseID := filter.GetWarehouseId(); warehouseID != 0 {
		query = query.Where("warehouse_id = ?", warehouseID)
	}

	// Only restocks raised by ONE selling team (owner) — the mirror of the warehouse lens above, and
	// the receiving side's version of the same question: "what is coming from Bandung" rather than
	// "what is coming".
	//
	// It NARROWS the two-sided scope, it does not widen it: the OR above still applies, so a warehouse
	// asking for team 9's restocks gets the ones addressed to itself and not team 9's whole book.
	if requesterID := filter.GetRequestingTeamId(); requesterID != 0 {
		query = query.Where("team_id = ?", requesterID)
	}

	// BY PERSON (owner): whose orders these are, and who was at the door. Two independent filters that
	// AND together — see the proto for why they are not one "involved this person" field.
	//
	// Both match the ACTOR columns, so a restock raised before those columns existed (0) matches
	// neither. That is deliberate: the record does not say who raised it, and returning it under
	// somebody's name would invent the one fact being filtered on.
	if createdBy := filter.GetCreatedByUserId(); createdBy != 0 {
		query = query.Where("created_by_user_id = ?", createdBy)
	}

	// Implies an accepted restock — a pending or cancelled one has 0 here, so it drops out without a
	// status filter having to say so.
	if acceptedBy := filter.GetAcceptedByUserId(); acceptedBy != 0 {
		query = query.Where("accepted_by_user_id = ?", acceptedBy)
	}

	// BY COURIER (the-restock-list-exports-and-filters-by-courier): the restock's own shipment channel id, as the order
	// list's `shipment_channel_id`. A restock naming no courier (0) matches no pick — it is read under "any courier"
	// only; there is no "no courier" pick to ask for it. No index: an equality over the caller's rows once the scope
	// above has found them (measured in restock_request_list_perf_test.go).
	if shipmentID := filter.GetShipmentId(); shipmentID != 0 {
		query = query.Where("shipment_id = ?", shipmentID)
	}

	// BY TAG (the-restock-tags-prototype-is-accepted): the restocks carrying ANY of the picked tags — *Barang kurang* +
	// *Barang rusak* together is the problem list. EXISTS rather than a JOIN, for the reason the product filter gives: a
	// restock carrying two of the picks must be read once, in the rows and in the total. The probe is the key of
	// `restock_tags` (restock_id, tag_id); a rare tag over a big book is read from its own side by
	// `restock_tags_tag_idx` (tag_id, restock_id) — measured in restock_request_list_perf_test.go.
	if tagIDs := filter.GetTagIds(); len(tagIDs) > 0 {
		query = query.Where(
			"EXISTS (SELECT 1 FROM restock_tags rt WHERE rt.restock_id = restocks.id AND rt.tag_id IN ?)",
			tagIDs,
		)
	}

	// BY THE SETTLED MARK (backlog #101): the seller's Hilang tab is LOST + UNSETTLED, so a settled lost restock leaves
	// it and stays under Semua (the-restock-resolutions-prototype-is-accepted). Unasked, either — as before.
	switch filter.GetSettled() {
	case inventoryv1.RestockSettledFilter_RESTOCK_SETTLED_FILTER_SETTLED:
		query = query.Where("settled_at IS NOT NULL")
	case inventoryv1.RestockSettledFilter_RESTOCK_SETTLED_FILTER_UNSETTLED:
		query = query.Where("settled_at IS NULL")
	}

	query = applyRestockDateRange(query, filter)
	query = applyRestockSearch(query, filter.GetQ())

	return query
}

// restockDateColumn maps the caller's chosen date to its column (owner).
//
// A CLOSED switch over the enum, never a caller-supplied string: the result is concatenated into SQL
// below, and the only safe way to do that is for every possible value to be written here. UNSPECIFIED
// reads as created_at, which is the one date every row has. Every other field reads ITS OWN column — Tiba
// the box's signing (arrived_at), Hilang the giving-up (lost_at) — never created_at in its place: "arrived last
// week" is about the arrival.
func restockDateColumn(field inventoryv1.RestockDateField) string {
	switch field {
	case inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_ACCEPTED:
		return "accepted_at"
	case inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_CANCELLED:
		return "cancelled_at"
	case inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_ARRIVED:
		return "arrived_at"
	case inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_LOST:
		return "lost_at"
	default:
		return "created_at"
	}
}

// applyRestockDateRange narrows to restocks whose CHOSEN date falls in the range (owner).
//
// Either bound may be left at 0, which means "open at that end" — a `to` alone is "everything up to
// Friday". Both 0 is no filter at all, and the whole clause is skipped so a request with no range
// pays nothing for it.
//
// Rows with no such date are EXCLUDED rather than kept. "Accepted last week" cannot be true of a
// request nobody has accepted, and a NULL comparison would drop them anyway — the explicit IS NOT
// NULL says so out loud, and lets the partial indexes from 00018 serve the query.
func applyRestockDateRange(query *gorm.DB, filter *inventoryv1.RestockRequestListFilter) *gorm.DB {
	from, to := filter.GetFromUnix(), filter.GetToUnix()

	if from == 0 && to == 0 {
		return query
	}

	column := restockDateColumn(filter.GetDateField())

	if column != "created_at" {
		query = query.Where(column + " IS NOT NULL")
	}

	if from != 0 {
		query = query.Where(column+" >= ?", time.Unix(from, 0))
	}

	if to != 0 {
		query = query.Where(column+" <= ?", time.Unix(to, 0))
	}

	return query
}

// applyRestockSearch narrows by FREE TEXT over what a person remembers about a restock (owner): its
// number, the courier's tracking number, the order it was for, or a product code / product name on one of its
// lines.
//
// The lines are matched with EXISTS rather than a JOIN, for the reason the product filter above gives:
// a join returns a request once per matching line, double-counting both the rows and the paginated
// total.
//
// A NUMBER IS AMBIGUOUS, AND THE HASH IS HOW SOMEBODY RESOLVES IT.
//
// "500" is both a plausible restock number and a plausible product code fragment (TMB-500-005), so a bare
// numeric term searches the id AND the text — narrowing it to the id would make the product code unfindable.
// The cost is that a short number is noisy: "9" also matches tracking number JP1830099.
//
// So "#9" means THE NUMBER, ALONE. The hash is what a person types when they mean the id — they copied
// it off the screen, where it is printed with one — and it is the only way to ask for one delivery and
// get one row. Either way the number matches WHOLE: "#31" must not find 310, or asking for one
// delivery returns ten.
func applyRestockSearch(query *gorm.DB, q string) *gorm.DB {
	q = strings.TrimSpace(q)
	if q == "" {
		return query
	}

	// The explicit form first, because it is a NARROWER question and not one leg of a broader one.
	if strings.HasPrefix(q, "#") {
		id, err := strconv.ParseUint(strings.TrimPrefix(q, "#"), 10, 64)
		if err == nil && id != 0 {
			return query.Where("restocks.id = ?", id)
		}
		// A "#" followed by something that is not a number is NOT an id, and the term keeps its hash
		// on the way into the text search below rather than being stripped: a hash inside a reference
		// is real ("PO#4127"), so stripping it would make that reference unfindable. The consequence
		// is that "#MP-4127" matches nothing while "MP-4127" matches the row — which is the same rule
		// stated once, not two behaviours.
	}

	like := "%" + strings.ToLower(q) + "%"

	conditions := []string{
		"LOWER(receipt) LIKE ?",
		"LOWER(invoice_ref_id) LIKE ?",
		"EXISTS (SELECT 1 FROM restock_items i " +
			"WHERE i.restock_id = restocks.id " +
			"AND (LOWER(i.product_code) LIKE ? OR LOWER(i.name) LIKE ?))",
	}
	args := []any{like, like, like, like}

	// "#312" and "312" are the same search — people copy the number off the screen, where it is
	// printed with the hash.
	id, err := strconv.ParseUint(strings.TrimPrefix(q, "#"), 10, 64)
	if err == nil && id != 0 {
		conditions = append(conditions, "restocks.id = ?")
		args = append(args, id)
	}

	return query.Where("("+strings.Join(conditions, " OR ")+")", args...)
}
