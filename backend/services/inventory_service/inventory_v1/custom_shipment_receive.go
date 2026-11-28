package inventory_v1

import (
	"context"
	"errors"
	"strconv"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// CustomShipmentReceive is Terima: the warehouse an INBOUND parcel came to counts it in — signed for, or straight from
// on its way (as a restock's accept) — a-suppliers-reshipping-comes-in-as-a-custom-shipment, 🔄 A (a restock box's steps),
// 🔄 B (the seller's price), 🔄 A (the stock-in is linked):
//
//   - per line, what was in the box (broken included, at most the line says) and how many broken; the short units are
//     the difference. The GOOD units go on ONE rack of this warehouse as stock at the SELLER'S typed price — a stock-in
//     (the restock's PostRestock: a batch per line, the parcel's supplier on it), its inventory transaction linked in
//     `restock_custom_shipments`; the price moves no money;
//   - broken and short are written down on the line and, when any are, the restock REOPENS
//     (a-restock-problem-is-settled-by-resolution-rows, 🔄 A: a late shortfall reopens it): a received restock gets the
//     matching tag back on (*Barang kurang* for short, *Barang rusak* for broken), and the settled mark is lifted;
//   - the courier's charge at the door is FINAL here, replacing Tiba's; after commit CustomShipmentReceived carries it
//     and Team Balance posts what the selling team owes the warehouse — the restock's door charge path
//     (the-courier-charge-is-noted-at-tiba-and-final-at-terima).
//
// LOCK ORDER (lock-order.md): the RESTOCK row first — the lock a resolution, a settle and the restock's own acts take, so
// a settle racing this reopen is judged one after the other — then the parcel, then the stock ledgers. The answer is the
// warehouse's read: no seller price.
func (s *Service) CustomShipmentReceive(
	ctx context.Context,
	req *connect.Request[inventoryv1.CustomShipmentReceiveRequest],
) (*connect.Response[inventoryv1.CustomShipmentReceiveResponse], error) {
	msg := req.Msg
	warehouseID := msg.GetTeamId()
	actor := actorFrom(ctx)
	override := overrideFrom(ctx)

	charge, note := doorCharge(msg.GetDoorCharge(), msg.GetDoorChargeNote())

	// Which restock the parcel settles — read before the locks (a parcel's restock never changes), so the restock row is
	// locked FIRST.
	var head models.CustomShipment

	err := s.db.WithContext(ctx).
		Select("id, restock_id, kind").
		Where("id = ? AND warehouse_id = ?", msg.GetId(), warehouseID).
		First(&head).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, inboundErr(errCustomShipmentMissing)
		}

		return nil, inboundErr(err)
	}

	if head.Kind != models.CustomShipmentSupplierReshipping {
		return nil, inboundErr(errInboundOnly)
	}

	var (
		cs   *models.CustomShipment
		link models.RestockCustomShipment
	)

	err = inventory_ledgers.StockTransaction(s.db.WithContext(ctx), func(tx *gorm.DB) error {
		var rr models.Restock

		restockErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", head.RestockID).
			First(&rr).
			Error
		if restockErr != nil {
			return restockErr
		}

		var lockErr error

		cs, lockErr = lockInboundParcel(tx, msg.GetId(), warehouseID, customShipmentShipper)
		if lockErr != nil {
			return lockErr
		}

		statusErr := requireCustomShipmentStatus(cs, "counted in", models.CustomShipmentOnTheWay,
			models.CustomShipmentArrived)
		if statusErr != nil {
			return statusErr
		}

		var items []models.CustomShipmentItem

		loadErr := tx.
			Where("custom_shipment_id = ?", cs.ID).
			Order("id ASC").
			Find(&items).
			Error
		if loadErr != nil {
			return loadErr
		}

		counted, judgeErr := judgeInboundCount(tx, warehouseID, items, msg.GetLines())
		if judgeErr != nil {
			return judgeErr
		}

		var (
			short, broken bool
			lines         []inventory_mutations.RestockLine
		)

		for i := range items {
			item := &items[i]
			line := counted[item.ID]

			if line.received < item.Quantity {
				short = true
			}

			if line.broken > 0 {
				broken = true
			}

			received, brokenUnits := line.received, line.broken
			item.Received, item.Broken, item.RackID = &received, &brokenUnits, line.rack

			updateErr := tx.
				Model(item).
				Updates(map[string]any{"received": received, "broken": brokenUnits, "rack_id": line.rack}).
				Error
			if updateErr != nil {
				return updateErr
			}

			good := line.received - line.broken
			if good <= 0 {
				continue
			}

			// THE STOCK-IN at the seller's typed price (🔄 B) — never a landed price: the goods were paid for in the
			// restock, and the price only values them (🔄 A: it moves no money).
			lines = append(lines, inventory_mutations.RestockLine{
				ProductID:  item.ProductID,
				Good:       good,
				PriceUnit:  item.PriceUnit,
				SupplierID: cs.SupplierID,
				Placements: []inventory_mutations.RestockPlacement{{PlacementID: line.rack, Count: good}},
			})
		}

		if len(lines) > 0 {
			stockIn, postErr := inventory_mutations.PostRestock(tx, inventory_mutations.Restock{
				WarehouseID: cs.WarehouseID,
				TeamID:      cs.TeamID,
				ActorID:     actor,
				IsOverride:  override,
				Lines:       lines,
			})
			if postErr != nil {
				return postErr
			}

			txID := stockIn.ID
			link.InventoryTransactionID = &txID

			linkErr := tx.
				Model(&models.RestockCustomShipment{}).
				Where("custom_shipment_id = ?", cs.ID).
				Update("inventory_transaction_id", txID).
				Error
			if linkErr != nil {
				return linkErr
			}
		}

		readErr := tx.
			Where("custom_shipment_id = ?", cs.ID).
			First(&link).
			Error
		if readErr != nil {
			return readErr
		}

		moveErr := moveInbound(tx, cs, models.CustomShipmentReceived, actor, override,
			map[string]any{"shipping_cost": charge, "charge_note": note}, inboundCountText(items, charge, note))
		if moveErr != nil {
			return moveErr
		}

		cs.ShippingCost, cs.ChargeNote = charge, note

		// A LATE SHORTFALL REOPENS THE RESTOCK (🔄 A).
		if short || broken {
			return reopenRestock(tx, &rr, cs.ID, items, actor, override, short, broken)
		}

		return nil
	})
	if err != nil {
		return nil, inboundErr(err)
	}

	// AFTER the commit: the door charge, final, reaches Team Balance (liability's custom-shipment listener).
	s.publishCustomShipmentEvent(ctx, customShipmentReceivedEvent(cs, &link, override))

	wire, err := customShipmentForWire(s.db.WithContext(ctx), cs.ID, warehouseID)
	if err != nil {
		return nil, inboundErr(err)
	}

	return connect.NewResponse(&inventoryv1.CustomShipmentReceiveResponse{CustomShipment: wire}), nil
}

// inboundLine is one line as Terima counted it.
type inboundLine struct {
	received int64
	broken   int64
	rack     uint64
}

// judgeInboundCount checks Terima's lines against the LOCKED parcel's: every line once, at most what the line says,
// broken at most received, the good units on a rack of THIS warehouse (another's reads NotFound). One statement for the
// racks.
func judgeInboundCount(
	tx *gorm.DB,
	warehouseID uint64,
	items []models.CustomShipmentItem,
	lines []*inventoryv1.CustomShipmentReceivedLine,
) (map[uint64]inboundLine, error) {
	byID := make(map[uint64]*models.CustomShipmentItem, len(items))
	for i := range items {
		byID[items[i].ID] = &items[i]
	}

	counted := make(map[uint64]inboundLine, len(lines))

	var racks []uint64

	for _, line := range lines {
		item := byID[line.GetItemId()]
		if item == nil {
			return nil, errInboundLineUnknown
		}

		if _, dup := counted[item.ID]; dup {
			return nil, errInboundLineTwice
		}

		received, broken := int64(line.GetReceived()), int64(line.GetBroken())

		if received > item.Quantity {
			return nil, errInboundOverCount
		}

		if broken > received {
			return nil, errInboundBrokenOverRecv
		}

		rack := line.GetRackId()
		if received-broken > 0 {
			if rack == 0 {
				return nil, errInboundNoRack
			}

			racks = append(racks, rack)
		} else {
			rack = 0
		}

		counted[item.ID] = inboundLine{received: received, broken: broken, rack: rack}
	}

	if len(counted) != len(items) {
		return nil, errInboundCountMissing
	}

	exists, err := racksExist(tx, warehouseID, racks)
	if err != nil {
		return nil, err
	}

	if !exists {
		return nil, errRackMissing
	}

	return counted, nil
}

// reopenRestock is a late shortfall's reopen, on the LOCKED restock row (a-restock-problem-is-settled-by-resolution-rows,
// 🔄 A): the settled mark lifted, and — on a received restock, whose problem tags these are — the tag of each kind found
// back on (*Barang kurang* for short units, *Barang rusak* for broken ones). A lost restock carries no problem tag; its
// reopen is the mark alone, so it is listed under Hilang again. Who puts the tags on: the app (0).
//
// Lifting the mark writes the Riwayat's REOPENED row (restock_settlement_log.go): the counting warehouse member, the
// parcel, and per product what was short and broken (`items` as Terima just counted them). A restock not settled has no
// mark to lift — nothing reopens, and no row is written (its tags simply stay or come back on).
func reopenRestock(
	tx *gorm.DB,
	rr *models.Restock,
	parcelID uint64,
	items []models.CustomShipmentItem,
	actor uint64,
	override bool,
	short, broken bool,
) error {
	if rr.SettledAt != nil {
		at := inventory_ledgers.TxNow(tx)

		err := tx.
			Model(rr).
			Updates(map[string]any{
				"settled_at":             nil,
				"settled_by_user_id":     0,
				"settled_by_is_override": false,
				"updated_at":             at,
			}).
			Error
		if err != nil {
			return err
		}

		logErr := recordReopenedLog(tx, rr, parcelID, items, actor, override, at)
		if logErr != nil {
			return logErr
		}
	}

	if rr.Status != restockStatusAccepted {
		return nil
	}

	var tasks []string
	if short {
		tasks = append(tasks, appTaskProblemMissing)
	}

	if broken {
		tasks = append(tasks, appTaskProblemBroken)
	}

	return putAppTags(tx, rr.ID, inventory_ledgers.TxNow(tx), tasks...)
}

// inboundCountText is Terima's trail row in words — what was short and broken, and the courier's charge at the door —
// "received — 1 broken, 2 short; courier's charge Rp 8.000 — …". No seller money: both sides read it.
func inboundCountText(items []models.CustomShipmentItem, charge float64, note string) string {
	var short, broken int64

	for _, item := range items {
		if item.Received != nil {
			short += item.Quantity - *item.Received
		}

		if item.Broken != nil {
			broken += *item.Broken
		}
	}

	text := "received — " + strconv.FormatInt(broken, 10) + " broken, " + strconv.FormatInt(short, 10) + " short"
	if words := doorChargeText(charge, note); words != "" {
		text += "; " + words
	}

	return text
}
