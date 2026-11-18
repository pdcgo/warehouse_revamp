package inventory_v1

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE LIST'S PREDICATE MOVED INTO ONE HELPER (restockListScope) WITHOUT CHANGING WHAT THE LIST READS.
//
// oldRestockListPage below is RestockRequestList's query as it was written INLINE before the helper — kept VERBATIM
// (only `s.db` became the `s` parameter's, and the read stops at the ids), with the date and search helpers it called
// frozen beside it under an `old` prefix. Every caller × filter below is paged through both, and the ids, their order
// and the pager's total must be identical.
//
// Left out on purpose — the two changes this slice MADE, each pinned by its own test in restock_request_filters_test.go:
//   - a range on RESTOCK_DATE_FIELD_ARRIVED / _LOST: the old code read created_at for both (the bug), the new reads
//     arrived_at / lost_at (TestRestockRequestList_EachDateFieldReadsItsOwnDate);
//   - shipment_id: the old filter had no courier (TestRestockRequestList_FilterByCourier).
func TestRestockListScope_ReadsWhatTheInlineListRead(t *testing.T) {
	db := san_testdb.DB(t)
	s := NewService(db, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	ctx := context.Background()

	ids := seedRestockListFixture(t, db)

	now := time.Now()
	day := func(n int) int64 { return now.AddDate(0, 0, -n).Unix() }

	statuses := []inventoryv1.RestockRequestStatus{
		inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_UNSPECIFIED,
		inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ONGOING,
		inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ARRIVED,
		inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED,
		inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_LOST,
		inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_CANCELLED,
	}

	filters := map[string]*inventoryv1.RestockRequestListFilter{
		"nil":            nil,
		"empty":          {},
		"product 100":    {ProductId: 100},
		"product 102":    {ProductId: 102},
		"product absent": {ProductId: 999},
		"warehouse 5":    {WarehouseId: 5},
		"warehouse 6":    {WarehouseId: 6},
		"requester 2":    {RequestingTeamId: 2},
		"requester 3":    {RequestingTeamId: 3},
		"created by 7":   {CreatedByUserId: 7},
		"created by 8":   {CreatedByUserId: 8},
		"accepted by 9":  {AcceptedByUserId: 9},
		"both people":    {CreatedByUserId: 7, AcceptedByUserId: 9},
		"q jne":          {Q: "jne"},
		"q JNT padded":   {Q: "  JNT "},
		"q sku-101":      {Q: "sku-101"},
		"q name":         {Q: "kopi"},
		"q PO hash":      {Q: "po#41"},
		"q hash, no id":  {Q: "#mp-1"},
		"q hash id":      {Q: "#" + strconv.FormatUint(ids[4], 10)},
		"q bare id":      {Q: strconv.FormatUint(ids[7], 10)},
		"q invoice":      {Q: "inv-1"},
		"everything": {
			Status:          inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED,
			ProductId:       100,
			WarehouseId:     5,
			CreatedByUserId: 7,
			DateField:       inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_ACCEPTED,
			FromUnix:        day(40),
			ToUnix:          day(0),
			Q:               "sku",
		},
	}

	// Every date field the old code read right, open at each end and closed.
	for _, field := range []inventoryv1.RestockDateField{
		inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_UNSPECIFIED,
		inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_CREATED,
		inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_ACCEPTED,
		inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_CANCELLED,
	} {
		filters[fmt.Sprintf("%v from", field)] = &inventoryv1.RestockRequestListFilter{DateField: field, FromUnix: day(12)}
		filters[fmt.Sprintf("%v to", field)] = &inventoryv1.RestockRequestListFilter{DateField: field, ToUnix: day(9)}
		filters[fmt.Sprintf("%v window", field)] = &inventoryv1.RestockRequestListFilter{DateField: field, FromUnix: day(20), ToUnix: day(5)}
		filters[fmt.Sprintf("%v, no window", field)] = &inventoryv1.RestockRequestListFilter{DateField: field}
	}

	// Each status alone, and laid over each lens above.
	for _, status := range statuses {
		filters[fmt.Sprintf("status %v", status)] = &inventoryv1.RestockRequestListFilter{Status: status}
		filters[fmt.Sprintf("status %v + warehouse 5 + q sku", status)] = &inventoryv1.RestockRequestListFilter{
			Status: status, WarehouseId: 5, Q: "sku",
		}
		filters[fmt.Sprintf("status %v + created window", status)] = &inventoryv1.RestockRequestListFilter{
			Status: status, DateField: inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_CREATED, FromUnix: day(25), ToUnix: day(3),
		}
	}

	names := make([]string, 0, len(filters))
	for name := range filters {
		names = append(names, name)
	}
	slices.Sort(names)

	nonEmpty := 0

	// Two selling teams and two warehouses: the two-sided scope is part of the predicate.
	for _, team := range []uint64{2, 3, 5, 6} {
		for _, name := range names {
			filter := filters[name]

			oldIDs, oldTotal := pageThrough(t, func(page *commonv1.CommonPagination) ([]uint64, int64) {
				ids, total, err := oldRestockListPage(s, ctx, connect.NewRequest(&inventoryv1.RestockRequestListRequest{
					TeamId: team, Filter: filter, Page: page,
				}))
				if err != nil {
					t.Fatalf("team %d, %s: old: %v", team, name, err)
				}

				return ids, total
			})

			newIDs, newTotal := pageThrough(t, func(page *commonv1.CommonPagination) ([]uint64, int64) {
				res, err := s.RestockRequestList(ctx, connect.NewRequest(&inventoryv1.RestockRequestListRequest{
					TeamId: team, Filter: filter, Page: page,
				}))
				if err != nil {
					t.Fatalf("team %d, %s: new: %v", team, name, err)
				}

				return res.Msg.GetIds(), int64(res.Msg.GetPageInfo().GetTotalItems())
			})

			if oldTotal != newTotal || !slices.Equal(oldIDs, newIDs) {
				t.Errorf("team %d, %s:\n old total %d ids %v\n new total %d ids %v", team, name, oldTotal, oldIDs, newTotal, newIDs)
			}

			if len(newIDs) > 0 {
				nonEmpty++
			}
		}
	}

	// A comparison of empty lists proves nothing — most cases must read rows (a warehouse asking for the other
	// warehouse, or a selling team for the other team, reads none by design).
	t.Logf("%d of %d caller × filter cases read rows", nonEmpty, 4*len(names))
	if nonEmpty*2 < 4*len(names) {
		t.Fatalf("only %d of %d cases read any row — the fixture does not exercise the filters", nonEmpty, 4*len(names))
	}
}

// pageThrough reads every page of 4 and returns the ids in order and the total each page reported (asserted equal).
func pageThrough(t *testing.T, read func(*commonv1.CommonPagination) ([]uint64, int64)) ([]uint64, int64) {
	t.Helper()

	var all []uint64

	first := int64(-1)

	for page := uint32(1); page <= 20; page++ {
		ids, total := read(&commonv1.CommonPagination{Page: page, Limit: 4})
		if first == -1 {
			first = total
		}

		if total != first {
			t.Fatalf("page %d says %d in all, page 1 said %d", page, total, first)
		}

		all = append(all, ids...)
		if len(ids) < 4 {
			return all, first
		}
	}

	t.Fatalf("more than 20 pages of 4")

	return nil, 0
}

// seedRestockListFixture writes 40 restocks straight into `restocks` / `restock_items`: two selling teams (2, 3) into
// two warehouses (5, 6), every status with its own date set, three couriers (one 0), three creators (one 0), two
// acceptors, references with and without text, one to three lines over three products. Returns the ids in seed order.
func seedRestockListFixture(t *testing.T, db *gorm.DB) []uint64 {
	t.Helper()

	now := time.Now()
	statuses := []string{restockStatusOngoing, restockStatusArrived, restockStatusAccepted, restockStatusLost, restockStatusCancelled}
	products := []struct {
		id         uint64
		code, name string
	}{
		{100, "SKU-100", "Beras Pandan"},
		{101, "SKU-101", "Kopi Arabika"},
		{102, "TMB-500-005", "Teh Melati"},
	}

	ids := make([]uint64, 0, 40)

	for i := range 40 {
		at := func(days int) *time.Time {
			v := now.AddDate(0, 0, -days).Add(time.Duration(i) * time.Minute)
			return &v
		}

		status := statuses[i%len(statuses)]
		r := inventory_service_models.Restock{
			TeamID:          uint64(2 + i%2),
			WarehouseID:     uint64(5 + (i/2)%2),
			Status:          status,
			ShipmentID:      []uint64{91, 92, 0}[i%3],
			CreatedByUserID: []uint64{7, 8, 0}[i%3],
			CreatedAt:       *at(30 - i/2),
			UpdatedAt:       now,
		}

		switch i % 4 {
		case 0:
			r.Receipt = fmt.Sprintf("JNE%04d", i)
			r.InvoiceRefID = fmt.Sprintf("INV-%d", i)
		case 1:
			r.Receipt = fmt.Sprintf("JNT%04d", i)
		case 2:
			r.InvoiceRefID = fmt.Sprintf("PO#41%02d", i)
		}

		// Every date a status carries, after the creation and spread so a window cuts through each.
		created := 30 - i/2
		switch status {
		case restockStatusArrived:
			r.ArrivedAt = at(created - 2)
			r.ArrivedByUserID = 9
		case restockStatusAccepted:
			r.ArrivedAt = at(created - 2)
			r.AcceptedAt = at(created - 3)
			r.AcceptedByUserID = []uint64{9, 10}[i%2]
		case restockStatusLost:
			r.LostAt = at(created - 4)
		case restockStatusCancelled:
			r.CancelledAt = at(created - 1)
		}

		err := db.Create(&r).Error
		if err != nil {
			t.Fatalf("seed restock %d: %v", i, err)
		}

		for l := range 1 + i%3 {
			p := products[(i+l)%len(products)]

			err = db.Create(&inventory_service_models.RestockItem{
				RestockID:   r.ID,
				ProductID:   p.id,
				ProductCode: p.code,
				Name:        p.name,
				Count:       int64(1 + l),
				Total:       1000,
				PriceUnit:   1000,
				CreatedAt:   now,
				UpdatedAt:   now,
			}).Error
			if err != nil {
				t.Fatalf("seed line %d/%d: %v", i, l, err)
			}
		}

		ids = append(ids, r.ID)
	}

	return ids
}

// oldRestockListPage is RestockRequestList's read as written before restockListScope — VERBATIM from the scope to the
// page, returning the page's ids and the total instead of building the response.
func oldRestockListPage(
	s *Service,
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestListRequest],
) ([]uint64, int64, error) {
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

	query = oldApplyRestockDateRange(query, req.Msg.GetFilter())
	query = oldApplyRestockSearch(query, req.Msg.GetFilter().GetQ())

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, restockErr(err)
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
		return nil, 0, restockErr(err)
	}

	ids := make([]uint64, 0, len(rrs))
	for i := range rrs {
		ids = append(ids, rrs[i].ID)
	}

	return ids, total, nil
}

// oldRestockDateColumn is restockDateColumn before the ARRIVED / LOST fix — verbatim.
func oldRestockDateColumn(field inventoryv1.RestockDateField) string {
	switch field {
	case inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_ACCEPTED:
		return "accepted_at"
	case inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_CANCELLED:
		return "cancelled_at"
	default:
		return "created_at"
	}
}

// oldApplyRestockDateRange is applyRestockDateRange as it was — verbatim but for the column helper's old name.
func oldApplyRestockDateRange(query *gorm.DB, filter *inventoryv1.RestockRequestListFilter) *gorm.DB {
	from, to := filter.GetFromUnix(), filter.GetToUnix()

	if from == 0 && to == 0 {
		return query
	}

	column := oldRestockDateColumn(filter.GetDateField())

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

// oldApplyRestockSearch is applyRestockSearch as it was — its code verbatim, its long comments dropped.
func oldApplyRestockSearch(query *gorm.DB, q string) *gorm.DB {
	q = strings.TrimSpace(q)
	if q == "" {
		return query
	}

	if strings.HasPrefix(q, "#") {
		id, err := strconv.ParseUint(strings.TrimPrefix(q, "#"), 10, 64)
		if err == nil && id != 0 {
			return query.Where("restocks.id = ?", id)
		}
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

	id, err := strconv.ParseUint(strings.TrimPrefix(q, "#"), 10, 64)
	if err == nil && id != 0 {
		conditions = append(conditions, "restocks.id = ?")
		args = append(args, id)
	}

	return query.Where("("+strings.Join(conditions, " OR ")+")", args...)
}
