package settlement_v1

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// OrderLine is one line of a placed order, in this service's own terms: who owns the goods and what
// they cost. Not the wire type — the push handler translates, so the ledger's domain does not depend
// on another service's contract.
type OrderLine struct {
	OwningTeamID uint64
	Quantity     uint32
	UnitCost     int64
}

// PlacedOrder is what settlement needs to charge an order (#186).
type PlacedOrder struct {
	// The SELLING team — the one that owes, on every fee an order produces.
	TeamID uint64
	// The warehouse that fulfils it: the creditor of the handling fee.
	WarehouseID uint64
	OrderID     uint64
	Lines       []OrderLine
}

// basisPoints is the denominator of a markup: 10.000 bp = 100%.
const basisPoints = 10_000

// ChargeOrder posts an order's fees (#186): a HANDLING FEE to the fulfilling warehouse, and a PRODUCT
// FEE to each team whose goods the order sold.
//
// ⚠ EVERY POSTING IS IDEMPOTENT, and it has to be: this runs from a Pub/Sub push, which delivers at
// least once. `ErrAlreadyPosted` is swallowed per fee rather than failing the batch — a redelivery
// where one fee landed and another did not must be able to complete the second without refusing the
// first.
//
// Each fee is its OWN transaction rather than one covering all of them. That looks weaker and is
// deliberately not: the alternative is that a single bad counterparty rolls back fees that were
// perfectly correct, and the redelivery then has to re-post them all — which is only safe because of
// the idempotency this design already has. Per-fee, a partial success stays done and the redelivery
// finishes the rest.
func (s *Service) ChargeOrder(ctx context.Context, order PlacedOrder) error {
	err := s.chargeHandlingFee(ctx, order)
	if err != nil {
		return err
	}

	return s.chargeProductFees(ctx, order)
}

// chargeHandlingFee bills the warehouse's flat per-order rate.
//
// NO RATE CONFIGURED MEANS NOTHING IS CHARGED. A warehouse that has set nothing is not silently
// billing anybody, and that is the deliberate default rather than an oversight — the alternative
// would have every warehouse in the system quietly accruing receivables it never asked for.
func (s *Service) chargeHandlingFee(ctx context.Context, order PlacedOrder) error {
	if order.WarehouseID == 0 || order.WarehouseID == order.TeamID {
		// An order with no warehouse cannot say who fulfilled it, and a team fulfilling its own order
		// owes nobody. Neither is an error worth failing a delivery over.
		return nil
	}

	terms, err := s.termsFor(ctx, order.WarehouseID, order.TeamID)
	if err != nil {
		return err
	}

	if terms.HandlingFee <= 0 {
		return nil
	}

	return s.postOrderFee(ctx, order.TeamID, order.WarehouseID, terms.HandlingFee,
		SourceTypeHandlingFee, order.OrderID)
}

// chargeProductFees bills each OWNING TEAM for its goods that this order sold.
//
// The anchor is the line's frozen `unit_cost` (HPP), never the buyer-paid price:
//
//	fee = Σ over that team's lines (unit_cost × quantity) × (1 + markup)
//
// A markup on what the buyer paid is a commission model wearing a sale's clothes. On goods that cost
// 60.000 and sold for 100.000 at 20%, cost+markup owes the owner 72.000 while buyer-paid+markup owes
// 20.000 — the owner loses 40.000 on their own stock.
//
// ONE FEE PER OWNING TEAM, not per line: two lines of the same team's goods are one debt, and the
// idempotency key is (source_type, source_id, counterparty), so per-line postings would collide.
func (s *Service) chargeProductFees(ctx context.Context, order PlacedOrder) error {
	costByOwner := map[uint64]int64{}

	for _, line := range order.Lines {
		owner := line.OwningTeamID

		// 0 = the owner could not be resolved when the order was placed. Nobody to pay, and a guess
		// would be a debt against a team picked by accident.
		if owner == 0 || owner == order.TeamID {
			continue
		}

		costByOwner[owner] += int64(line.Quantity) * line.UnitCost
	}

	// Sorted so a redelivery posts in the same order as the first attempt. It changes no outcome —
	// each fee is its own transaction and its own idempotency key — but it makes the ledger's ids
	// read in a stable order, which matters when somebody is comparing two runs by eye.
	owners := make([]uint64, 0, len(costByOwner))
	for owner := range costByOwner {
		owners = append(owners, owner)
	}

	sortUint64s(owners)

	for _, owner := range owners {
		cost := costByOwner[owner]

		// ⚠ A COST OF ZERO MEANS UNKNOWN, NOT FREE — a product received straight into stock has no
		// recorded cost. Under cost+markup that computes a fee of zero, so the owning team is silently
		// owed nothing for goods that really left its stock.
		//
		// The decision (Q10) is to LET THAT STAND and have the reconciliation report name it, rather
		// than refuse a real sale over a bookkeeping gap. Nothing is posted, because a zero-amount
		// entry would consume this pair's idempotency key for this order — so the real fee, if the
		// cost were ever backfilled, could never be posted afterwards.
		if cost <= 0 {
			continue
		}

		terms, err := s.termsFor(ctx, owner, order.TeamID)
		if err != nil {
			return err
		}

		fee := cost + cost*terms.ProductMarkupBP/basisPoints
		if fee <= 0 {
			continue
		}

		err = s.postOrderFee(ctx, order.TeamID, owner, fee, SourceTypeProductFee, order.OrderID)
		if err != nil {
			return err
		}
	}

	return nil
}

// postOrderFee posts one fee, treating "already posted" as done.
func (s *Service) postOrderFee(
	ctx context.Context,
	debtorID, creditorID uint64,
	amount int64,
	sourceType SourceType,
	orderID uint64,
) error {
	_, err := s.PostEntry(ctx, nil, Posting{
		DebtorTeamID:   debtorID,
		CreditorTeamID: creditorID,
		Amount:         amount,
		SourceType:     sourceType,
		SourceID:       orderID,
	})
	if errors.Is(err, ErrAlreadyPosted) {
		return nil
	}

	return err
}

// ReverseOrder undoes an order's fees when it is cancelled (#186).
//
// ⚠ IT READS BACK WHAT WAS CHARGED rather than being told. The cancel event carries only ids, and it
// does not need more: the ledger already knows exactly which counterparties were billed and how much,
// so re-deriving it from the order would be a second calculation that could disagree with the first.
// A rate changed between placement and cancellation would make it disagree by design.
//
// A REVERSAL IS A COMPENSATING ENTRY, never a delete. The original stays, the balance nets to zero,
// and the history shows the fee was charged and then returned — "the fee briefly existed" is exactly
// what an audit needs to see.
func (s *Service) ReverseOrder(ctx context.Context, teamID, orderID uint64) error {
	var charged []settlement_service_models.SettlementEntry

	// The DEBTOR'S legs only. Both sides of a movement are stored, so reading every row for this
	// order would find each fee twice and reverse it twice — the second one refused as a duplicate,
	// but only by luck rather than by intent.
	err := s.db.
		WithContext(ctx).
		Where("team_id = ? AND source_id = ? AND reversal = ?", teamID, orderID, false).
		Where("source_type IN ?", []string{sourceHandlingFee, sourceProductFee}).
		Order("id").
		Find(&charged).
		Error
	if err != nil {
		return err
	}

	for i := range charged {
		entry := charged[i]

		// The debtor's leg is negative; the amount to reverse is its magnitude.
		amount := -entry.Amount
		if amount <= 0 {
			continue
		}

		_, err = s.PostEntry(ctx, nil, Posting{
			DebtorTeamID:   entry.TeamID,
			CreditorTeamID: entry.CounterpartyID,
			Amount:         amount,
			SourceType:     sourceTypeFromText(entry.SourceType),
			SourceID:       entry.SourceID,
			Reversal:       true,
		})
		if err != nil && !errors.Is(err, ErrAlreadyPosted) {
			return err
		}
	}

	return nil
}

// termsFor resolves a creditor's terms toward one debtor: their own row, else the creditor's DEFAULT
// row (counterparty 0), else nothing.
//
// "Nothing" is a zero-valued row rather than an error, and that is the whole default story: no
// configuration means charge nothing and limit nothing. A creditor that has set up nothing is neither
// billing nor blocking anybody, which is the only safe way for this to arrive in a running system.
func (s *Service) termsFor(
	ctx context.Context,
	creditorID, debtorID uint64,
) (settlement_service_models.SettlementTerms, error) {
	var terms settlement_service_models.SettlementTerms

	// Ordered so the specific row wins over the default; one query rather than two round trips.
	err := s.db.
		WithContext(ctx).
		Where("team_id = ? AND counterparty_id IN ?", creditorID, []uint64{debtorID, 0}).
		Order("counterparty_id DESC").
		Take(&terms).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return settlement_service_models.SettlementTerms{}, nil
	}

	return terms, err
}

// sortUint64s is an insertion sort over a handful of team ids — small enough that pulling in `sort`
// would be the heavier choice, the same call `encodeTouched` makes in selling_service.
func sortUint64s(ids []uint64) {
	for i := 1; i < len(ids); i++ {
		for j := i; j > 0 && ids[j] < ids[j-1]; j-- {
			ids[j], ids[j-1] = ids[j-1], ids[j]
		}
	}
}
