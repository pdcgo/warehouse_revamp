package inventory_v1

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// CustomShipmentCreate is the owning SELLING team asking the warehouse to send a parcel that is not an order
// (a-custom-shipment-is-a-parcel-that-is-not-an-order, the-selling-team-asks-the-warehouse-ships). It starts REQUESTED.
//
//   - A SAMPLE takes its stock in the same database transaction — the team's batches oldest first, the racks holding the
//     fewest first, exactly the take a transfer's out-leg writes (PostParcelSample) — typed `sample` and keeping its
//     recipient (a-sample-is-a-stock-out-at-batch-value, a-sample-keeps-its-recipient). Too few in the warehouse fails
//     the create, naming every short line, and writes nothing. Each line carries the value the take drew.
//   - A RESHIP takes no stock: its units are a received restock's BROKEN units, which never entered a batch or a rack
//     (a-restocks-broken-units-are-just-broken-for-now). Per restock line, at most its broken count less the units
//     another live (not cancelled) reship already carries — judged under the restock row's lock, so two reships of one
//     restock queue and the second sees the first. One parcel goes to one supplier (the-custom-shipments-prototype-is-
//     accepted).
//
// The courier: TEAM (*Kami bayar*) names one of the team's ACTIVE accounts, operational or not, and an optional cost —
// as a transfer's shipping (a-transfers-shipping-is-paid-from-any-active-account); WAREHOUSE (*Gudang bayar*) names
// neither — the warehouse types the cost at the handover (the-courier-is-paid-by-the-team-or-by-the-warehouse). The
// idempotency key is unique per team: a used key is refused as AlreadyExists, never answered with that parcel. After
// commit, CustomShipmentCreated is published.
func (s *Service) CustomShipmentCreate(
	ctx context.Context,
	req *connect.Request[inventoryv1.CustomShipmentCreateRequest],
) (*connect.Response[inventoryv1.CustomShipmentCreateResponse], error) {
	msg := req.Msg
	teamID := msg.GetTeamId()
	actor := actorFrom(ctx)
	override := overrideFrom(ctx)
	payer := customShipmentPayerFromProto(msg.GetPayer())

	// The rules that span fields, which protovalidate cannot express — checked before anything else.
	err := customShipmentPayment(payer, msg.GetFinanceAccountId(), msg.GetShippingCost())
	if err != nil {
		return nil, customShipmentErr(err)
	}

	// The account that pays the courier must be one of the team's ACTIVE accounts — asked of financial_account_service
	// before anything is written and before the transaction, so no lock waits on the round-trip. 0 asks nothing.
	err = s.askPayingAccount(ctx, teamID, msg.GetFinanceAccountId()).checkActive()
	if err != nil {
		return nil, customShipmentErr(err)
	}

	recipient := msg.GetRecipient()

	cs := models.CustomShipment{
		TeamID:            teamID,
		Status:            models.CustomShipmentRequested,
		RecipientName:     recipient.GetName(),
		RecipientPhone:    recipient.GetPhone(),
		RecipientAddress:  recipient.GetAddress(),
		ShipmentChannelID: msg.GetShipmentChannelId(),
		Payer:             payer,
		FinanceAccountID:  msg.GetFinanceAccountId(),
		ShippingCost:      msg.GetShippingCost(),
		Note:              msg.GetNote(),
		IdempotencyKey:    msg.GetIdempotencyKey(),
		CreatedByUserID:   actor,
	}

	switch msg.GetKind() {
	case inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_SAMPLE:
		err = s.createParcelSample(ctx, msg, &cs, override)
	case inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP:
		err = s.createReship(ctx, msg, &cs, override)
	default:
		// UNSPECIFIED is refused by validation; a handler called directly gets no interceptor.
		err = errCustomShipmentSampleShape
	}
	if err != nil {
		return nil, customShipmentErr(err)
	}

	s.publishCustomShipmentEvent(ctx, customShipmentCreatedEvent(&cs, override))

	wire, err := customShipmentForWire(s.db.WithContext(ctx), cs.ID, teamID)
	if err != nil {
		return nil, customShipmentErr(err)
	}

	return connect.NewResponse(&inventoryv1.CustomShipmentCreateResponse{CustomShipment: wire}), nil
}

// customShipmentPayment is the courier's rule at create: TEAM names its account (the cost may be 0 and is editable until
// the handover); WAREHOUSE names no account and no cost.
func customShipmentPayment(payer models.CustomShipmentPayer, accountID uint64, cost float64) error {
	switch payer {
	case models.CustomShipmentPayerTeam:
		if accountID == 0 {
			return errCustomShipmentAccountNeeded
		}
	case models.CustomShipmentPayerWarehouse:
		if accountID != 0 || cost != 0 {
			return errCustomShipmentWarehousePays
		}
	default:
		// UNSPECIFIED is refused by validation.
		return errCustomShipmentAccountNeeded
	}

	return nil
}

// insertCustomShipment writes the parcel's row — first in its transaction, so a used key refuses before any take.
func insertCustomShipment(tx *gorm.DB, cs *models.CustomShipment) error {
	err := tx.Create(cs).Error
	if err != nil {
		if isUniqueViolation(err) {
			return errCustomShipmentKeyUsed
		}

		return fmt.Errorf("custom shipment: %w", err)
	}

	return nil
}

// ── the sample ──────────────────────────────────────────────────────────────────────────────────────────────────────

// createParcelSample writes a SAMPLE: the row, its take (PostParcelSample, in the same transaction), one line per
// product carrying the value the take drew, and the trail's first row.
func (s *Service) createParcelSample(
	ctx context.Context,
	msg *inventoryv1.CustomShipmentCreateRequest,
	cs *models.CustomShipment,
	override bool,
) error {
	teamID := msg.GetTeamId()

	if msg.GetWarehouseId() == 0 || msg.GetRestockId() != 0 {
		return errCustomShipmentSampleShape
	}

	ids := make([]uint64, 0, len(msg.GetLines()))
	seen := map[uint64]bool{}

	for _, line := range msg.GetLines() {
		if line.GetProductId() == 0 || line.GetRestockItemId() != 0 {
			return errCustomShipmentSampleShape
		}

		if seen[line.GetProductId()] {
			return errCustomShipmentLineTwice
		}

		seen[line.GetProductId()] = true
		ids = append(ids, line.GetProductId())
	}

	// A sample sends the team's OWN goods. Asked before the transaction: a call to another service never runs under a
	// lock.
	facts, err := s.products.Facts(ctx, teamID, ids)
	if err != nil {
		return fmt.Errorf("ask product facts: %w", err)
	}

	for _, id := range ids {
		fact, ok := facts[id]
		if !ok || fact.TeamID != teamID {
			return fmt.Errorf("%w: product %d", errCustomShipmentNotOwned, id)
		}
	}

	cs.Kind = models.CustomShipmentSample
	cs.WarehouseID = msg.GetWarehouseId()

	return inventory_ledgers.StockTransaction(s.db.WithContext(ctx), func(tx *gorm.DB) error {
		// The row first, so the take can name it; a refused take rolls it back with everything else.
		insertErr := insertCustomShipment(tx, cs)
		if insertErr != nil {
			return insertErr
		}

		sample := inventory_mutations.ParcelSample{
			WarehouseID: cs.WarehouseID,
			TeamID:      teamID,
			ActorID:     cs.CreatedByUserID,
			IsOverride:  override,
			// The recipient's name — the transaction keeps who got it (a-sample-keeps-its-recipient); phone and address
			// live on the parcel.
			Recipient:   cs.RecipientName,
			Description: customShipmentDescription(cs.ID),
		}

		for _, line := range msg.GetLines() {
			sample.Lines = append(sample.Lines, inventory_mutations.TransferLine{
				ProductID: line.GetProductId(),
				Quantity:  int64(line.GetQuantity()),
			})
		}

		take, taken, postErr := inventory_mutations.PostParcelSample(tx, sample)
		if postErr != nil {
			return postErr
		}

		value := map[uint64]float64{}
		for _, line := range taken {
			value[line.ProductID] = line.Value
			cs.Total += line.Value
		}

		items := make([]models.CustomShipmentItem, 0, len(msg.GetLines()))
		for _, line := range msg.GetLines() {
			items = append(items, models.CustomShipmentItem{
				CustomShipmentID: cs.ID,
				ProductID:        line.GetProductId(),
				ProductCode:      facts[line.GetProductId()].ProductCode,
				Name:             facts[line.GetProductId()].Name,
				Quantity:         int64(line.GetQuantity()),
				Total:            value[line.GetProductId()],
			})
		}

		createErr := tx.Create(&items).Error
		if createErr != nil {
			return createErr
		}

		cs.TransactionID = &take.ID

		updateErr := tx.
			Model(cs).
			Updates(map[string]any{
				"transaction_id": take.ID,
				"total":          cs.Total,
			}).
			Error
		if updateErr != nil {
			return updateErr
		}

		return appendCustomShipmentLog(tx, cs.ID, "", models.CustomShipmentRequested, cs.CreatedByUserID, override, "")
	})
}

// ── the reship ──────────────────────────────────────────────────────────────────────────────────────────────────────

// createReship writes a RESHIP under its restock row's lock: the restock must be the team's and received, every line
// one of its lines with broken units still free, every line naming the same supplier; then the row, its lines (the
// restock line's code, name and broken note copied) and the trail's first row. No stock ledger is touched.
func (s *Service) createReship(
	ctx context.Context,
	msg *inventoryv1.CustomShipmentCreateRequest,
	cs *models.CustomShipment,
	override bool,
) error {
	if msg.GetRestockId() == 0 {
		return errCustomShipmentReshipShape
	}

	seen := map[uint64]bool{}

	for _, line := range msg.GetLines() {
		if line.GetRestockItemId() == 0 {
			return errCustomShipmentReshipShape
		}

		if seen[line.GetRestockItemId()] {
			return errCustomShipmentLineTwice
		}

		seen[line.GetRestockItemId()] = true
	}

	cs.Kind = models.CustomShipmentReship
	cs.RestockID = msg.GetRestockId()

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		rr, lockErr := lockTeamRestock(tx, msg.GetRestockId(), msg.GetTeamId())
		if lockErr != nil {
			return lockErr
		}

		if rr.Status != restockStatusAccepted {
			return fmt.Errorf("%w: this restock is %s", errCustomShipmentNotReceived, rr.Status)
		}

		if msg.GetWarehouseId() != 0 && msg.GetWarehouseId() != rr.WarehouseID {
			return errCustomShipmentWrongWarehouse
		}

		lines, supplierID, judgeErr := judgeReshipLines(tx, rr, msg.GetLines())
		if judgeErr != nil {
			return judgeErr
		}

		cs.WarehouseID = rr.WarehouseID
		cs.SupplierID = supplierID

		insertErr := insertCustomShipment(tx, cs)
		if insertErr != nil {
			return insertErr
		}

		items := make([]models.CustomShipmentItem, 0, len(lines))
		for _, line := range lines {
			restockItemID := line.item.ID

			items = append(items, models.CustomShipmentItem{
				CustomShipmentID: cs.ID,
				ProductID:        line.item.ProductID,
				ProductCode:      line.item.ProductCode,
				Name:             line.item.Name,
				Quantity:         line.quantity,
				RestockItemID:    &restockItemID,
				BrokenNote:       line.brokenNote,
			})
		}

		createErr := tx.Create(&items).Error
		if createErr != nil {
			return createErr
		}

		return appendCustomShipmentLog(tx, cs.ID, "", models.CustomShipmentRequested, cs.CreatedByUserID, override, "")
	})
}

// lockTeamRestock locks the team's restock row FOR UPDATE — the lock its accept, cancel and Koreksi Jumlah Terima take
// — with its lines. Another team's restock reads as one that never existed.
func lockTeamRestock(tx *gorm.DB, restockID, teamID uint64) (*models.Restock, error) {
	var rr models.Restock

	err := tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		Where("id = ? AND team_id = ?", restockID, teamID).
		First(&rr).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errCustomShipmentRestockMissing
	}

	if err != nil {
		return nil, err
	}

	return &rr, nil
}

// reshipLine is one judged line of a reship: its restock line, the units sent and the line's broken note.
type reshipLine struct {
	item       *models.RestockItem
	quantity   int64
	brokenNote string
}

// judgeReshipLines resolves a reship's lines on its LOCKED restock: each a line of it (a product named must be the
// line's), every line the same supplier — a line naming none is its own group — and none sending more than its broken
// units less what live reships already carry. A refusal of the last kind names every line over. Two statements: the
// broken rows and the units already sent.
func judgeReshipLines(
	tx *gorm.DB,
	rr *models.Restock,
	wanted []*inventoryv1.CustomShipmentLine,
) ([]reshipLine, uint64, error) {
	byID := make(map[uint64]*models.RestockItem, len(rr.Items))
	for i := range rr.Items {
		byID[rr.Items[i].ID] = &rr.Items[i]
	}

	lines := make([]reshipLine, 0, len(wanted))
	ids := make([]uint64, 0, len(wanted))

	var supplierID uint64

	for i, w := range wanted {
		item := byID[w.GetRestockItemId()]
		if item == nil || (w.GetProductId() != 0 && w.GetProductId() != item.ProductID) {
			return nil, 0, fmt.Errorf("%w: line %d", errCustomShipmentLineUnknown, w.GetRestockItemId())
		}

		supplier := uint64(0)
		if item.SupplierID != nil {
			supplier = *item.SupplierID
		}

		if i == 0 {
			supplierID = supplier
		} else if supplier != supplierID {
			return nil, 0, errCustomShipmentTwoSuppliers
		}

		lines = append(lines, reshipLine{item: item, quantity: int64(w.GetQuantity())})
		ids = append(ids, item.ID)
	}

	broken, err := restockBrokenUnits(tx, rr.ID)
	if err != nil {
		return nil, 0, err
	}

	sent, err := reshipUnitsSent(tx, ids)
	if err != nil {
		return nil, 0, err
	}

	var short ReshipShortError

	for i := range lines {
		line := &lines[i]
		b := broken[line.item.ProductID]
		held := sent[line.item.ID]
		line.brokenNote = b.Note

		if line.quantity > b.Count-held.held() {
			short.Lines = append(short.Lines, ReshipShortLine{
				RestockItemID: line.item.ID,
				ProductID:     line.item.ProductID,
				Wanted:        line.quantity,
				Broken:        b.Count,
				AlreadySent:   held.Live,
				NotFound:      held.NotFound,
			})
		}
	}

	if len(short.Lines) > 0 {
		return nil, 0, &short
	}

	return lines, supplierID, nil
}

// brokenUnits is a restock line's broken units at Terima and the warehouse's note on them.
type brokenUnits struct {
	Count int64
	Note  string
}

// restockBrokenUnits is a restock's BROKEN problem rows by product (a product is once per restock, so its product finds
// its line): the units and the note. One statement.
func restockBrokenUnits(tx *gorm.DB, restockID uint64) (map[uint64]brokenUnits, error) {
	var rows []struct {
		ProductID uint64
		Count     int64
		Note      string
	}

	err := tx.
		Table("restock_problem_items").
		Select("product_id, count, note").
		Where("restock_id = ? AND problem_type = ?", restockID, restockProblemBroken).
		Order("id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, fmt.Errorf("read the restock's broken rows: %w", err)
	}

	out := make(map[uint64]brokenUnits, len(rows))
	for _, r := range rows {
		b := out[r.ProductID]
		b.Count += r.Count

		if b.Note == "" {
			b.Note = r.Note
		}

		out[r.ProductID] = b
	}

	return out, nil
}

// THE UNITS RESHIPS HOLD OF A RESTOCK LINE — the one rule the reship create's cap (judgeReshipLines) and the reship
// choices (reshipLineFree, reshipOptionLines) both count by, so the offer and the refusal never disagree. `i` is a reship
// line (custom_shipment_items), `c` its parcel:
//
//   - while the parcel is not cancelled it holds ALL its units — a live reship carries them
//     (the-custom-shipments-prototype-is-accepted: at most the broken count minus the units already on another live
//     reship);
//   - once cancelled it holds only the units a goods-missing note on it named — gone, never offered again
//     (missing-reship-units-are-not-offered-again; the rest are free, a-custom-shipment-is-cancelled-only-while-
//     requested). Of one line that is the MOST any one note named: the warehouse may record again while requested, and
//     two notes on one line name the same units, so they never add up. A line no note named holds nothing.
const (
	reshipItemLive = "CASE WHEN c.status <> '" + string(models.CustomShipmentCancelled) + "' THEN i.quantity ELSE 0 END"
	reshipItemGone = "CASE WHEN c.status = '" + string(models.CustomShipmentCancelled) + "' THEN COALESCE((" +
		"SELECT MAX(n.units) FROM (SELECT SUM(ml.quantity) AS units FROM custom_shipment_missing_lines ml " +
		"WHERE ml.custom_shipment_item_id = i.id GROUP BY ml.custom_shipment_log_id) n), 0) ELSE 0 END"
	reshipItemHeld = "(" + reshipItemLive + ") + (" + reshipItemGone + ")"
)

// reshipUnits is what reships hold of one restock line: the units live reships carry, and the units a goods-missing note
// named on a cancelled one.
type reshipUnits struct {
	Live     int64
	NotFound int64
}

// held is every unit of the line no reship may send.
func (u reshipUnits) held() int64 {
	return u.Live + u.NotFound
}

// reshipUnitsSent is, per restock line, what reships hold of it (reshipItemHeld's two halves) — the units a new reship is
// counted against. One statement, on the items' restock-line index (and the notes' line index for a cancelled one).
func reshipUnitsSent(tx *gorm.DB, restockItemIDs []uint64) (map[uint64]reshipUnits, error) {
	var rows []struct {
		RestockItemID uint64
		Live          int64
		NotFound      int64
	}

	err := tx.
		Table("custom_shipment_items AS i").
		Select("i.restock_item_id, COALESCE(SUM("+reshipItemLive+"), 0) AS live, "+
			"COALESCE(SUM("+reshipItemGone+"), 0) AS not_found").
		Joins("JOIN custom_shipments c ON c.id = i.custom_shipment_id").
		Where("i.restock_item_id IN ?", restockItemIDs).
		Group("i.restock_item_id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, fmt.Errorf("read the units reships hold: %w", err)
	}

	out := make(map[uint64]reshipUnits, len(rows))
	for _, r := range rows {
		out[r.RestockItemID] = reshipUnits{Live: r.Live, NotFound: r.NotFound}
	}

	return out, nil
}
