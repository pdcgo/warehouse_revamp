package inventory_v1

import (
	"context"

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

	// THE LIST'S ONE PREDICATE (restock_list_scope.go): both sides' scope and every filter — the same set its statistics
	// and its export read.
	query := restockListScope(s.db.WithContext(ctx), teamID, req.Msg.GetFilter())

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
		// them opens the request, where RestockRequestDetail loads them. What the rows DO draw of the
		// damage — each line's missing and broken units — comes as counts below (withRestockProblemCounts).
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

	// ITS TAGS (backlog #87) — the page's, in ONE statement on the key of `restock_tags`.
	err = withRestockTags(s.db.WithContext(ctx), out...)
	if err != nil {
		return nil, restockErr(err)
	}

	// WHAT WENT WRONG AT THE DOOR, AS COUNTS (backlog #89, the-restock-tags-prototype-is-accepted: *on accepted rows kurang
	// N · rusak N*; a-restock-problem-is-a-system-tag: *the problem list is the restock listed with missing and broken
	// count*) — the page's, in ONE grouped statement.
	err = withRestockProblemCounts(s.db.WithContext(ctx), rrs, out)
	if err != nil {
		return nil, restockErr(err)
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

// withRestockProblemCounts fills each line's `problems` on a page of list rows with what the rows draw of them — the
// units counted MISSING and BROKEN at the door, per line and kind (the-restock-tags-prototype-is-accepted: *on accepted
// rows kurang N · rusak N*). The lists read a line's problems by kind and count (features/restock/summary.ts
// missingQuantity / brokenQuantity), so that is all a row carries: no price or total (a list row is read by both sides,
// and a-warehouse-sees-no-seller-money), no note, no photo — those are the detail's (RestockRequestDetail preloads the
// rows whole).
//
// ONE grouped statement over the page's ACCEPTED restocks — the accept is the only write of problem rows
// (tiba-marks-and-terima-is-final), so a page with none accepted asks nothing — served by the key the rows are unique on,
// `restock_problem_items_one_per_kind` (restock_id, product_id, problem_type). Keyed by restock AND product: a product
// appears once per restock (a-product-appears-once-per-restock), so the pair is the line, and one restock's rows never
// land on another's line of the same product.
func withRestockProblemCounts(db *gorm.DB, rows []inventory_service_models.Restock, wire []*inventoryv1.RestockRequest) error {
	ids := make([]uint64, 0, len(rows))
	for i := range rows {
		if rows[i].Status == restockStatusAccepted {
			ids = append(ids, rows[i].ID)
		}
	}

	if len(ids) == 0 {
		return nil
	}

	var counts []struct {
		RestockID   uint64
		ProductID   uint64
		ProblemType string
		Count       int64
	}

	err := db.
		Model(&inventory_service_models.RestockProblemItem{}).
		Select("restock_id, product_id, problem_type, SUM(count) AS count").
		Where("restock_id IN ?", ids).
		Group("restock_id, product_id, problem_type").
		Order("restock_id, product_id, problem_type").
		Scan(&counts).
		Error
	if err != nil {
		return err
	}

	type line struct{ restock, product uint64 }

	byLine := make(map[line]*inventoryv1.RestockRequestItem)
	for _, r := range wire {
		for _, item := range r.GetItems() {
			byLine[line{r.GetId(), item.GetProductId()}] = item
		}
	}

	for _, c := range counts {
		item := byLine[line{c.RestockID, c.ProductID}]
		if item == nil {
			continue
		}

		item.Problems = append(item.Problems, &inventoryv1.RestockProblemItem{
			Type:  restockProblemTypeFromText(c.ProblemType),
			Count: c.Count,
		})
	}

	return nil
}
