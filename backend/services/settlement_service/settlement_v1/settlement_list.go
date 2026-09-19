package settlement_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// OrderSettlementList serves the list screen — one row per order, ranked by loss by default.
//
// ⚠ "Ranked by loss" is the reason the screen exists, so it is the DEFAULT sort rather than an option
// somebody has to find. A residual balance is normal and nothing will ever clear it, so the only
// useful question the list answers is *which orders lost the most*.
func (s *Service) OrderSettlementList(
	ctx context.Context,
	req *connect.Request[settlementv1.OrderSettlementListRequest],
) (*connect.Response[settlementv1.OrderSettlementListResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()

	query := s.db.WithContext(ctx).
		Model(&settlement_service_models.OrderSettlement{}).
		Where("team_id = ?", msg.GetTeamId())

	if filter.GetShopId() != 0 {
		query = query.Where("shop_id = ?", filter.GetShopId())
	}

	// The period narrows on when the ACCOUNT last moved, which is what a person means by "January's
	// settlements" — not when the order was placed, which settlement does not know.
	if raw := filter.GetFrom(); raw != "" {
		from, err := parseDate(raw)
		if err != nil {
			return nil, err
		}

		query = query.Where("updated_at >= ?", from)
	}

	if raw := filter.GetTo(); raw != "" {
		to, err := parseDate(raw)
		if err != nil {
			return nil, err
		}

		// Inclusive at both ends, so a single-day range is `from == to` and returns that day.
		query = query.Where("updated_at < ?", to.AddDate(0, 0, 1))
	}

	if q := filter.GetQ(); q != "" {
		// The only text this ledger holds about an order is its id — settlement keys on OUR order id
		// and never sees the marketplace's reference, so there is nothing else to match on.
		query = query.Where("CAST(order_id AS TEXT) LIKE ?", "%"+q+"%")
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	// ⚠ THE TOTALS ARE THE WHOLE FILTERED SET, NOT THIS PAGE. The card above the list is an implied
	// take-rate for the period; one that changed as you turned pages would be reporting the page,
	// which nobody asked about.
	var totals struct {
		InitialTotal int64
		LastBalance  int64
	}

	err = query.
		Session(&gorm.Session{}).
		Select("COALESCE(SUM(initial_total), 0) AS initial_total, COALESCE(SUM(last_balance), 0) AS last_balance").
		Scan(&totals).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	page := msg.GetPage()
	limit := page.GetLimit()
	offset := (page.GetPage() - 1) * limit

	var rows []settlement_service_models.OrderSettlement

	err = query.
		Session(&gorm.Session{}).
		Order(sortClause(msg.GetSort())).
		Limit(int(limit)).
		Offset(int(offset)).
		Find(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	// The guideline's list shape: `ids` carries the ORDER, and the map slices carry the data. The
	// caller asks for the slices it needs, so a picker and a table share one RPC without either
	// paying for the other's columns.
	ids := make([]uint64, 0, len(rows))
	settlements := make(map[uint64]*settlementv1.OrderSettlement, len(rows))

	for i := range rows {
		ids = append(ids, rows[i].OrderID)
		settlements[rows[i].OrderID] = settlementToProto(&rows[i])
	}

	items := []*settlementv1.OrderSettlementListResponseItem{}

	for _, want := range msg.GetDataRequest() {
		if want == settlementv1.OrderSettlementListDataType_ORDER_SETTLEMENT_LIST_DATA_TYPE_SETTLEMENT {
			items = append(items, &settlementv1.OrderSettlementListResponseItem{
				D: &settlementv1.OrderSettlementListResponseItem_Settlement{
					Settlement: &settlementv1.OrderSettlementMapItem{MapData: settlements},
				},
			})
		}
	}

	// A caller that asked for nothing still gets the accounts. The alternative is an empty screen
	// whenever a client forgets the enum, which reads as "this team has never settled anything".
	if len(items) == 0 {
		items = append(items, &settlementv1.OrderSettlementListResponseItem{
			D: &settlementv1.OrderSettlementListResponseItem_Settlement{
				Settlement: &settlementv1.OrderSettlementMapItem{MapData: settlements},
			},
		})
	}

	return connect.NewResponse(&settlementv1.OrderSettlementListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, limit),
			TotalItems:  uint64(total),
		},
		TotalInitialTotal: totals.InitialTotal,
		TotalLastBalance:  totals.LastBalance,
	}), nil
}

// sortClause maps the proto's sort selection to SQL.
//
// ⚠ The default is `last_balance ASC` — MOST NEGATIVE FIRST, which is the biggest loss. Ascending
// looks wrong until you remember the sign convention: a loss is a negative balance, so the worst
// order is the smallest number.
func sortClause(sort *settlementv1.OrderSettlementListFilterSort) string {
	direction := "ASC"
	if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_DESC {
		direction = "DESC"
	}

	switch sort.GetSort() {
	case settlementv1.OrderSettlementSort_ORDER_SETTLEMENT_SORT_ORDER_ID:
		return "order_id " + direction
	case settlementv1.OrderSettlementSort_ORDER_SETTLEMENT_SORT_INITIAL_TOTAL:
		return "initial_total " + direction
	default:
		// Loss. Unspecified lands here too, so the screen opens on the question it exists to answer.
		if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_DESC {
			return "last_balance DESC"
		}

		return "last_balance ASC"
	}
}
