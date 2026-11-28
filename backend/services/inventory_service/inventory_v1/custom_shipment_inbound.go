package inventory_v1

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE INBOUND PARCEL (backlog #101 P1 — a-suppliers-reshipping-comes-in-as-a-custom-shipment, + every 🔄): a supplier's
// RESHIPPING comes IN as a custom shipment of its own kind (SUPPLIER_RESHIPPING), created by the selling team with its
// `reshipping` resolution, and arrives as a restock box does:
//
//	on_the_way ──Arrive (warehouse, Tiba)──▶ arrived ──Receive (warehouse, Terima)──▶ received
//	    │    ▲                                  ▲
//	    │    └────────── Arrive (a late lost box is signed for) ──── lost ◀──MarkLost (selling team)
//	    └──Receive straight from on_the_way (signed for and counted at once, as a restock's accept)
//
//	ResiSet (selling team): on_the_way only — the resi until Tiba, as a restock's.
//	PricesSet (selling team): on_the_way or arrived — until Terima; the price values the stock and moves NO money.
//
// The courier's charge at the door is the restock's (🔄 A): the warehouse pays it, notes it at Tiba (kept, shown), Terima's
// figure is final and replaces it, and only Terima's event makes the selling team owe it through Team Balance — stored as
// the parcel's `shipping_cost` under payer `warehouse` and `charge_note`. The warehouse never reads a seller price
// (a-warehouse-sees-no-seller-money): a line's price and the parcel's total are left UNSET for it.

var (
	errInboundOnly           = errors.New("only an inbound parcel (a supplier's reshipping) is moved this way")
	errInboundLineUnknown    = errors.New("a line names an item that is not this parcel's")
	errInboundLineTwice      = errors.New("a parcel line appears once")
	errInboundCountMissing   = errors.New("every line of the parcel is counted at Terima")
	errInboundOverCount      = errors.New("more in the box than the line says — the seller's line says what the supplier sent")
	errInboundBrokenOverRecv = errors.New("broken: at most what was received")
	errInboundNoRack         = errors.New("rack_id: the good units go on a rack of this warehouse")
)

// createReshippingParcel writes a RESHIPPING row's INBOUND parcel in the resolution's transaction, under the restock's
// lock (a-suppliers-reshipping-comes-in-as-a-custom-shipment, 🔄 A: created by the selling team with the row, in the
// same step): the parcel (on its way, from the restock's supplier to the warehouse chosen, the warehouse paying the door
// charge), its lines as typed (the products' code and name snapshotted), its first trail row and the link joining the
// restock, the row and the parcel.
func createReshippingParcel(
	tx *gorm.DB,
	rr *models.Restock,
	row *models.RestockResolution,
	draft *inventoryv1.RestockReshippingParcel,
	facts map[uint64]ProductFact,
) (*models.CustomShipment, error) {
	supplierID, err := reshippingSupplier(tx, rr.ID, draft.GetSupplierId())
	if err != nil {
		return nil, err
	}

	warehouseID := draft.GetWarehouseId()
	if warehouseID == 0 {
		warehouseID = rr.WarehouseID
	}

	cs := models.CustomShipment{
		TeamID:            rr.TeamID,
		WarehouseID:       warehouseID,
		Kind:              models.CustomShipmentSupplierReshipping,
		Status:            models.CustomShipmentOnTheWay,
		RestockID:         rr.ID,
		SupplierID:        supplierID,
		ShipmentChannelID: draft.GetShipmentChannelId(),
		// The door charge is the warehouse's to pay — the restock's (🔄 A), never the outbound parcels' two ways.
		Payer:           models.CustomShipmentPayerWarehouse,
		Resi:            strings.TrimSpace(draft.GetResi()),
		IdempotencyKey:  row.IdempotencyKey,
		CreatedByUserID: row.CreatedByUserID,
	}

	for _, line := range draft.GetLines() {
		cs.Total += float64(line.GetCount()) * line.GetPriceUnit()
	}

	err = insertCustomShipment(tx, &cs)
	if err != nil {
		return nil, err
	}

	items := make([]models.CustomShipmentItem, 0, len(draft.GetLines()))
	for _, line := range draft.GetLines() {
		fact := facts[line.GetProductId()]

		items = append(items, models.CustomShipmentItem{
			CustomShipmentID: cs.ID,
			ProductID:        line.GetProductId(),
			ProductCode:      fact.ProductCode,
			Name:             fact.Name,
			Quantity:         int64(line.GetCount()),
			PriceUnit:        line.GetPriceUnit(),
			Total:            float64(line.GetCount()) * line.GetPriceUnit(),
		})
	}

	err = tx.
		Create(&items).
		Error
	if err != nil {
		return nil, fmt.Errorf("reshipping lines: %w", err)
	}

	err = appendCustomShipmentLog(tx, cs.ID, "", models.CustomShipmentOnTheWay, row.CreatedByUserID,
		row.CreatedByIsOverride, "")
	if err != nil {
		return nil, err
	}

	err = linkResolutionParcel(tx, rr.ID, row.ID, cs.ID)
	if err != nil {
		return nil, err
	}

	return &cs, nil
}

// reshippingSupplier is who sends the reshipping: the supplier asked for, when one of the restock's lines names it; else
// the ONE supplier every line names (0 when they name none, or several).
func reshippingSupplier(tx *gorm.DB, restockID, asked uint64) (uint64, error) {
	var named []uint64

	err := tx.
		Model(&models.RestockItem{}).
		Where("restock_id = ? AND supplier_id IS NOT NULL", restockID).
		Distinct().
		Pluck("supplier_id", &named).
		Error
	if err != nil {
		return 0, fmt.Errorf("read the restock's suppliers: %w", err)
	}

	if asked != 0 {
		for _, id := range named {
			if id == asked {
				return asked, nil
			}
		}

		return 0, errReshippingSupplier
	}

	var lines, unnamed int64

	err = tx.
		Model(&models.RestockItem{}).
		Select("COUNT(*), COUNT(*) FILTER (WHERE supplier_id IS NULL)").
		Where("restock_id = ?", restockID).
		Row().
		Scan(&lines, &unnamed)
	if err != nil {
		return 0, fmt.Errorf("count the restock's lines: %w", err)
	}

	if len(named) == 1 && unnamed == 0 {
		return named[0], nil
	}

	return 0, nil
}

// lockInboundParcel locks ONE inbound parcel row FOR UPDATE as the side named; another team's — or an outbound parcel —
// reads as refused: NotFound for another team, FailedPrecondition for an outbound one.
func lockInboundParcel(tx *gorm.DB, id, teamID uint64, side customShipmentSide) (*models.CustomShipment, error) {
	cs, err := lockCustomShipment(tx, id, teamID, side)
	if err != nil {
		return nil, err
	}

	if cs.Kind != models.CustomShipmentSupplierReshipping {
		return nil, errInboundOnly
	}

	return cs, nil
}

// doorCharge is the courier's charge at the door under a restock's rule: its note — what it was for — is OPTIONAL
// (the-couriers-charge-note-is-optional), so an amount with no note is kept as it is; with no amount there is no note.
func doorCharge(charge float64, note string) (float64, string) {
	if !san_money.Positive(charge) {
		return 0, ""
	}

	return charge, strings.TrimSpace(note)
}

// doorChargeText is the trail's words for a noted charge — the warehouse's own money, read by both sides
// (the-warehouse-sees-the-ongkir-it-paid): "courier's charge Rp 8.000 — COD", or the amount alone when no note was
// given (the-couriers-charge-note-is-optional).
func doorChargeText(charge float64, note string) string {
	if !san_money.Positive(charge) {
		return ""
	}

	if note == "" {
		return "courier's charge " + san_money.Text(charge)
	}

	return "courier's charge " + san_money.Text(charge) + " — " + note
}

// customShipmentDirection is which way a kind goes.
func customShipmentDirection(kind models.CustomShipmentKind) inventoryv1.CustomShipmentDirection {
	if kind == models.CustomShipmentSupplierReshipping {
		return inventoryv1.CustomShipmentDirection_CUSTOM_SHIPMENT_DIRECTION_INBOUND
	}

	return inventoryv1.CustomShipmentDirection_CUSTOM_SHIPMENT_DIRECTION_OUTBOUND
}

// inboundErr maps an inbound act's refusal to Connect — its own, then a move's.
func inboundErr(err error) error {
	switch {
	case errors.Is(err, errInboundOnly):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, errInboundLineUnknown),
		errors.Is(err, errInboundLineTwice),
		errors.Is(err, errInboundCountMissing),
		errors.Is(err, errInboundOverCount),
		errors.Is(err, errInboundBrokenOverRecv),
		errors.Is(err, errInboundNoRack):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, errRackMissing):
		return connect.NewError(connect.CodeNotFound, errRackMissing)
	default:
		return customShipmentMoveErr(err)
	}
}

// inventoryNow is an inbound act's instant — every column and trail row it writes carries it.
func inventoryNow() time.Time {
	return time.Now()
}

// moveInbound writes a LOCKED inbound parcel's new status — its actor and time (customShipmentActorColumns), any extra
// columns — and its trail row with the words given. Signed for straight into Terima stamps who signed for it too, as a
// restock counted straight from ongoing (the-restock-prototype-is-accepted). The row in hand reads as stored after.
func moveInbound(
	tx *gorm.DB,
	cs *models.CustomShipment,
	to models.CustomShipmentStatus,
	actorID uint64,
	override bool,
	extra map[string]any,
	description string,
) error {
	from := cs.Status
	now := inventory_ledgers.TxNow(tx)

	updates := map[string]any{"status": to, "updated_at": now}
	if cols, ok := customShipmentActorColumns[to]; ok {
		updates[cols[0]] = actorID
		updates[cols[1]] = now
	}

	if to == models.CustomShipmentReceived && cs.ArrivedAt == nil {
		updates["arrived_by_user_id"] = actorID
		updates["arrived_at"] = now
		cs.ArrivedByUserID, cs.ArrivedAt = actorID, &now
	}

	for k, v := range extra {
		updates[k] = v
	}

	err := tx.
		Model(cs).
		Updates(updates).
		Error
	if err != nil {
		return fmt.Errorf("custom shipment %d to %s: %w", cs.ID, to, err)
	}

	cs.Status = to
	cs.UpdatedAt = now

	switch to {
	case models.CustomShipmentArrived:
		cs.ArrivedByUserID, cs.ArrivedAt = actorID, &now
	case models.CustomShipmentReceived:
		cs.ReceivedByUserID, cs.ReceivedAt = actorID, &now
	case models.CustomShipmentLost:
		cs.LostByUserID, cs.LostAt = actorID, &now
	}

	return writeCustomShipmentLog(tx, &models.CustomShipmentLog{
		CustomShipmentID: cs.ID,
		Kind:             models.CustomShipmentLogStatus,
		FromStatus:       from,
		ToStatus:         to,
		ActorUserID:      actorID,
		IsOverride:       override,
		Description:      description,
	})
}
