// Package selling_v1 implements warehouse.selling.v1.ShopService — a selling team's marketplace
// shops (#66). selling_service will grow to own orders too (the #23 decomposition).
//
// Every RPC is team-scoped: the request carries team_id (use_scope), and each query is constrained
// to that team, so a caller can never read or mutate another team's shop by id.
package selling_v1

import (
	"errors"
	"math"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

type Service struct {
	db *gorm.DB
	// How an order moves stock when it is placed or cancelled (#149/#70). An interface this service
	// owns, so selling_service never imports inventory_service — see stock_picker.go.
	stock StockPicker
	// Where an OrderPlacedEvent goes (#153). selling_service does not know or care that
	// revenue_service is listening — it announces what happened and is done.
	events event_source.EventSender
	// Product LABELS, for promoting a draft (#194). A draft line stores only a product_id, and an
	// order line freezes the sku and name — see product_catalog.go for why they cannot come from the
	// request the way OrderCreate's do.
	catalog ProductCatalog
}

// compile-time proof Service satisfies both generated handler interfaces (one selling_service impl
// serves ShopService and OrderService).
var (
	_ sellingv1connect.ShopServiceHandler       = (*Service)(nil)
	_ sellingv1connect.OrderServiceHandler      = (*Service)(nil)
	_ sellingv1connect.OrderDraftServiceHandler = (*Service)(nil)
)

func NewService(
	db *gorm.DB,
	stock StockPicker,
	events event_source.EventSender,
	catalog ProductCatalog,
) *Service {
	// A nil sender would panic on the first order placed, which is a long way from where the mistake
	// was made. EmptySender still VALIDATES the event and drops it, so a malformed event is caught even
	// with no broker in sight — that is the right default for a local run, not a silent nil.
	if events == nil {
		events = event_source.EmptySender
	}

	return &Service{db: db, stock: stock, events: events, catalog: catalog}
}

var errShopMissing = errors.New("shop not found")

// #72: an order must say which warehouse fulfils it. From #69 that id is what stock is deducted from,
// so an order without one is an order the system cannot honour.
var errOrderNoWarehouse = errors.New("an order must say which warehouse fulfils it")

func notFound() error {
	return connect.NewError(connect.CodeNotFound, errShopMissing)
}

// dbError maps a duplicate shop code to AlreadyExists (a client error) and everything else to
// Internal.
func dbError(err error) error {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return connect.NewError(connect.CodeAlreadyExists,
			errors.New("a shop with this code already exists in the team"))
	}

	return connect.NewError(connect.CodeInternal, err)
}

// shopExists reports whether an ACTIVE shop with this id exists IN THIS TEAM. The team_id clause is
// the scope check — it is what stops one team touching another's shop by id.
func shopExists(tx *gorm.DB, teamID, shopID uint64) (bool, error) {
	var count int64

	err := tx.
		Model(&selling_service_models.Shop{}).
		Where("id = ? AND team_id = ? AND deleted = ?", shopID, teamID, false).
		Count(&count).
		Error

	return count > 0, err
}

func withUpdatedAt(updates map[string]any) map[string]any {
	updates["updated_at"] = time.Now()

	return updates
}

// escapeLike neutralises LIKE wildcards so a search for "%" doesn't match everything.
func escapeLike(q string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
}

func totalPages(total int64, limit uint32) uint32 {
	if limit == 0 {
		return 0
	}

	return uint32(math.Ceil(float64(total) / float64(limit)))
}
