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
// (requesting_team_id) and requests TARGETING it as a warehouse (warehouse_id). Newest first,
// paginated. The team_id is the caller's team (use_scope).
func (s *Service) RestockRequestList(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestListRequest],
) (*connect.Response[inventoryv1.RestockRequestListResponse], error) {
	teamID := req.Msg.GetTeamId()
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&inventory_service_models.RestockRequest{}).
		// The parentheses are explicit, not load-bearing here: GORM wraps a chained Where containing an
		// OR before AND-ing the next one, so the status filter below already applies to both legs.
		// (Verified against the emitted SQL — an earlier comment here claimed they were required, and
		// that was wrong.) They stay because precedence is what makes an OR-plus-filter go wrong, and
		// this should be readable from the line rather than resting on ORM behaviour.
		Where("(requesting_team_id = ? OR warehouse_id = ?)", teamID, teamID)

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
			"EXISTS (SELECT 1 FROM restock_request_items i "+
				"WHERE i.restock_request_id = restock_requests.id AND i.product_id = ?)",
			productID,
		)
	}

	// Only restocks going to ONE warehouse (owner). A selling team ships to several, and this is how
	// it asks "what is going to Jakarta" rather than "what is going anywhere".
	if warehouseID := req.Msg.GetFilter().GetWarehouseId(); warehouseID != 0 {
		query = query.Where("warehouse_id = ?", warehouseID)
	}

	query = applyRestockDateRange(query, req.Msg.GetFilter())
	query = applyRestockSearch(query, req.Msg.GetFilter().GetQ())

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, restockErr(err)
	}

	var rrs []inventory_service_models.RestockRequest

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

	out := make([]*inventoryv1.RestockRequest, 0, len(rrs))
	for i := range rrs {
		out = append(out, restockRequestToProto(&rrs[i]))
	}

	items, ids := restockRequestListItems(out, req.Msg.GetDataRequest())

	return connect.NewResponse(&inventoryv1.RestockRequestListResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
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
// number, the courier's tracking number, the order it was for, or a SKU / product name on one of its
// lines.
//
// The lines are matched with EXISTS rather than a JOIN, for the reason the product filter above gives:
// a join returns a request once per matching line, double-counting both the rows and the paginated
// total.
//
// THE NUMBER MATCHES WHOLE, not as a substring. "31" finding restock 310, 313 and 3100 would bury the
// one delivery somebody typed the number of — so a numeric term is an equality on id, and it is added
// BESIDE the text conditions rather than replacing them, because "500" is a plausible SKU fragment too.
func applyRestockSearch(query *gorm.DB, q string) *gorm.DB {
	q = strings.TrimSpace(q)
	if q == "" {
		return query
	}

	like := "%" + strings.ToLower(q) + "%"

	conditions := []string{
		"LOWER(receipt) LIKE ?",
		"LOWER(order_ref) LIKE ?",
		"EXISTS (SELECT 1 FROM restock_request_items i " +
			"WHERE i.restock_request_id = restock_requests.id " +
			"AND (LOWER(i.sku) LIKE ? OR LOWER(i.name) LIKE ?))",
	}
	args := []any{like, like, like, like}

	// "#312" and "312" are the same search — people copy the number off the screen, where it is
	// printed with the hash.
	id, err := strconv.ParseUint(strings.TrimPrefix(q, "#"), 10, 64)
	if err == nil && id != 0 {
		conditions = append(conditions, "restock_requests.id = ?")
		args = append(args, id)
	}

	return query.Where("("+strings.Join(conditions, " OR ")+")", args...)
}
