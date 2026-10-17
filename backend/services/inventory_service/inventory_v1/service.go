// Package inventory_v1 implements inventory_service's RPCs — on-hand stock, restocks, racks, orders' takes and
// warehouse transfers.
//
// Stock lives in the decided ledgers (inventory_ledgers): every change is one inventory transaction, written through a
// mutation (inventory_mutations) into the batch ledger and the placement ledger together. Every RPC is scoped by its
// team (use_scope); product_id is an opaque product_service id.
package inventory_v1

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1/inventoryv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

type Service struct {
	db *gorm.DB
	// Where the COD obligation goes when a restock is accepted (#184) — an interface this service
	// owns, so inventory never imports liability_service. See liability_poster.go.
	liability LiabilityPoster
	// Where the value of written-off stock goes when a batch is adjusted DAMAGED/LOST (#211) — an
	// interface this service owns, so inventory never imports expense_service. See expense_poster.go.
	expense ExpensePoster
	// Whether a restock's supplier is a live one — asked of supplier_service, which owns suppliers since
	// the-supplier-gets-its-own-service. See supplier_checker.go in the composition root.
	suppliers SupplierChecker
	// What inventory must know of a product — its owner, lock, reserve, markup, sku and name — asked of product_service. A
	// restock and a transfer carry only the team's own products, and the order take checks the rest. See product_reader.go
	// in the composition root.
	products ProductReader
	// Where an accepted restock is announced (`RestockAccepted`) — supplier_service folds it into a supplier's figures
	// (the-report-is-processed-like-settlement). Inventory does not know who listens.
	events event_source.EventSender
}

// SupplierChecker answers whether a supplier is LIVE — any selling team's
// (a-team-restocks-from-another-teams-supplier), not deleted. teamID is the CALLER's scope for the question,
// not the supplier's team. Asked of supplier_service under the caller's token.
type SupplierChecker interface {
	SupplierIsLive(ctx context.Context, teamID, supplierID uint64) (bool, error)
	// Stores answers, for each store (supplier channel) id, the supplier it belongs to and whether it is live — deleted
	// stores included, marked. An id that exists nowhere is absent from the map.
	Stores(ctx context.Context, teamID uint64, storeIDs []uint64) (map[uint64]SupplierStore, error)
}

// SupplierStore is what inventory needs to know about a store a restock line names: whose it is, and whether it may be
// newly named (a-line-may-name-a-supplier-without-a-channel).
type SupplierStore struct {
	SupplierID uint64
	Live       bool
}

// noSuppliers refuses every supplier — with nothing to ask, a restock naming one is not trusted.
type noSuppliers struct{}

func (noSuppliers) SupplierIsLive(context.Context, uint64, uint64) (bool, error) {
	return false, errors.New("no supplier service to ask")
}

func (noSuppliers) Stores(context.Context, uint64, []uint64) (map[uint64]SupplierStore, error) {
	return nil, errors.New("no supplier service to ask")
}

// compile-time proof Service satisfies the generated handler interfaces it serves.
var (
	_ inventoryv1connect.InventoryServiceHandler         = (*Service)(nil)
	_ inventoryv1connect.RestockRequestServiceHandler    = (*Service)(nil)
	_ inventoryv1connect.RackServiceHandler              = (*Service)(nil)
	_ inventoryv1connect.OrderTransactionServiceHandler  = (*Service)(nil)
	_ inventoryv1connect.WarehouseTransferServiceHandler = (*Service)(nil)
)

func NewService(
	db *gorm.DB,
	liability LiabilityPoster,
	expense ExpensePoster,
	suppliers SupplierChecker,
	events event_source.EventSender,
	products ProductReader,
) *Service {
	// A nil poster drops COD obligations silently, which is the right default for a test receiving a
	// box and the wrong one for production — the composition root always wires the real thing, and
	// the reconciliation report (#187) is what would catch it if it ever did not.
	if liability == nil {
		liability = noLiability{}
	}

	// Likewise a nil expense poster drops the loss VALUE (not the stock movement) — fine for a test
	// that only cares about quantities, wired for real in production (#211).
	if expense == nil {
		expense = noExpense{}
	}

	// A nil supplier checker refuses every supplier rather than trusting one — a test that names no
	// supplier never asks.
	if suppliers == nil {
		suppliers = noSuppliers{}
	}

	// A nil sender would panic on the first accept. EmptySender still VALIDATES the event, so a malformed one is
	// caught with no broker in sight — the right default for a test receiving a box.
	if events == nil {
		events = event_source.EmptySender
	}

	// A nil product reader counts every product as the asking team's own — a test raising its own restock has no
	// product_service; the composition root always wires the real one.
	if products == nil {
		products = factsUnchecked{}
	}

	return &Service{db: db, liability: liability, expense: expense, suppliers: suppliers, events: events, products: products}
}

// actorFrom pulls the acting user's id from the request identity (0 if somehow absent — the ledger records who, but a
// missing actor must not fail a stock change).
func actorFrom(ctx context.Context) uint64 {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return 0
	}

	return identity.GetIdentityId()
}
