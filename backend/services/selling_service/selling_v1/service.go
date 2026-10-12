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
	"gorm.io/gorm/clause"

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
	// Whether this team may take on more debt, asked BEFORE an order is written (#189). An interface
	// this service owns, so selling_service never imports liability_service — see credit_checker.go.
	credit CreditChecker
	// Product LABELS, for promoting a draft (#194). A draft line stores only a product_id, and an
	// order line freezes the sku and name — see product_catalog.go for why they cannot come from the
	// request the way OrderCreate's do.
	catalog ProductCatalog
	// Opens and cancels an order's marketplace settlement account, AFTER the order commits
	// (settlement #order-service-calls-settlement). An interface this service owns, so selling_service
	// never imports settlement_service — see settlement_poster.go.
	settlement SettlementPoster
	// A user's role in a team — what ShopAccessCheck needs to tell a manager, who writes on any shop,
	// from everyone else, who needs a grant (a-write-needs-a-grant-or-a-manager). An interface this
	// service owns, so selling_service never imports user_service — see role_reader.go.
	roles RoleReader
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
	credit CreditChecker,
	settlement SettlementPoster,
	roles RoleReader,
) *Service {
	// A nil sender would panic on the first order placed, which is a long way from where the mistake
	// was made. EmptySender still VALIDATES the event and drops it, so a malformed event is caught even
	// with no broker in sight — that is the right default for a local run, not a silent nil.
	if events == nil {
		events = event_source.EmptySender
	}

	// A nil checker would panic on the first order placed. Permissive is the right default for a run
	// with no ledger wired up — placing an order must not depend on a downstream service existing —
	// and it is NOT the production default: the composition root wires the real one.
	if credit == nil {
		credit = noCredit{}
	}

	// Same reasoning as the checker: an order must not depend on a downstream ledger being wired up.
	if settlement == nil {
		settlement = noSettlement{}
	}

	// With no role reader nobody is a manager, so only a grant opens a shop — the direction that fails
	// closed. The composition root wires the real one.
	if roles == nil {
		roles = noRoles{}
	}

	return &Service{
		db:         db,
		stock:      stock,
		events:     events,
		catalog:    catalog,
		credit:     credit,
		settlement: settlement,
		roles:      roles,
	}
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

// lockShop is shopExists taking the shop's row FOR UPDATE — what serialises every change to the shop's
// primary CS, so two grants landing on a shop with none cannot both become it.
func lockShop(tx *gorm.DB, teamID, shopID uint64) (bool, error) {
	var shops []selling_service_models.Shop

	err := tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id").
		Where("id = ? AND team_id = ? AND deleted = ?", shopID, teamID, false).
		Find(&shops).
		Error

	return len(shops) > 0, err
}

// loadPrimaries fills each shop's PrimaryUserID from its flagged grant — one query for the page.
func loadPrimaries(tx *gorm.DB, shops []selling_service_models.Shop) error {
	if len(shops) == 0 {
		return nil
	}

	ids := make([]uint64, 0, len(shops))
	for i := range shops {
		ids = append(ids, shops[i].ID)
	}

	var primaries []selling_service_models.ShopUser

	err := tx.
		Select("shop_id", "user_id").
		Where("shop_id IN ? AND is_primary", ids).
		Find(&primaries).
		Error
	if err != nil {
		return err
	}

	byShop := make(map[uint64]uint64, len(primaries))
	for _, p := range primaries {
		byShop[p.ShopID] = p.UserID
	}

	for i := range shops {
		shops[i].PrimaryUserID = byShop[shops[i].ID]
	}

	return nil
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
