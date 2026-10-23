package selling_v1

import (
	"context"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// orderScopeFilter is the slice of a request's filter that OrderList and OrderStat SHARE — everything
// that changes WHICH ORDERS EXIST for the screen.
//
// It is an interface rather than a struct, and satisfied STRUCTURALLY by both `*OrderListFilter` and
// `*OrderStatFilter`, so there is no adapter to keep in step: drop one of these fields from either
// proto message and this stops compiling. A pair of hand-written converters is exactly where the two
// filters would quietly drift apart, which is the one failure this shared builder exists to prevent.
//
// `status` is deliberately NOT here. It is the list's TAB, and the stat GROUPS BY status — filtering
// the stat to one would leave every other tab's count at zero.
//
// Protobuf getters are nil-safe, so a request with no filter at all satisfies this and reads as
// "no filter" throughout.
type orderScopeFilter interface {
	GetProductId() uint64
	GetSearch() string
	GetShopId() uint64
	GetCreatedFromUnix() int64
	GetCreatedToUnix() int64
	GetCreatedByUserId() uint64
	GetSellerTeamId() uint64
	GetMarketplace() marketplacev1.Marketplace
	GetShippingCode() string
	GetWarehouseId() uint64
	GetDateField() sellingv1.OrderDateField
}

// A literal `%`, `_` or `\` typed into the search box must match ITSELF, not act as a wildcard.
// Without this, a lone "%" matches every order in the team — a search that silently returns everything
// reads as "no filter applied" rather than as a bad query.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// readsEveryTeam reports whether a read is scoped to the ROOT team, and so crosses every team
// (root-reads-every-teams-orders). The root team is the one scope only ROOT and ADMIN hold, so this is
// no new permission — it is the rule settlement's reports already use (isRootScope). Without it a root
// reader matched neither leg of the scope and got an empty list under its Team column.
//
// READS ONLY. A write scoped to the root team still names the order's own team or warehouse.
func readsEveryTeam(teamID uint64) bool {
	return teamID == san_auth.RootTeamID
}

// scopedOrders builds the set of orders a team may see — the WHOLE set, before any status filter.
//
// It is shared by OrderList and OrderStat rather than written twice, and that is what makes the stat
// TRUE OF THE LIST: a scope or a filter that lived in only one of them would put a header above a
// table describing a different set of orders, which is worse than no header at all.
func scopedOrders(query *gorm.DB, teamID uint64, filter orderScopeFilter) *gorm.DB {
	// BOTH SIDES (#151): the team that placed the order, or the warehouse shipping it. The latter is
	// the pick queue. The root team reads every team's orders and skips the clause.
	//
	// The parentheses are written explicitly even though GORM does not need them here — it wraps a
	// chained Where containing an OR before AND-ing the next one, so the generated SQL is already
	// `(team_id = ? OR warehouse_id = ?) AND status = ?`. (Verified against the emitted SQL, not
	// assumed.) They stay because the correctness of the status filter added later should be readable
	// from THIS line rather than resting on an ORM behaviour: precedence is what makes an OR-plus-
	// filter go wrong, and hand-built SQL a refactor away would not be so forgiving.
	if !readsEveryTeam(teamID) {
		query = query.Where("(team_id = ? OR warehouse_id = ?)", teamID, teamID)
	}

	// Only orders carrying THIS product on a line (#159). An EXISTS subquery rather than a JOIN: a join
	// against a one-to-many would return the order once PER MATCHING LINE, so an order listing the same
	// product twice would appear twice and the paginated count would be wrong.
	if productID := filter.GetProductId(); productID != 0 {
		query = query.Where(
			"EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = orders.id AND oi.product_id = ?)",
			productID,
		)
	}

	// The shop the order was placed on. Meaningful to a selling team only — a warehouse holds no shops
	// and leaves this at 0.
	if shopID := filter.GetShopId(); shopID != 0 {
		query = query.Where("shop_id = ?", shopID)
	}

	// Free text over the customer's name, their phone, and the order id when the term is all digits.
	//
	// The whole disjunction is wrapped in ONE parenthesised clause, written by hand rather than chained
	// through GORM's Or(): this OR sits between the scope's OR above it and the status filter after it,
	// and an unparenthesised `a OR b AND c` here would let a search leak orders from teams the caller
	// cannot see. That is a data-exposure bug rather than a wrong-rows bug, so precedence is stated
	// rather than inherited.
	term := strings.TrimSpace(filter.GetSearch())
	if term != "" {
		args := map[string]any{"like": "%" + likeEscaper.Replace(term) + "%"}

		// An order id is what somebody quotes off a chat message or a label, so a numeric term searches
		// it as well as the text columns — never INSTEAD of them, because a phone number is also digits
		// and matching only the id would lose the more likely hit.
		// The MARKETPLACE REFERENCE is searched beside the customer's name and phone, because it is the
		// number a person is most often holding when they come looking: it is what the buyer quotes,
		// what a payout report lists, and what the storefront's own support asks for. A field that can
		// only be read once you have already found the order would not have been worth typing.
		//
		// The TRACKING NUMBER for the same reason, from the other end: a parcel in somebody's hand carries
		// its slip, and the slip's number is what a scan or a buyer's "where is it" gives you
		// (a-label-scan-reads-the-ref-or-the-receipt).
		clause := `(customer_name ILIKE @like ESCAPE '\' OR customer_phone ILIKE @like ESCAPE '\'` +
			` OR order_external_ref_id ILIKE @like ESCAPE '\' OR receipt ILIKE @like ESCAPE '\')`

		id, err := strconv.ParseUint(term, 10, 64)
		if err == nil && id > 0 {
			clause = `(customer_name ILIKE @like ESCAPE '\' OR customer_phone ILIKE @like ESCAPE '\'` +
				` OR order_external_ref_id ILIKE @like ESCAPE '\' OR receipt ILIKE @like ESCAPE '\' OR id = @id)`
			args["id"] = id
		}

		query = query.Where(clause, args)
	}

	// The date window, inclusive on both ends. 0 on a side is an OPEN end, so a one-sided window ("everything since
	// March") is expressible rather than needing a far-future upper bound.
	//
	// WHICH DATE is the filter's choice (the-date-filter-switches-created-or-platform): when we wrote the row, by
	// default, or when the buyer ordered. The column is picked from a closed set here, never interpolated from input.
	dateColumn := "created_at"
	if filter.GetDateField() == sellingv1.OrderDateField_ORDER_DATE_FIELD_PLATFORM_CREATED {
		dateColumn = "platform_created_at"
	}

	if from := filter.GetCreatedFromUnix(); from > 0 {
		query = query.Where(dateColumn+" >= ?", time.Unix(from, 0))
	}

	if to := filter.GetCreatedToUnix(); to > 0 {
		query = query.Where(dateColumn+" <= ?", time.Unix(to, 0))
	}

	// WHO TYPED IT IN. An order whose creator was never recorded (0) matches nobody: the guard is the
	// `> 0`, so a cleared picker is "anybody" and never "the unrecorded ones".
	if createdBy := filter.GetCreatedByUserId(); createdBy > 0 {
		query = query.Where("created_by_user_id = ?", createdBy)
	}

	// The warehouse's three filters (the-filter-gains-seller-marketplace-and-courier).
	if sellerTeam := filter.GetSellerTeamId(); sellerTeam > 0 {
		query = query.Where("team_id = ?", sellerTeam)
	}

	// A shop's marketplace never changes (a-shops-marketplace-and-team-are-fixed), so the order's shop answers it:
	// a subquery on shops, which live in this database.
	if marketplace := filter.GetMarketplace(); marketplace != marketplacev1.Marketplace_MARKETPLACE_UNSPECIFIED {
		query = query.Where("shop_id IN (SELECT id FROM shops WHERE marketplace = ?)", san_marketplace.ToText(marketplace))
	}

	if courier := strings.TrimSpace(filter.GetShippingCode()); courier != "" {
		query = query.Where("shipping_code = ?", courier)
	}

	// The seller list's warehouse filter — the building the order ships FROM. ANDed with the scope, so a warehouse
	// naming another warehouse here reads nothing rather than reaching orders it does not ship.
	if warehouseID := filter.GetWarehouseId(); warehouseID > 0 {
		query = query.Where("warehouse_id = ?", warehouseID)
	}

	return query
}

// orderListColumns is what a list row selects: the order, plus the two facts it carries without its children — the
// unit count over its lines (the-warehouse-row-fills-from-shop-and-user-by-ids) and when it entered its current status
// (a-filtered-status-shows-its-own-date). Each is one correlated lookup per row of the PAGE, on an index led by
// order_id: order_items_order_idx and order_timeline_logs_order_idx.
const orderListColumns = "orders.*, " +
	"(SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = orders.id) AS item_quantity, " +
	"(SELECT MAX(tl.created_at) FROM order_timeline_logs tl WHERE tl.order_id = orders.id AND tl.status = orders.status) AS status_at"

// OrderList returns the scoped team's orders, newest first, paginated. Summaries only — the lines
// come from OrderDetail.
func (s *Service) OrderList(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderListRequest],
) (*connect.Response[sellingv1.OrderListResponse], error) {
	page := req.Msg.GetPage()

	teamID := req.Msg.GetTeamId()

	query := scopedOrders(
		s.db.WithContext(ctx).Model(&selling_service_models.Order{}),
		teamID,
		req.Msg.GetFilter(),
	)

	// One status, or all of them — the ONE filter the stat above this list does not share, because it
	// is the tab. Server-side because the list is PAGINATED: a client-side filter would narrow the
	// loaded page only, and the count would still be the unfiltered total.
	if status := orderStatusToText(req.Msg.GetFilter().GetStatus()); status != "" {
		query = query.Where("status = ?", status)
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var orders []selling_service_models.Order

	offset := int((page.GetPage() - 1) * page.GetLimit())

	// THE PAGE FIRST, THEN ITS FACTS. The bare page is chosen in a derived table, and only then are the unit count and
	// the status date (orderListColumns) computed — for the page's rows alone. Selected in one pass, each correlated
	// lookup also ran for every row the OFFSET skipped: 50 000 of them on a last page, about two-thirds of its 252 ms
	// (audits/services/selling_service/performances/OrderList.md). The sort is applied again outside because a derived
	// table promises no order.
	pageRows := query.
		Select("orders.*").
		Order(orderOrderClause(req.Msg.GetSort())).
		Offset(offset).
		Limit(int(page.GetLimit()))

	err = s.db.
		WithContext(ctx).
		Table("(?) AS orders", pageRows).
		Select(orderListColumns).
		Order(orderOrderClause(req.Msg.GetSort())).
		Find(&orders).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	items, ids := orderListItems(orders, req.Msg.GetDataRequest())

	return connect.NewResponse(&sellingv1.OrderListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
