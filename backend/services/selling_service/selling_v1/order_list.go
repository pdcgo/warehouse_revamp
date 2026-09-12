package selling_v1

import (
	"context"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
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
}

// A literal `%`, `_` or `\` typed into the search box must match ITSELF, not act as a wildcard.
// Without this, a lone "%" matches every order in the team — a search that silently returns everything
// reads as "no filter applied" rather than as a bad query.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// scopedOrders builds the set of orders a team may see — the WHOLE set, before any status filter.
//
// It is shared by OrderList and OrderStat rather than written twice, and that is what makes the stat
// TRUE OF THE LIST: a scope or a filter that lived in only one of them would put a header above a
// table describing a different set of orders, which is worse than no header at all.
func scopedOrders(query *gorm.DB, teamID uint64, filter orderScopeFilter) *gorm.DB {
	// BOTH SIDES (#151): the team that placed the order, or the warehouse shipping it. The latter is
	// the pick queue.
	//
	// The parentheses are written explicitly even though GORM does not need them here — it wraps a
	// chained Where containing an OR before AND-ing the next one, so the generated SQL is already
	// `(team_id = ? OR warehouse_id = ?) AND status = ?`. (Verified against the emitted SQL, not
	// assumed.) They stay because the correctness of the status filter added later should be readable
	// from THIS line rather than resting on an ORM behaviour: precedence is what makes an OR-plus-
	// filter go wrong, and hand-built SQL a refactor away would not be so forgiving.
	query = query.Where("(team_id = ? OR warehouse_id = ?)", teamID, teamID)

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
		clause := `(customer_name ILIKE @like ESCAPE '\' OR customer_phone ILIKE @like ESCAPE '\'` +
			` OR order_external_ref_id ILIKE @like ESCAPE '\')`

		id, err := strconv.ParseUint(term, 10, 64)
		if err == nil && id > 0 {
			clause = `(customer_name ILIKE @like ESCAPE '\' OR customer_phone ILIKE @like ESCAPE '\'` +
				` OR order_external_ref_id ILIKE @like ESCAPE '\' OR id = @id)`
			args["id"] = id
		}

		query = query.Where(clause, args)
	}

	// When the order was PLACED, inclusive on both ends. 0 on a side is an OPEN end, so a one-sided
	// window ("everything since March") is expressible rather than needing a far-future upper bound.
	if from := filter.GetCreatedFromUnix(); from > 0 {
		query = query.Where("created_at >= ?", time.Unix(from, 0))
	}

	if to := filter.GetCreatedToUnix(); to > 0 {
		query = query.Where("created_at <= ?", time.Unix(to, 0))
	}

	return query
}

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

	err = query.
		Order(orderOrderClause(req.Msg.GetSort())).
		Offset(offset).
		Limit(int(page.GetLimit())).
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
