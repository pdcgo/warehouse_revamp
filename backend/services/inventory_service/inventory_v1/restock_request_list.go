package inventory_v1

import (
	"context"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockRequestList serves BOTH sides of a request (#105): a team sees requests it MADE
// (team_id) and requests TARGETING it as a warehouse (warehouse_id). Newest first,
// paginated. The team_id is the caller's team (use_scope).
func (s *Service) RestockRequestList(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestListRequest],
) (*connect.Response[inventoryv1.RestockRequestListResponse], error) {
	teamID := req.Msg.GetTeamId()
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
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
	if status := restockStatusToText(req.Msg.GetFilter().GetStatus()); status != "" {
		query = query.Where("status = ?", status)
	}

	// Only requests carrying THIS product on a line (#159). EXISTS rather than a JOIN, for the same
	// reason: a join against the lines would return a request once per matching line, double-counting
	// both the rows and the paginated total.
	if productID := req.Msg.GetFilter().GetProductId(); productID != 0 {
		query = query.Where(
			"EXISTS (SELECT 1 FROM restock_items i "+
				"WHERE i.restock_id = restocks.id AND i.product_id = ?)",
			productID,
		)
	}

	// Only restocks going to ONE warehouse (owner). A selling team ships to several, and this is how
	// it asks "what is going to Jakarta" rather than "what is going anywhere".
	if warehouseID := req.Msg.GetFilter().GetWarehouseId(); warehouseID != 0 {
		query = query.Where("warehouse_id = ?", warehouseID)
	}

	// Only restocks raised by ONE selling team (owner) — the mirror of the warehouse lens above, and
	// the receiving side's version of the same question: "what is coming from Bandung" rather than
	// "what is coming".
	//
	// It NARROWS the two-sided scope, it does not widen it: the OR above still applies, so a warehouse
	// asking for team 9's restocks gets the ones addressed to itself and not team 9's whole book.
	if requesterID := req.Msg.GetFilter().GetRequestingTeamId(); requesterID != 0 {
		query = query.Where("team_id = ?", requesterID)
	}

	// BY PERSON (owner): whose orders these are, and who was at the door. Two independent filters that
	// AND together — see the proto for why they are not one "involved this person" field.
	//
	// Both match the ACTOR columns, so a restock raised before those columns existed (0) matches
	// neither. That is deliberate: the record does not say who raised it, and returning it under
	// somebody's name would invent the one fact being filtered on.
	if createdBy := req.Msg.GetFilter().GetCreatedByUserId(); createdBy != 0 {
		query = query.Where("created_by_user_id = ?", createdBy)
	}

	// Implies an accepted restock — a pending or cancelled one has 0 here, so it drops out without a
	// status filter having to say so.
	if acceptedBy := req.Msg.GetFilter().GetAcceptedByUserId(); acceptedBy != 0 {
		query = query.Where("accepted_by_user_id = ?", acceptedBy)
	}

	query = applyRestockDateRange(query, req.Msg.GetFilter())
	query = applyRestockSearch(query, req.Msg.GetFilter().GetQ())

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, restockErr(err)
	}

	var rrs []inventory_service_models.Restock

	err = query.
		// Preload, not a join: GORM fetches this page's lines in ONE extra query keyed by request id,
		// so a page of requests costs 2 queries rather than N+1 (#124).
		// Items only — NOT their placements or damage (#154). The list shows product names; loading
		// every line's shelves for twenty requests would be weight nobody renders. A caller that needs
		// them opens the request, where RestockRequestDetail loads them.
		Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		Order("id DESC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&rrs).
		Error
	if err != nil {
		return nil, restockErr(err)
	}

	// WHO RAISED IT, SIGNED FOR IT AND COUNTED IT IN, AND WHETHER ROOT DID FROM OUTSIDE (an-override-shows-a-platform-badge):
	// the restock carries no flag — its trail does, one per act — so the page's acts are read in ONE lookup, never per
	// row.
	overrides, err := restockStepOverrides(s.db.WithContext(ctx), rrs)
	if err != nil {
		return nil, restockErr(err)
	}

	out := make([]*inventoryv1.RestockRequest, 0, len(rrs))
	for i := range rrs {
		r := restockRequestToProto(&rrs[i])
		step := overrides[rrs[i].ID]
		r.CreatedByIsOverride = step.Created
		r.ArrivedByIsOverride = step.Arrived
		r.AcceptedByIsOverride = step.Accepted
		out = append(out, r)
	}

	items, ids := restockRequestListItems(out, req.Msg.GetDataRequest())

	return connect.NewResponse(&inventoryv1.RestockRequestListResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}

// restockOverrides is, for one restock, whether each act the lists name a person for was Root or the System
// Administrator acting from outside the team (an-override-shows-a-platform-badge).
type restockOverrides struct {
	Created  bool
	Arrived  bool
	Accepted bool
}

// restockStepOverrides reads each restock of a page's trail ONCE — one GROUP BY over the page's ids, served by
// `restock_logs_restock_idx` (restock_id, created_at, id) — and returns, per restock, the `is_override` of the three
// acts the lists name a person for:
//
//   - created: the trail's FIRST row, in the trail's order — the create's ("" → ongoing, in the restock's own tx).
//   - arrived: the row that moved it to arrived; a box counted straight from ongoing was signed for by that count
//     (the accept stamps arrived_by with its own actor), so with no arrive row it is the accept's.
//   - accepted: the row that moved it to accepted.
//
// An edit keeps the status (from = to), so it never stands for a step. A restock with no trail row reads all false.
func restockStepOverrides(db *gorm.DB, rows []inventory_service_models.Restock) (map[uint64]restockOverrides, error) {
	out := make(map[uint64]restockOverrides, len(rows))
	if len(rows) == 0 {
		return out, nil
	}

	ids := make([]uint64, 0, len(rows))
	for i := range rows {
		ids = append(ids, rows[i].ID)
	}

	var steps []struct {
		RestockID uint64
		Created   bool
		Arrived   bool
		Accepted  bool
	}

	err := db.
		Model(&inventory_service_models.RestockLog{}).
		Select(`restock_id,
			(array_agg(is_override ORDER BY created_at, id))[1] AS created,
			COALESCE(
				bool_or(is_override) FILTER (WHERE to_status = ? AND from_status <> to_status),
				bool_or(is_override) FILTER (WHERE to_status = ? AND from_status <> to_status),
				false
			) AS arrived,
			COALESCE(bool_or(is_override) FILTER (WHERE to_status = ? AND from_status <> to_status), false) AS accepted`,
			restockStatusArrived, restockStatusAccepted, restockStatusAccepted).
		Where("restock_id IN ?", ids).
		Group("restock_id").
		Scan(&steps).
		Error
	if err != nil {
		return nil, err
	}

	for _, step := range steps {
		out[step.RestockID] = restockOverrides{Created: step.Created, Arrived: step.Arrived, Accepted: step.Accepted}
	}

	return out, nil
}

// restockDateColumn maps the caller's chosen date to its column (owner).
//
// A CLOSED switch over the enum, never a caller-supplied string: the result is concatenated into SQL
// below, and the only safe way to do that is for every possible value to be written here. UNSPECIFIED
// reads as created_at, which is the one date every row has.
func restockDateColumn(field inventoryv1.RestockDateField) string {
	switch field {
	case inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_ACCEPTED:
		return "accepted_at"
	case inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_CANCELLED:
		return "cancelled_at"
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
