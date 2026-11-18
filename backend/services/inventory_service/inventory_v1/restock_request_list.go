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
