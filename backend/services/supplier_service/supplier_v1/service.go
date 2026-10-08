// Package supplier_v1 implements the suppliers a selling team buys from, and the online stores each one
// sells through (docs/business/supplier/context_decision.md).
//
// Two rules shape every handler here:
//
//   - READS CROSS TEAMS, WRITES DO NOT (another-team-sees-everything-of-a-supplier). Any team may read any
//     live supplier and its stores; only the team that keeps a supplier writes it. `team_id` on a request is
//     the CALLER's scope — so a write adds `team_id = ?` to its WHERE, and a read does not.
//   - DELETE IS SOFT (a-deleted-supplier-is-kept-for-its-figures, a-store-delete-is-soft-too). Every read
//     states `deleted_at IS NULL` itself, except SupplierByIds, which returns a deleted supplier marked.
//
// The FIGURES (analytic_*.go) are a fold of the restock's *Restock Accepted* event into
// `supplier_product_daily_reports`, read back like settlement's reports (the-report-is-processed-like-settlement).
package supplier_v1

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1/supplierv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// SellingTeams answers whether a team is a SELLING team — asked of team_service, under the caller's token.
// SupplierCreate needs it (only-a-selling-team-has-suppliers): the request policy keeps a warehouse's own
// people out, but Root and the Administrator bypass the scope and could otherwise create one anywhere.
type SellingTeams interface {
	// IsSelling reports whether teamID is a selling team. An unknown team is false, not an error.
	IsSelling(ctx context.Context, teamID uint64) (bool, error)
}

type Service struct {
	db    *gorm.DB
	teams SellingTeams

	// What AnalyticReplayCompute seeks and reads the retention of.
	broker ReplayBroker
}

// compile-time proof Service serves every proto service. One implementation behind four — the split is about who may
// call each, and a service is mounted whole.
var (
	_ supplierv1connect.SupplierServiceHandler                    = (*Service)(nil)
	_ supplierv1connect.SupplierChannelServiceHandler             = (*Service)(nil)
	_ supplierv1connect.SupplierAnalyticServiceHandler            = (*Service)(nil)
	_ supplierv1connect.SupplierAnalyticMaintenanceServiceHandler = (*Service)(nil)
)

func NewService(db *gorm.DB, teams SellingTeams, broker ReplayBroker) *Service {
	// With no team service to ask, every SupplierCreate is REFUSED rather than trusted.
	if teams == nil {
		teams = noSellingTeams{}
	}

	// With no broker every replay is REFUSED, never faked.
	if broker == nil {
		broker = noReplayBroker{}
	}

	return &Service{db: db, teams: teams, broker: broker}
}

type noSellingTeams struct{}

func (noSellingTeams) IsSelling(context.Context, uint64) (bool, error) {
	return false, errors.New("no team service to ask")
}

var (
	errSupplierMissing = errors.New("supplier not found")
	errChannelMissing  = errors.New("supplier store not found")
	errNotSelling      = errors.New("only a selling team has suppliers")
)

func notFound(err error) error {
	return connect.NewError(connect.CodeNotFound, err)
}

func internal(err error) error {
	return connect.NewError(connect.CodeInternal, err)
}

// ownLiveSupplier loads a LIVE supplier OF THIS TEAM — the scope check of every write. Another team's
// supplier, a deleted one and an unknown id all read as NotFound: a write cannot tell them apart, and must
// not tell the caller which one it was.
func ownLiveSupplier(tx *gorm.DB, teamID, supplierID uint64) (*supplier_service_models.Supplier, error) {
	var supplier supplier_service_models.Supplier

	err := tx.
		Where("id = ? AND team_id = ? AND deleted_at IS NULL", supplierID, teamID).
		Take(&supplier).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, notFound(errSupplierMissing)
	}
	if err != nil {
		return nil, internal(err)
	}

	return &supplier, nil
}

// liveSupplier loads ANY team's live supplier — the scope of a read.
func liveSupplier(tx *gorm.DB, supplierID uint64) (*supplier_service_models.Supplier, error) {
	var supplier supplier_service_models.Supplier

	err := tx.
		Where("id = ? AND deleted_at IS NULL", supplierID).
		Take(&supplier).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, notFound(errSupplierMissing)
	}
	if err != nil {
		return nil, internal(err)
	}

	return &supplier, nil
}

// ownLiveChannel loads a live store of a live supplier OF THIS TEAM — the scope check of a store write.
func ownLiveChannel(tx *gorm.DB, teamID, channelID uint64) (*supplier_service_models.SupplierChannel, error) {
	var channel supplier_service_models.SupplierChannel

	err := tx.
		Joins("JOIN suppliers ON suppliers.id = supplier_channels.supplier_id").
		Where("supplier_channels.id = ? AND supplier_channels.deleted_at IS NULL", channelID).
		Where("suppliers.team_id = ? AND suppliers.deleted_at IS NULL", teamID).
		Take(&channel).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, notFound(errChannelMissing)
	}
	if err != nil {
		return nil, internal(err)
	}

	return &channel, nil
}

// forShare locks the rows a SELECT reads FOR SHARE: a concurrent UPDATE of them — a delete — waits for this
// transaction, while other readers and other FOR SHARE lockers do not.
func forShare() clause.Locking {
	return clause.Locking{Strength: "SHARE"}
}

// ── Paging and search ───────────────────────────────────────────────────────────────────────────

// pageOffset is the SQL OFFSET for a 1-based page.
func pageOffset(page *commonv1.CommonPagination) int {
	return int((page.GetPage() - 1) * page.GetLimit())
}

func pageInfo(page *commonv1.CommonPagination, total int64) *commonv1.PageInfo {
	var totalPage uint32

	limit := page.GetLimit()
	if limit > 0 {
		totalPage = uint32((total + int64(limit) - 1) / int64(limit))
	}

	return &commonv1.PageInfo{
		CurrentPage: page.GetPage(),
		TotalPage:   totalPage,
		TotalItems:  uint64(total),
	}
}

// likePattern turns a search term into an ILIKE pattern, its own wildcards neutralised so "%" does not
// match everything. "" means no search.
func likePattern(q string) string {
	q = strings.TrimSpace(q)
	if q == "" {
		return ""
	}

	return "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q) + "%"
}
