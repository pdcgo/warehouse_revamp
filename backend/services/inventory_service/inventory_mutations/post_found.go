package inventory_mutations

import (
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// A FOUND AT THE SHELF, APPROVED (an-adjust-found-waits-for-the-owner-or-admin). The units a found request reports on
// one rack go through the stock count's OWN found: PostCountFinalize over one product with one row — counted at the
// units, over a book of 0 — so the claim of the oldest open losses back into their batches at their price, the mint of
// the rest at the team's newest batch price here, the register's claimed counts, both ledgers and the money the `found`
// transaction carries are exactly what a count's surplus of the same units posts (a-surplus-claims-the-oldest-loss-first,
// a-claim-records-its-units, last-price-is-the-teams-newest-batch-here). There is no second claim or mint.
//
// The approval is a door OUTSIDE a count, so it refuses — under the rack row's lock, in a statement of its own — a rack
// a count holds (a-lock-stops-sales-and-cancels-too). A count that finalizes while the request waits settles it instead
// (a-count-settles-the-found-it-counted, inventory_v1.settleFoundByCount).

// FoundUnits is what a found request reports: units of one owner's product on one rack.
type FoundUnits struct {
	WarehouseID   uint64
	TeamID        uint64
	ProductID     uint64
	PlacementID   uint64
	PlacementCode string
	Count         int64
}

// asCount is the found as a stock count of its rack would read it: a book of 0 and the units counted.
func (u FoundUnits) asCount() CountProduct {
	return CountProduct{
		TeamID:    u.TeamID,
		ProductID: u.ProductID,
		Rows:      []CountRow{{PlacementID: u.PlacementID, PlacementCode: u.PlacementCode, System: 0, Counted: u.Count}},
	}
}

// StockedHere is whether the team ever had a batch of the product in this warehouse — emptied batches count. It is the
// test last-price-is-the-teams-newest-batch-here finds the mint's price by, so a found the report lets through always
// has a price to mint at (a-found-never-stocked-here-is-refused-at-the-report).
func StockedHere(tx *gorm.DB, warehouseID, teamID, productID uint64) (bool, error) {
	owner := inventory_ledgers.ProductOwner{TeamID: teamID, ProductID: productID}

	prices, err := newestPricesHere(tx, warehouseID, []inventory_ledgers.ProductOwner{owner})
	if err != nil {
		return false, err
	}

	_, ok := prices[owner]

	return ok, nil
}

// FoundLine is one line approving would post: a claim (with when its loss was recorded) or the mint.
type FoundLine struct {
	SettleLine
	ProblemCreatedAt time.Time
}

// FoundPreview is what approving one request NOW would post — or NoPrice when it cannot post at all: nothing to claim
// and its team never had a batch of the product here (last-price-is-the-teams-newest-batch-here).
type FoundPreview struct {
	Lines   []FoundLine
	NoPrice bool
}

// PreviewFound works out, over ONE plain read of the register and the prices for them all, what approving each found
// would post now — each on its own, as if it were the only one approved. Read without locks: another approval or a
// count's finalize may claim the same loss first, and the approval re-reads it under lock.
func PreviewFound(db *gorm.DB, warehouseID uint64, units []FoundUnits) ([]FoundPreview, error) {
	out := make([]FoundPreview, len(units))
	if len(units) == 0 {
		return out, nil
	}

	products := make([]CountProduct, 0, len(units))
	for _, u := range units {
		products = append(products, u.asCount())
	}

	// The book is read once per OWNER's product, however many requests name it — a page of 200 found Kaos is one pair.
	seen := map[inventory_ledgers.ProductOwner]bool{}
	owners := make([]CountProduct, 0, len(products))

	for _, p := range products {
		owner := inventory_ledgers.ProductOwner{TeamID: p.TeamID, ProductID: p.ProductID}
		if seen[owner] {
			continue
		}

		seen[owner] = true
		owners = append(owners, p)
	}

	book, err := LoadCountBook(db, warehouseID, owners, false)
	if err != nil {
		return nil, err
	}

	lossAt := map[uint64]time.Time{}
	for _, losses := range book.OpenLosses {
		for _, l := range losses {
			lossAt[l.ID] = l.CreatedAt
		}
	}

	for i, p := range products {
		settled, settleErr := SettleCount(book, []CountProduct{p})
		if errors.Is(settleErr, ErrNeverStockedHere) {
			out[i].NoPrice = true

			continue
		}

		if settleErr != nil {
			return nil, settleErr
		}

		for _, l := range settled[0].Lines {
			out[i].Lines = append(out[i].Lines, FoundLine{SettleLine: l, ProblemCreatedAt: lossAt[l.ProblemID]})
		}
	}

	return out, nil
}

// FoundApproval is an approved found: its units, who approved it, and what its transaction says.
type FoundApproval struct {
	FoundUnits
	ActorID uint64
	// Stamped on the transaction (an-override-is-stamped-in-every-service).
	IsOverride  bool
	Description string
}

// FoundApproved is what an approval posted: the one `found` transaction with the money it carries, its lines, and the
// batch it minted (0 when the claims took every unit).
type FoundApproved struct {
	Transaction   CountTransaction
	Lines         []SettleLine
	MintedBatchID uint64
}

// PostFoundApproval posts an approved found in the caller's database transaction, through PostCountFinalize: the
// register's open losses, the batches, then the rack row are locked in that order, and the rack is refused when a
// count holds it. ErrNeverStockedHere when there is no price to mint at.
func PostFoundApproval(tx *gorm.DB, a FoundApproval) (FoundApproved, error) {
	posted, err := PostCountFinalize(tx, CountFinalize{
		WarehouseID: a.WarehouseID,
		ActorID:     a.ActorID,
		IsOverride:  a.IsOverride,
		Description: a.Description,
		Products:    []CountProduct{a.asCount()},
		Guard:       inventory_ledgers.RefuseCounted,
	})
	if err != nil {
		return FoundApproved{}, err
	}

	var out FoundApproved

	for _, ct := range posted.Transactions {
		if ct.TxType != models.TxFound {
			return FoundApproved{}, errors.New("a found posted a transaction other than `found`")
		}

		out.Transaction = ct
	}

	if out.Transaction.Transaction.ID == 0 {
		return FoundApproved{}, errors.New("a found posted nothing")
	}

	if len(out.Transaction.MintedBatchIDs) > 0 {
		out.MintedBatchID = out.Transaction.MintedBatchIDs[0]
	}

	for _, s := range posted.Settled {
		for _, l := range s.Lines {
			if l.Type == SettleMint {
				l.BatchID = out.MintedBatchID
			}

			out.Lines = append(out.Lines, l)
		}
	}

	return out, nil
}
