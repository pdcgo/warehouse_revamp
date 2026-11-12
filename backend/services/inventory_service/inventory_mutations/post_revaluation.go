package inventory_mutations

import (
	"errors"
	"fmt"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// The refusals a price correction makes under the batch's lock. Each comes wrapped in a RevalueRefusal that names the
// batch in a person's words; the caller maps them with errors.Is.
var (
	// ErrRevalueNotOwned: no such batch, or another team's — one answer, so an id cannot probe another team's batches.
	ErrRevalueNotOwned = errors.New("batch not found")
	// ErrRevalueNoUnits: a correction changes only the units left (a-late-cost-is-an-expense-not-a-revaluation), and there
	// are none.
	ErrRevalueNoUnits = errors.New("the batch has no units left — a price correction changes only the units left")
	// ErrRevaluePriceMoved: the batch's price is no longer the one the form showed — someone corrected it first.
	ErrRevaluePriceMoved = errors.New("the batch's price changed since the form opened")
	// ErrRevalueSamePrice: the new price is the batch's price — nothing to correct.
	ErrRevalueSamePrice = errors.New("the batch is already at that price")
)

// RevalueRefusal is a refused correction: `Kind` is one of the ErrRevalue… sentinels, the text names the batch and the
// figure, as the form shows it.
type RevalueRefusal struct {
	Kind error
	Text string
}

func (e *RevalueRefusal) Error() string { return e.Text }

func (e *RevalueRefusal) Unwrap() error { return e.Kind }

func refuse(kind error, format string, args ...any) error {
	return &RevalueRefusal{Kind: kind, Text: fmt.Sprintf(format, args...)}
}

// Revaluation is a price correction as the owning team asks for it (the-owning-team-revalues-with-a-reason).
type Revaluation struct {
	// The OWNING team — the batch's own team_id (a-batch-carries-its-owner). Any other team's batch is ErrRevalueNotOwned.
	TeamID  uint64
	BatchID uint64
	// The price the form showed — an optimistic check against a correction that landed meanwhile.
	ExpectedPriceUnit float64
	NewPriceUnit      float64
	// Required, trimmed by the caller — the transaction's and both log rows' description.
	Reason     string
	ActorID    uint64
	IsOverride bool
}

// Revalued is a posted correction: its transaction and what it changed.
type Revalued struct {
	Transaction models.InventoryTransaction
	inventory_ledgers.Revalued
}

// PostRevaluation writes a price correction (revaluation-and-opname-are-transaction-types): ONE batch's new unit price
// for the units it has LEFT, nothing moved. Under the batch's row lock — the only lock it takes, and the first
// (batches-lock-before-shelves-by-id) — it refuses another team's batch, a batch with no units left, a price that moved
// since the form opened, and the same price; then one `revaluation` transaction for the owning team in the batch's
// warehouse (stamped an override when Root acted from outside), the batch ledger's Revalue (the log row, the price log,
// the batch), and one item: the product, quantity 0, total |the value change| — items are positive, the batch row
// carries the sign (an-item-equals-its-batch-rows). No rack row, no event: no unit and no money moved. Never rolled back
// (a-rollback-only-undoes-a-take).
func PostRevaluation(tx *gorm.DB, r Revaluation) (Revalued, error) {
	b, err := inventory_ledgers.LockBatch(tx, r.BatchID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Revalued{}, refuse(ErrRevalueNotOwned, "batch not found")
	}

	if err != nil {
		return Revalued{}, err
	}

	if b.TeamID != r.TeamID {
		return Revalued{}, refuse(ErrRevalueNotOwned, "batch not found")
	}

	if b.StockCount <= 0 {
		return Revalued{}, refuse(ErrRevalueNoUnits,
			"batch #%d has no units left — a price correction changes only the units left", b.ID)
	}

	if !san_money.Equal(b.PriceUnit, r.ExpectedPriceUnit) {
		return Revalued{}, refuse(ErrRevaluePriceMoved,
			"batch #%d's price changed to %s since the form opened — check it and correct again", b.ID, san_money.Text(b.PriceUnit))
	}

	if san_money.Equal(b.PriceUnit, r.NewPriceUnit) {
		return Revalued{}, refuse(ErrRevalueSamePrice, "batch #%d is already at %s", b.ID, san_money.Text(b.PriceUnit))
	}

	t, err := inventory_ledgers.CreateTransaction(tx, inventory_ledgers.NewTransaction{
		WarehouseID: b.WarehouseID,
		TeamID:      b.TeamID,
		TxType:      models.TxRevaluation,
		ActorID:     r.ActorID,
		IsOverride:  r.IsOverride,
		Description: r.Reason,
	})
	if err != nil {
		return Revalued{}, err
	}

	changed, err := inventory_ledgers.Revalue(tx, &b, inventory_ledgers.Revaluation{
		Transaction:  t,
		NewPriceUnit: r.NewPriceUnit,
		ActorID:      r.ActorID,
		Description:  r.Reason,
	})
	if err != nil {
		return Revalued{}, err
	}

	total := changed.ValueChange
	if total < 0 {
		total = -total
	}

	err = inventory_ledgers.AddItems(tx, t, []inventory_ledgers.ItemLine{{
		ProductID: b.ProductID, ProductTeamID: b.TeamID, Quantity: 0, Total: total,
	}})
	if err != nil {
		return Revalued{}, err
	}

	return Revalued{Transaction: t, Revalued: changed}, nil
}
