// Package settlement_importer_v1 implements warehouse.settlement_importer.v1.SettlementImporterService —
// a platform statement, uploaded as a file and posted to the settlement ledger line by line
// (docs/business/settlement/settlement_importer.md).
//
// THE SHAPE OF ONE IMPORT (the-import-is-one-streamed-call): the shop is checked, the file is stored, its
// own row is written, and then — detached from the request (an-import-finishes-whether-anyone-watches) —
// the file is read, every ref is resolved in one call, the file is checked, and every line is posted,
// each step a leveled log line on the stream (every-stream-message-is-a-leveled-log-line).
//
// ⚠ THE IMPORTER OWNS NO LEDGER. It is a CLIENT of four services — the shop, orders, documents and
// settlement — through interfaces this package declares, answered at the composition root by Connect
// clients that forward the uploader's own token. Every row it posts is posted AS the uploader.
package settlement_importer_v1

import (
	"context"
	"errors"
	"math"
	"sync"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1/settlement_importerv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// ShopChecker is ShopAccessCheck (the-shop-is-checked-before-the-file-is-stored): the shop, whether the
// uploader may write on it, and its primary CS — in one answer. A shop that is not a live shop of the
// team answers a connect NotFound.
type ShopChecker interface {
	CheckShop(ctx context.Context, teamID, shopID, userID uint64) (ShopCheck, error)
}

// ShopCheck is what the importer reads off ShopAccessCheck.
type ShopCheck struct {
	ID            uint64
	Name          string
	Marketplace   marketplacev1.Marketplace
	PrimaryUserID uint64
	HasAccess     bool
}

// OrderFinder is OrderByExternalRefs — every order of the team a statement's refs name, in one call per
// file. A ref nothing carries is absent from the map.
type OrderFinder interface {
	OrdersByRefs(ctx context.Context, teamID uint64, refs []string) (map[string][]OrderRef, error)
}

// OrderRef is one of the team's orders carrying a ref.
type OrderRef struct {
	OrderID         uint64
	ShopID          uint64
	CreatedByUserID uint64
	Cancelled       bool
}

// StatementStore is document_service's two-phase upload, used as its client — RequestUpload, PUT,
// ConfirmUpload — under the uploader's token. It answers the stored document's id.
type StatementStore interface {
	StoreStatement(ctx context.Context, teamID uint64, filename string, content []byte) (string, error)
}

// Ledger is SettlementPost, with source `importer` (the-source-is-named-importer). Idempotent on the key:
// a line already in the ledger answers Created false (the-row-key-is-the-only-dedupe).
type Ledger interface {
	Post(ctx context.Context, post LedgerPost) (LedgerResult, error)
}

// LedgerPost is one line, as settlement takes it.
type LedgerPost struct {
	TeamID  uint64
	ShopID  uint64
	OrderID uint64 // 0 = the shop

	UniqueID       string
	SettlementType settlementv1.SettlementType
	Change         int64
	OccurredOn     string // YYYY-MM-DD
	Note           string

	// The order's creator — stamped on the order's account if this post opens it.
	CreatedByUserID uint64
}

type LedgerResult struct {
	LogID   uint64
	Created bool
}

type Service struct {
	db *gorm.DB

	shops  ShopChecker
	orders OrderFinder
	store  StatementStore
	ledger Ledger

	now func() time.Time

	// Every import still running — detached from its request, so nothing else is waiting on it.
	// Wait lets a shutdown let them finish.
	running sync.WaitGroup
}

var _ settlement_importerv1connect.SettlementImporterServiceHandler = (*Service)(nil)

func NewService(db *gorm.DB, shops ShopChecker, orders OrderFinder, store StatementStore, ledger Ledger) *Service {
	return &Service{
		db:     db,
		shops:  shops,
		orders: orders,
		store:  store,
		ledger: ledger,
		now:    time.Now,
	}
}

// Wait blocks until every import started so far has finished — for a graceful shutdown, which would
// otherwise leave a file half-posted and reading interrupted.
func (s *Service) Wait() {
	s.running.Wait()
}

const dateLayout = "2006-01-02"

// interruptedAfter is how long a running row may go without moving before it reads INTERRUPTED — the
// server stopped mid-file (an-import-finishes-whether-anyone-watches). Its updated_at moves after every
// line, and no line takes anywhere near this long.
const interruptedAfter = 2 * time.Minute

// The stored text of each status, outcome and reason — mapped to the wire in mapper.go.
const (
	statusRunning = "running"
	statusDone    = "done"
	statusFailed  = "failed"

	outcomePosted   = "posted"
	outcomeExisting = "existing"
	outcomeHeld     = "held"
	outcomeSkipped  = "skipped"

	reasonNoOrder             = "no_order"
	reasonUnmappedType        = "unmapped_type"
	reasonFractionalAmount    = "fractional_amount"
	reasonRefused             = "refused"
	reasonRepeatsOrderDetails = "repeats_order_details"
	reasonFailedWithdrawal    = "failed_withdrawal"
)

var errFileMissing = errors.New("uploaded file not found")

func notFound() error {
	return connect.NewError(connect.CodeNotFound, errFileMissing)
}

func dbError(err error) error {
	return connect.NewError(connect.CodeInternal, err)
}

// uploaderFrom is the identity on the import's token — the actor on every row it posts. 0 if absent,
// which the shop check then refuses: it asks about a user, and 0 is nobody.
func uploaderFrom(ctx context.Context) uint64 {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return 0
	}

	return identity.GetIdentityId()
}

func totalPages(total int64, limit uint32) uint32 {
	if limit == 0 {
		return 0
	}

	return uint32(math.Ceil(float64(total) / float64(limit)))
}

// wholeRupiah converts the reader's float64 to settlement's int64 — or refuses a fraction, which has never
// happened in any sample and so means the file is not what we think (critique 8). Never rounded.
func wholeRupiah(amount float64) (int64, bool) {
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount != math.Trunc(amount) {
		return 0, false
	}

	if amount > math.MaxInt64 || amount < math.MinInt64 {
		return 0, false
	}

	return int64(amount), true
}
