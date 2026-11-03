package inventory_mutations

import (
	"errors"
	"fmt"
	"sort"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// A STOCK COUNT'S FINALIZE (docs/business/inventory/opname.md §How We Manage Stock Problem In Warehouses). Each product
// is settled over every rack of the session (a-count-nets-each-product-across-the-session) in two parts
// (broken-posts-as-written-the-rest-nets):
//
//   - BROKEN — the drafts' broken, summed, posted as written: units in the trash (a-broken-unit-is-thrown-away);
//   - THE REST — sellable counted − (book − broken): short is LOST, over CLAIMS the oldest open loss back into its batch
//     at its price and MINTS the remainder at the team's newest price here (a-surplus-claims-the-oldest-loss-first,
//     last-price-is-the-teams-newest-batch-here), 0 is units on the wrong rack — a MOVE.
//
// Per owning team that is up to three transactions (problem-and-found-replace-opname): `problem` (broken then lost, each
// oldest batch first — broken-takes-its-batch-before-lost — with one register row per type per batch), `found` (the
// claims and the mint) and `move` (the rack corrections that net to 0). Every rack ends at its sellable count.
//
// SettleCount is the arithmetic and nothing else, so the preview and the post are one rule.

var (
	// ErrCountTakesMoreThanHeld refuses a finalize whose broken and lost take more units than the product's batches hold
	// now — a count that throws away more than the book ever had, or a product sold during the count past what was
	// counted. Nothing is guessed: the count is sent back or cancelled.
	ErrCountTakesMoreThanHeld = errors.New("the count takes more units than the product's batches hold")
)

// CountRow is one snapshot row as a finalize reads it.
type CountRow struct {
	PlacementID   uint64
	PlacementCode string
	// The book at the snapshot (expected-is-the-book-figure).
	System int64
	// The sellable count that stands.
	Counted int64
	// The row's broken draft — units thrown away — and its reason.
	Broken     int64
	BrokenNote string
	// The reason on the row's lost draft; its number is not posted (lost is the netted rest).
	LostNote string
}

// CountProduct is one owner's product over every rack of the session.
type CountProduct struct {
	TeamID    uint64
	ProductID uint64
	Rows      []CountRow
}

// SettleType is what one settlement line posts.
type SettleType int

const (
	SettleBroken SettleType = iota + 1
	SettleLost
	SettleClaim
	SettleMint
)

// SettleLine is one batch's part of a product's settlement.
type SettleLine struct {
	Type SettleType
	// The batch taken from or claimed back into; 0 for a mint.
	BatchID uint64
	// A claim's lost problem.
	ProblemID uint64
	Count     int64
	PriceUnit float64
	// Broken and lost: the value the batch gives up (an-emptying-take-takes-all-the-value). A claim or a mint: count ×
	// price.
	Amount float64
}

// ProductSettlement is what a finalize posts for one product.
type ProductSettlement struct {
	TeamID    uint64
	ProductID uint64
	Book      int64
	Sellable  int64
	Broken    int64
	// sellable − (book − broken).
	Rest int64
	// Racks whose count differs from their book.
	RackChanges int64
	Lines       []SettleLine
	// The units the `move` carries off the racks it corrects down.
	Moved int64

	// The rack rows, per placement: broken and lost are taken off (problem), found put on (found), move signed.
	RackBroken map[uint64]int64
	RackLost   map[uint64]int64
	RackFound  map[uint64]int64
	RackMove   map[uint64]int64

	// The register rows' rack, when one rack alone explains them (a-problem-row-names-its-rack); 0 otherwise.
	BrokenPlacementID uint64
	LostPlacementID   uint64
	// "rack code: note" joined by " · " (a-problem-note-names-its-racks).
	BrokenNote string
	LostNote   string
}

// Posts is whether the product posts anything at all — a product whose racks all match and holds no broken draft only
// has its rows released.
func (p ProductSettlement) Posts() bool {
	return p.RackChanges > 0 || p.Broken > 0
}

// CountBook is what settling reads beside the counts: the products' batches, each owner's open losses oldest first, and
// each owner's newest batch price here (absent = the team never had it here).
type CountBook struct {
	Batches     *inventory_ledgers.LockedBatches
	OpenLosses  map[inventory_ledgers.ProductOwner][]models.WarehouseStockProblem
	NewestPrice map[inventory_ledgers.ProductOwner]float64
}

// rest is a product's rest, worked from its rows alone.
func rest(p CountProduct) (book, sellable, broken, r int64) {
	for _, row := range p.Rows {
		book += row.System
		sellable += row.Counted
		broken += row.Broken
	}

	return book, sellable, broken, sellable - (book - broken)
}

// LoadCountBook reads what SettleCount needs for the products. With lock, every row it reads is locked for the post, in
// the decided order (batches-lock-before-shelves-by-id): the register's open losses first — the record rows a claim
// changes, as rule 21 of the ledgers recommends — then the batches, the claims' batches among them, in one statement in
// id order. The caller has locked the session row before it. Without lock it is the preview's plain read.
func LoadCountBook(tx *gorm.DB, warehouseID uint64, products []CountProduct, lock bool) (CountBook, error) {
	book := CountBook{
		OpenLosses:  map[inventory_ledgers.ProductOwner][]models.WarehouseStockProblem{},
		NewestPrice: map[inventory_ledgers.ProductOwner]float64{},
	}

	var drawOwners, overOwners []inventory_ledgers.ProductOwner

	for _, p := range products {
		owner := inventory_ledgers.ProductOwner{TeamID: p.TeamID, ProductID: p.ProductID}
		_, _, broken, r := rest(p)

		if broken > 0 || r < 0 {
			drawOwners = append(drawOwners, owner)
		}

		if r > 0 {
			overOwners = append(overOwners, owner)
		}
	}

	var claimBatches []uint64

	if len(overOwners) > 0 {
		pairs := make([][]any, 0, len(overOwners))
		for _, o := range overOwners {
			pairs = append(pairs, []any{o.TeamID, o.ProductID})
		}

		query := tx
		if lock {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}

		var losses []models.WarehouseStockProblem

		err := query.
			Where("warehouse_id = ? AND (team_id, product_id) IN ? AND problem_type = ? AND claimed_stock_count < claimable_stock_count",
				warehouseID, pairs, models.ProblemLost).
			Order("created_at, id").
			Find(&losses).Error
		if err != nil {
			return book, fmt.Errorf("open losses of %d product(s): %w", len(pairs), err)
		}

		for _, l := range losses {
			owner := inventory_ledgers.ProductOwner{TeamID: l.TeamID, ProductID: l.ProductID}
			book.OpenLosses[owner] = append(book.OpenLosses[owner], l)
			claimBatches = append(claimBatches, l.BatchID)
		}

		book.NewestPrice, err = newestPricesHere(tx, warehouseID, overOwners)
		if err != nil {
			return book, err
		}
	}

	var err error

	if lock {
		book.Batches, err = inventory_ledgers.LockBatchesWith(tx, warehouseID, drawOwners, claimBatches)
	} else {
		book.Batches, err = inventory_ledgers.ReadBatchesWith(tx, warehouseID, drawOwners, claimBatches)
	}

	if err != nil {
		return book, err
	}

	return book, nil
}

// SettleCount works out what a finalize posts for each product, in (team, product) order. It changes nothing.
func SettleCount(book CountBook, products []CountProduct) ([]ProductSettlement, error) {
	sorted := append([]CountProduct(nil), products...)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].TeamID != sorted[j].TeamID {
			return sorted[i].TeamID < sorted[j].TeamID
		}

		return sorted[i].ProductID < sorted[j].ProductID
	})

	out := make([]ProductSettlement, 0, len(sorted))

	for _, p := range sorted {
		s, err := settleProduct(book, p)
		if err != nil {
			return nil, err
		}

		out = append(out, s)
	}

	return out, nil
}

func settleProduct(book CountBook, p CountProduct) (ProductSettlement, error) {
	rows := append([]CountRow(nil), p.Rows...)
	sort.Slice(rows, func(i, j int) bool { return rows[i].PlacementID < rows[j].PlacementID })

	b, sellable, broken, r := rest(CountProduct{Rows: rows})

	s := ProductSettlement{
		TeamID: p.TeamID, ProductID: p.ProductID, Book: b, Sellable: sellable, Broken: broken, Rest: r,
		RackBroken: map[uint64]int64{}, RackLost: map[uint64]int64{}, RackFound: map[uint64]int64{}, RackMove: map[uint64]int64{},
	}

	// The residual of each rack once its broken is off: what the rest is made of.
	residual := map[uint64]int64{}

	var brokenNotes, lostNotes []string
	brokenRacks := 0

	for _, row := range rows {
		if row.Counted != row.System {
			s.RackChanges++
		}

		if row.Broken > 0 {
			s.RackBroken[row.PlacementID] = row.Broken
			brokenRacks++
			s.BrokenPlacementID = row.PlacementID
			brokenNotes = append(brokenNotes, row.PlacementCode+": "+row.BrokenNote)
		}

		if strings.TrimSpace(row.LostNote) != "" {
			lostNotes = append(lostNotes, row.PlacementCode+": "+row.LostNote)
		}

		residual[row.PlacementID] = row.Counted - row.System + row.Broken
	}

	if brokenRacks != 1 {
		s.BrokenPlacementID = 0
	}

	s.BrokenNote = strings.Join(brokenNotes, " · ")
	s.LostNote = strings.Join(lostNotes, " · ")

	if !s.Posts() {
		return s, nil
	}

	owner := inventory_ledgers.ProductOwner{TeamID: p.TeamID, ProductID: p.ProductID}

	// PROBLEM — broken, then lost, each oldest batch first, drawn in turn (broken-takes-its-batch-before-lost).
	var lost int64
	if r < 0 {
		lost = -r
	}

	if broken > 0 || lost > 0 {
		drawn, err := inventory_ledgers.DrawInTurn(book.Batches, p.TeamID, p.ProductID, broken, lost)
		if err != nil {
			var short *inventory_ledgers.NotEnoughStockError
			if errors.As(err, &short) {
				return s, fmt.Errorf("%w: product %d throws away and loses %d, its batches hold %d",
					ErrCountTakesMoreThanHeld, p.ProductID, broken+lost, short.Available)
			}

			return s, err
		}

		for i, kind := range []SettleType{SettleBroken, SettleLost} {
			for _, d := range drawn[i] {
				line := SettleLine{Type: kind, BatchID: d.BatchID, Count: d.Count, Amount: d.Valuation}
				if batch := book.Batches.Batch(d.BatchID); batch != nil {
					line.PriceUnit = batch.PriceUnit
				}

				s.Lines = append(s.Lines, line)
			}
		}
	}

	// FOUND — claim the oldest open losses, then mint the remainder at the newest price here.
	if r > 0 {
		left := r

		for _, loss := range book.OpenLosses[owner] {
			if left == 0 {
				break
			}

			open := loss.ClaimableStockCount - loss.ClaimedStockCount
			if open <= 0 {
				continue
			}

			n := min(open, left)
			s.Lines = append(s.Lines, SettleLine{
				Type: SettleClaim, BatchID: loss.BatchID, ProblemID: loss.ID, Count: n,
				PriceUnit: loss.PriceUnit, Amount: float64(n) * loss.PriceUnit,
			})
			left -= n
		}

		if left > 0 {
			price, ok := book.NewestPrice[owner]
			if !ok {
				// Not Posted — Owner Unknown: a guard that should never fire, since such a unit never enters a session
				// (a-unit-never-stocked-here-comes-in-by-restock).
				return s, fmt.Errorf("%w: product %d", ErrNeverStockedHere, p.ProductID)
			}

			s.Lines = append(s.Lines, SettleLine{Type: SettleMint, Count: left, PriceUnit: price, Amount: float64(left) * price})
		}
	}

	// THE RACKS. Lost comes off the racks still short once their broken is off, found goes onto the racks still over,
	// each in rack id order; what is left nets to 0 and is a move.
	if lost > 0 {
		left := lost

		for _, row := range rows {
			if left == 0 {
				break
			}

			if e := residual[row.PlacementID]; e < 0 {
				n := min(-e, left)
				s.RackLost[row.PlacementID] = n
				residual[row.PlacementID] += n
				left -= n
			}
		}
	}

	if r > 0 {
		left := r

		for _, row := range rows {
			if left == 0 {
				break
			}

			if e := residual[row.PlacementID]; e > 0 {
				n := min(e, left)
				s.RackFound[row.PlacementID] = n
				residual[row.PlacementID] -= n
				left -= n
			}
		}
	}

	for _, row := range rows {
		if e := residual[row.PlacementID]; e != 0 {
			s.RackMove[row.PlacementID] = e
			if e < 0 {
				s.Moved += -e
			}
		}
	}

	// A lost row names its rack only when one rack alone was short and none was over (a-problem-row-names-its-rack).
	if lost > 0 {
		shortRacks, overRacks := 0, 0

		for _, row := range rows {
			e := row.Counted - row.System + row.Broken

			switch {
			case e < 0:
				shortRacks++
				s.LostPlacementID = row.PlacementID
			case e > 0:
				overRacks++
			}
		}

		if shortRacks != 1 || overRacks != 0 {
			s.LostPlacementID = 0
		}
	}

	return s, nil
}

// CountFinalize is a session's finalize: every product of the session, with its rows.
type CountFinalize struct {
	WarehouseID uint64
	ActorID     uint64
	// Stamped on every transaction the finalize writes (an-override-is-stamped-in-every-service).
	IsOverride  bool
	Description string
	Products    []CountProduct
	// Guard runs once the rack rows are locked and before anything is written, in a statement of its own (THE COUNT
	// LOCK, inventory_ledgers/count_lock.go). A door OUTSIDE a count — a found request's approval (post_found.go) —
	// refuses there a rack a count holds (a-lock-stops-sales-and-cancels-too). nil for a count's own finalize: the count
	// IS the lock.
	Guard func(tx *gorm.DB, keys []inventory_ledgers.RackKey) error
}

// CountTransaction is one transaction a finalize wrote, and the money its lines carry.
type CountTransaction struct {
	Transaction models.InventoryTransaction
	TxType      models.TxType
	// problem: what the warehouse owes the team for the thrown-away and the lost units.
	BrokenValue float64
	LostValue   float64
	// found: what the claims give back to the warehouse, and what the minted batch is worth (no money moves for it).
	ClaimedValue float64
	MintedValue  float64
	// found: the batches it minted, in product order.
	MintedBatchIDs []uint64
}

// CountPosted is what a finalize posted.
type CountPosted struct {
	// By team, then problem · found · move.
	Transactions []CountTransaction
	Settled      []ProductSettlement
}

// PostCountFinalize posts a session's settlement on the ledgers, all of it in the caller's database transaction: the
// register's open losses, the batches, then the racks are locked in that order; every refusal runs before anything is
// written. The caller locks the session first, and releases its rows and lists the transactions in the same transaction
// (a-session-lists-its-final-transactions).
func PostCountFinalize(tx *gorm.DB, f CountFinalize) (CountPosted, error) {
	book, err := LoadCountBook(tx, f.WarehouseID, f.Products, true)
	if err != nil {
		return CountPosted{}, err
	}

	settled, err := SettleCount(book, f.Products)
	if err != nil {
		return CountPosted{}, err
	}

	// THE RACK ROWS — every row the session counted, locked after the batches, and every change checked under the lock
	// before anything is written. Increases go first, so a rack that both loses a torn unit and gains a found one never
	// passes through below 0; the end is each rack's sellable count.
	type rackChange struct {
		key    inventory_ledgers.RackKey
		team   uint64
		txType models.TxType
		change string
		delta  int64
	}

	var changes []rackChange

	ensure := make([]inventory_ledgers.RackRowToEnsure, 0)

	for _, s := range settled {
		if !s.Posts() {
			continue
		}

		add := func(m map[uint64]int64, txType models.TxType, change string, sign int64) {
			for placement, n := range m {
				if n == 0 {
					continue
				}

				changes = append(changes, rackChange{
					key:  inventory_ledgers.RackKey{ProductID: s.ProductID, PlacementID: placement},
					team: s.TeamID, txType: txType, change: change, delta: sign * n,
				})
			}
		}

		add(s.RackBroken, models.TxProblem, string(models.ProblemBroken), -1)
		add(s.RackLost, models.TxProblem, string(models.ProblemLost), -1)
		add(s.RackFound, models.TxFound, string(models.TxFound), 1)
		add(s.RackMove, models.TxMove, string(models.TxMove), 1)
	}

	for _, c := range changes {
		ensure = append(ensure, inventory_ledgers.RackRowToEnsure{RackKey: c.key, TeamID: c.team})
	}

	// THE TRANSACTIONS — per team, problem · found · move, each only when it carries something.
	type txKey struct {
		team   uint64
		txType models.TxType
	}

	wanted := map[txKey]bool{}

	for _, s := range settled {
		for _, l := range s.Lines {
			switch l.Type {
			case SettleBroken, SettleLost:
				wanted[txKey{s.TeamID, models.TxProblem}] = true
			case SettleClaim, SettleMint:
				wanted[txKey{s.TeamID, models.TxFound}] = true
			}
		}

		if len(s.RackMove) > 0 {
			wanted[txKey{s.TeamID, models.TxMove}] = true
		}
	}

	order := []models.TxType{models.TxProblem, models.TxFound, models.TxMove}
	keys := make([]txKey, 0, len(wanted))

	for k := range wanted {
		keys = append(keys, k)
	}

	rank := func(t models.TxType) int {
		for i, o := range order {
			if o == t {
				return i
			}
		}

		return len(order)
	}

	sort.Slice(keys, func(i, j int) bool {
		if keys[i].team != keys[j].team {
			return keys[i].team < keys[j].team
		}

		return rank(keys[i].txType) < rank(keys[j].txType)
	})

	if len(keys) == 0 {
		return CountPosted{Settled: settled}, nil
	}

	txOf := make(map[txKey]*CountTransaction, len(keys))
	posted := CountPosted{Settled: settled, Transactions: make([]CountTransaction, 0, len(keys))}

	for _, k := range keys {
		t, createErr := inventory_ledgers.CreateTransaction(tx, inventory_ledgers.NewTransaction{
			WarehouseID: f.WarehouseID, TeamID: k.team, TxType: k.txType, ActorID: f.ActorID, IsOverride: f.IsOverride,
			Description: f.Description,
		})
		if createErr != nil {
			return CountPosted{}, createErr
		}

		posted.Transactions = append(posted.Transactions, CountTransaction{Transaction: t, TxType: k.txType})
	}

	for i := range posted.Transactions {
		ct := &posted.Transactions[i]
		txOf[txKey{ct.Transaction.TeamID, ct.TxType}] = ct
	}

	// THE BATCHES — problem takes first, oldest first, broken then lost; then the claims back into their batches; then
	// the mints. The takes are TakeOldestFirst itself, so the register rows below are what the batch rows hold.
	var batchWrites inventory_ledgers.BatchWrites

	items := map[uint64][]inventory_ledgers.ItemLine{}
	itemOf := func(t models.InventoryTransaction, s ProductSettlement, qty int64, total float64) {
		items[t.ID] = append(items[t.ID], inventory_ledgers.ItemLine{
			ProductID: s.ProductID, ProductTeamID: s.TeamID, Quantity: qty, Total: total,
		})
	}

	var problems []models.WarehouseStockProblem

	var claims []models.ProblemClaimedTransaction

	var mints []inventory_ledgers.Mint

	mintOf := make([]ProductSettlement, 0)

	for _, s := range settled {
		var brokenN, lostN, claimN, mintN int64
		var mintPrice float64

		for _, l := range s.Lines {
			switch l.Type {
			case SettleBroken:
				brokenN += l.Count
			case SettleLost:
				lostN += l.Count
			case SettleClaim:
				claimN += l.Count
			case SettleMint:
				mintN += l.Count
				mintPrice = l.PriceUnit
			}
		}

		if brokenN > 0 || lostN > 0 {
			ct := txOf[txKey{s.TeamID, models.TxProblem}]

			var units int64
			var value float64

			for _, part := range []struct {
				kind      models.ProblemType
				n         int64
				placement uint64
				note      string
			}{
				{models.ProblemBroken, brokenN, s.BrokenPlacementID, s.BrokenNote},
				{models.ProblemLost, lostN, s.LostPlacementID, s.LostNote},
			} {
				if part.n == 0 {
					continue
				}

				taken, takeErr := inventory_ledgers.TakeOldestFirst(book.Batches, &batchWrites, inventory_ledgers.Take{
					Transaction: ct.Transaction, TeamID: s.TeamID, ProductID: s.ProductID, Count: part.n,
					ChangeType: string(part.kind), ActorID: f.ActorID, Description: f.Description,
				})
				if takeErr != nil {
					return CountPosted{}, takeErr
				}

				for _, b := range taken {
					row := models.WarehouseStockProblem{
						WarehouseID: f.WarehouseID, TeamID: s.TeamID, ProductID: s.ProductID,
						TransactionID: ct.Transaction.ID, BatchID: b.BatchID, Note: part.note, ProblemType: part.kind,
						ProblemStockCount: b.Count,
					}

					if batch := book.Batches.Batch(b.BatchID); batch != nil {
						row.PriceUnit = batch.PriceUnit
					}

					if part.kind == models.ProblemLost {
						row.ClaimableStockCount = b.Count
					}

					if part.placement != 0 {
						placement := part.placement
						row.PlacementID = &placement
					}

					problems = append(problems, row)

					units += b.Count
					value += b.Valuation

					if part.kind == models.ProblemBroken {
						ct.BrokenValue += b.Valuation
					} else {
						ct.LostValue += b.Valuation
					}
				}
			}

			itemOf(ct.Transaction, s, units, value)
		}

		if claimN > 0 || mintN > 0 {
			ct := txOf[txKey{s.TeamID, models.TxFound}]

			var value float64

			for _, l := range s.Lines {
				if l.Type != SettleClaim {
					continue
				}

				added, addErr := inventory_ledgers.AddAtPrice(book.Batches, &batchWrites, ct.Transaction, l.BatchID, l.Count,
					l.PriceUnit, string(models.TxFound), f.ActorID, f.Description)
				if addErr != nil {
					return CountPosted{}, addErr
				}

				claims = append(claims, models.ProblemClaimedTransaction{
					ProblemID: l.ProblemID, TransactionID: ct.Transaction.ID, ClaimedStockCount: l.Count,
				})
				ct.ClaimedValue += added.Valuation
				value += added.Valuation
			}

			if mintN > 0 {
				mints = append(mints, inventory_ledgers.Mint{
					Transaction: ct.Transaction, TeamID: s.TeamID, ProductID: s.ProductID, Count: mintN, PriceUnit: mintPrice,
					ChangeType: string(models.TxFound), ActorID: f.ActorID, Description: f.Description,
				})
				mintOf = append(mintOf, s)
				value += float64(mintN) * mintPrice
			}

			itemOf(ct.Transaction, s, claimN+mintN, value)
		}

		if s.Moved > 0 {
			itemOf(txOf[txKey{s.TeamID, models.TxMove}].Transaction, s, s.Moved, 0)
		}
	}

	rows, err := inventory_ledgers.EnsureAndLockRacks(tx, f.WarehouseID, ensure)
	if err != nil {
		return CountPosted{}, err
	}

	if f.Guard != nil {
		keys := make([]inventory_ledgers.RackKey, 0, len(ensure))
		for _, e := range ensure {
			keys = append(keys, e.RackKey)
		}

		err = f.Guard(tx, keys)
		if err != nil {
			return CountPosted{}, err
		}
	}

	sort.SliceStable(changes, func(i, j int) bool {
		if (changes[i].delta > 0) != (changes[j].delta > 0) {
			return changes[i].delta > 0
		}

		if changes[i].key.ProductID != changes[j].key.ProductID {
			return changes[i].key.ProductID < changes[j].key.ProductID
		}

		if changes[i].key.PlacementID != changes[j].key.PlacementID {
			return changes[i].key.PlacementID < changes[j].key.PlacementID
		}

		return rank(changes[i].txType) < rank(changes[j].txType)
	})

	var rackWrites inventory_ledgers.RackWrites

	for _, c := range changes {
		ct := txOf[txKey{c.team, c.txType}]

		_, applyErr := rackWrites.Apply(ct.Transaction, rows[c.key], c.delta, c.change, f.ActorID, f.Description)
		if applyErr != nil {
			var short *inventory_ledgers.NotEnoughStockError
			if errors.As(applyErr, &short) {
				return CountPosted{}, fmt.Errorf("%w: product %d on rack %d holds %d now, the count takes %d — "+
					"an order took units the count did not find", ErrCountTakesMoreThanHeld, short.ProductID,
					c.key.PlacementID, short.Available, short.Wanted)
			}

			return CountPosted{}, applyErr
		}
	}

	// Every check has passed: write.
	err = batchWrites.Flush(tx)
	if err != nil {
		return CountPosted{}, err
	}

	minted, err := inventory_ledgers.MintBatches(tx, mints)
	if err != nil {
		return CountPosted{}, err
	}

	for i, b := range minted {
		ct := txOf[txKey{mintOf[i].TeamID, models.TxFound}]
		ct.MintedValue += b.StockValuation
		ct.MintedBatchIDs = append(ct.MintedBatchIDs, b.ID)
	}

	err = rackWrites.Flush(tx)
	if err != nil {
		return CountPosted{}, err
	}

	if len(problems) > 0 {
		err = tx.CreateInBatches(&problems, 500).Error
		if err != nil {
			return CountPosted{}, fmt.Errorf("stock problems: %w", err)
		}
	}

	err = writeClaims(tx, f.WarehouseID, claims)
	if err != nil {
		return CountPosted{}, err
	}

	for _, ct := range posted.Transactions {
		err = inventory_ledgers.AddItems(tx, ct.Transaction, items[ct.Transaction.ID])
		if err != nil {
			return CountPosted{}, err
		}
	}

	// Hand back the values as posted, in order.
	for i := range posted.Transactions {
		posted.Transactions[i] = *txOf[txKey{posted.Transactions[i].Transaction.TeamID, posted.Transactions[i].TxType}]
	}

	return posted, nil
}

// writeClaims writes each claim's row and raises its problem's claimed count, in two statements whatever their number
// (a-claim-records-its-units). The problems were locked by LoadCountBook; the CHECK is the backstop against a claim past
// what is claimable.
func writeClaims(tx *gorm.DB, warehouseID uint64, claims []models.ProblemClaimedTransaction) error {
	if len(claims) == 0 {
		return nil
	}

	ids := make([]int64, 0, len(claims))
	counts := make([]int64, 0, len(claims))

	for i := range claims {
		claims[i].WarehouseID = warehouseID
		ids = append(ids, int64(claims[i].ProblemID))
		counts = append(counts, claims[i].ClaimedStockCount)
	}

	err := tx.CreateInBatches(&claims, 500).Error
	if err != nil {
		return fmt.Errorf("claims: %w", err)
	}

	err = tx.Exec(`
		UPDATE warehouse_stock_problems AS p
		SET claimed_stock_count = p.claimed_stock_count + v.n
		FROM (SELECT id, SUM(n) AS n FROM unnest(CAST(? AS bigint[]), CAST(? AS bigint[])) AS u(id, n) GROUP BY id) AS v
		WHERE p.id = v.id`,
		int64ArrayLiteral(ids), int64ArrayLiteral(counts)).Error
	if err != nil {
		return fmt.Errorf("raise claimed counts: %w", err)
	}

	return nil
}

func int64ArrayLiteral(values []int64) string {
	parts := make([]string, 0, len(values))
	for _, v := range values {
		parts = append(parts, fmt.Sprint(v))
	}

	return "{" + strings.Join(parts, ",") + "}"
}
