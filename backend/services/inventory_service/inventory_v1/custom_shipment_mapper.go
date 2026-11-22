package inventory_v1

import (
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE CUSTOM SHIPMENT (docs/business/custom_shipments/context_decision.md): a parcel the warehouse sends that is not a
// marketplace order — a sample of the owning team's units, or a received restock's broken units back to its supplier.
// This file holds what every handler shares: the errors, the trail and the wire shape.

var (
	errCustomShipmentMissing        = errors.New("custom shipment not found")
	errCustomShipmentKeyUsed        = errors.New("idempotency_key: already used by another custom shipment of the team")
	errCustomShipmentAccountNeeded  = errors.New("finance_account_id: required when the selling team pays the courier")
	errCustomShipmentWarehousePays  = errors.New("a courier the warehouse pays names no account and no cost at create — the warehouse types the cost at the handover")
	errCustomShipmentSampleShape    = errors.New("a sample names its warehouse and products — never a restock or a restock line")
	errCustomShipmentReshipShape    = errors.New("a reship names its restock and that restock's lines")
	errCustomShipmentLineTwice      = errors.New("a product or a restock line appears once per custom shipment")
	errCustomShipmentNotOwned       = errors.New("a sample carries only the team's own products")
	errCustomShipmentRestockMissing = errors.New("restock not found")
	errCustomShipmentNotReceived    = errors.New("only a received restock's broken units can be sent back")
	errCustomShipmentWrongWarehouse = errors.New("a reship ships from its restock's warehouse")
	errCustomShipmentLineUnknown    = errors.New("a line names a restock line that is not this restock's, or another product")
	errCustomShipmentTwoSuppliers   = errors.New("one custom shipment goes to one supplier — these lines name different suppliers")
)

// ReshipShortError refuses a reship that would send more of a restock line than is still free: its broken units at
// Terima less the units another live reship already carries (the-custom-shipments-prototype-is-accepted) and the units
// a goods-missing note named on a cancelled one (missing-reship-units-are-not-offered-again). It names EVERY line over,
// and nothing was written.
type ReshipShortError struct {
	Lines []ReshipShortLine
}

// ReshipShortLine is one restock line asked for more than it may still send.
type ReshipShortLine struct {
	RestockItemID uint64
	ProductID     uint64
	Wanted        int64
	Broken        int64
	AlreadySent   int64
	// Units a goods-missing note named on a reship of the line that was then cancelled — gone.
	NotFound int64
}

func (e *ReshipShortError) Error() string {
	msg := "more than the restock line's broken units left to send back:"
	for _, line := range e.Lines {
		msg += fmt.Sprintf(" line %d (product %d) wants %d, %d broken, %d already on a live reship",
			line.RestockItemID, line.ProductID, line.Wanted, line.Broken, line.AlreadySent)
		if line.NotFound > 0 {
			msg += fmt.Sprintf(", %d noted not found on a cancelled one", line.NotFound)
		}

		msg += ";"
	}

	return msg
}

// customShipmentErr maps a custom shipment's refusal to Connect.
func customShipmentErr(err error) error {
	var (
		short  *inventory_mutations.ShortLinesError
		reship *ReshipShortError
	)

	// A take from a rack a stock count holds (a-lock-stops-sales-and-cancels-too).
	if refused := countedRefusal(err); refused != nil {
		return refused
	}

	switch {
	case errors.Is(err, gorm.ErrRecordNotFound), errors.Is(err, errCustomShipmentMissing):
		return connect.NewError(connect.CodeNotFound, errCustomShipmentMissing)
	case errors.Is(err, errCustomShipmentRestockMissing):
		return connect.NewError(connect.CodeNotFound, errCustomShipmentRestockMissing)
	case errors.Is(err, errCustomShipmentKeyUsed):
		return connect.NewError(connect.CodeAlreadyExists, errCustomShipmentKeyUsed)
	case errors.As(err, &short):
		// Too few in the warehouse fails the create and names every short line, as a transfer's out-leg.
		msg := "not enough stock in the warehouse:"
		for _, line := range short.Lines {
			msg += fmt.Sprintf(" product %d wants %d, holds %d;", line.ProductID, line.Wanted, line.Available)
		}

		return connect.NewError(connect.CodeFailedPrecondition, errors.New(msg))
	case errors.As(err, &reship):
		return connect.NewError(connect.CodeFailedPrecondition, reship)
	case errors.Is(err, errCustomShipmentNotReceived),
		errors.Is(err, errAccountNotActive):
		// The courier's account must be one of the team's active ones: FailedPrecondition, naming it (paying_accounts.go).
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, errCustomShipmentAccountNeeded),
		errors.Is(err, errCustomShipmentWarehousePays),
		errors.Is(err, errCustomShipmentSampleShape),
		errors.Is(err, errCustomShipmentReshipShape),
		errors.Is(err, errCustomShipmentLineTwice),
		errors.Is(err, errCustomShipmentNotOwned),
		errors.Is(err, errCustomShipmentWrongWarehouse),
		errors.Is(err, errCustomShipmentLineUnknown),
		errors.Is(err, errCustomShipmentTwoSuppliers):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}

// appendCustomShipmentLog writes one step's or cost edit's trail row. from is empty on the create's row; a cost edit's
// row has from = to, and says so in its kind (00059) — a goods-missing note is from = to too, and is written by its own
// handler with its lines (writeCustomShipmentLog).
func appendCustomShipmentLog(
	tx *gorm.DB,
	shipmentID uint64,
	from, to models.CustomShipmentStatus,
	actorID uint64,
	override bool,
	description string,
) error {
	kind := models.CustomShipmentLogStatus
	if from == to {
		kind = models.CustomShipmentLogCostEdit
	}

	return writeCustomShipmentLog(tx, &models.CustomShipmentLog{
		CustomShipmentID: shipmentID,
		Kind:             kind,
		FromStatus:       from,
		ToStatus:         to,
		ActorUserID:      actorID,
		IsOverride:       override,
		Description:      description,
	})
}

// writeCustomShipmentLog inserts one trail row as given; its id is filled in.
func writeCustomShipmentLog(tx *gorm.DB, row *models.CustomShipmentLog) error {
	err := tx.
		Create(row).
		Error
	if err != nil {
		return fmt.Errorf("custom shipment %d trail: %w", row.CustomShipmentID, err)
	}

	return nil
}

// customShipmentDescription names the parcel on a sample's stock transaction, so a history row reads back to it.
func customShipmentDescription(id uint64) string {
	return fmt.Sprintf("custom shipment #%d", id)
}

// customShipmentReadsMoney is whether the team reading a parcel may see the seller's money: the owning selling team and
// the root team do; the warehouse that ships it never does — on screen or in the data (a-warehouse-sees-no-seller-money,
// the-custom-shipments-prototype-is-accepted).
func customShipmentReadsMoney(cs *models.CustomShipment, readerTeamID uint64) bool {
	return readerTeamID == cs.TeamID || readerTeamID == san_auth.RootTeamID
}

// customShipmentForWire reads one parcel with its lines and trail, as `readerTeamID` reads it — what Create and Detail
// answer. The scope IS the WHERE clause: the owning selling team (team_id) or the warehouse that ships it
// (warehouse_id); the root team reads any. Anything else reads as NotFound, never "forbidden" — that would confirm the
// id exists. Three statements: the row, its lines, its trail — and a fourth, the goods-missing notes' lines, only when
// the trail holds a note.
func customShipmentForWire(db *gorm.DB, id, readerTeamID uint64) (*inventoryv1.CustomShipment, error) {
	var cs models.CustomShipment

	q := db.
		Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		Preload("Logs", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		Where("id = ?", id)

	if readerTeamID != san_auth.RootTeamID {
		q = q.Where("(team_id = ? OR warehouse_id = ?)", readerTeamID, readerTeamID)
	}

	err := q.
		First(&cs).
		Error
	if err != nil {
		return nil, err
	}

	var noteIDs []uint64

	for _, l := range cs.Logs {
		if l.Kind == models.CustomShipmentLogGoodsMissing {
			noteIDs = append(noteIDs, l.ID)
		}
	}

	missing, err := customShipmentMissingLines(db, noteIDs)
	if err != nil {
		return nil, err
	}

	links, err := parcelLinks(db, []uint64{cs.ID})
	if err != nil {
		return nil, err
	}

	wire := customShipmentToProto(&cs, customShipmentReadsMoney(&cs, readerTeamID), true, missing)
	withParcelLink(wire, links)

	return wire, nil
}

// withParcelLink sets a parcel's resolution and — for an inbound one — the stock-in its Terima linked
// (`restock_custom_shipments`, backlog #101). A parcel no resolution rides keeps 0.
func withParcelLink(wire *inventoryv1.CustomShipment, links map[uint64]parcelLink) {
	link, ok := links[wire.GetId()]
	if !ok {
		return
	}

	wire.ResolutionId = link.ResolutionID

	if wire.GetDirection() == inventoryv1.CustomShipmentDirection_CUSTOM_SHIPMENT_DIRECTION_INBOUND {
		wire.TransactionId = link.InventoryTransactionID
	}
}

// customShipmentMissingLines is, per goods-missing trail row named, its lines in the order recorded — each with its
// parcel line's product snapshot and its rack's code as it reads now (none for rack 0). One statement; none for no row.
func customShipmentMissingLines(
	db *gorm.DB,
	logIDs []uint64,
) (map[uint64][]*inventoryv1.CustomShipmentMissingItem, error) {
	out := make(map[uint64][]*inventoryv1.CustomShipmentMissingItem, len(logIDs))
	if len(logIDs) == 0 {
		return out, nil
	}

	var rows []struct {
		LogID       uint64
		ItemID      uint64
		ProductID   uint64
		ProductCode string
		Name        string
		RackID      uint64
		RackCode    *string
		Quantity    int64
	}

	err := db.
		Table("custom_shipment_missing_lines AS ml").
		Select("ml.custom_shipment_log_id AS log_id, ml.custom_shipment_item_id AS item_id, i.product_id, "+
			"i.product_code, i.name, ml.rack_id, p.code AS rack_code, ml.quantity").
		Joins("JOIN custom_shipment_items i ON i.id = ml.custom_shipment_item_id").
		Joins("LEFT JOIN placements p ON p.id = ml.rack_id").
		Where("ml.custom_shipment_log_id IN ?", logIDs).
		Order("ml.custom_shipment_log_id, ml.id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, fmt.Errorf("read the goods-missing lines: %w", err)
	}

	for _, r := range rows {
		line := &inventoryv1.CustomShipmentMissingItem{
			ItemId:      r.ItemID,
			ProductId:   r.ProductID,
			ProductCode: r.ProductCode,
			Name:        r.Name,
			RackId:      r.RackID,
			Quantity:    uint64(r.Quantity),
		}

		if r.RackCode != nil && r.RackID != 0 {
			line.RackCode = *r.RackCode
		}

		out[r.LogID] = append(out[r.LogID], line)
	}

	return out, nil
}

// customShipmentNote is a goods-missing trail row as the parcel carries it while it waits on the team.
func customShipmentNote(
	l *models.CustomShipmentLog,
	lines []*inventoryv1.CustomShipmentMissingItem,
) *inventoryv1.CustomShipmentGoodsMissing {
	return &inventoryv1.CustomShipmentGoodsMissing{
		LogId:       l.ID,
		Lines:       lines,
		Note:        l.Description,
		ActorUserId: l.ActorUserID,
		AtUnix:      l.CreatedAt.Unix(),
		IsOverride:  l.IsOverride,
	}
}

// customShipmentToProto is a stored parcel on the wire. Without money — the warehouse's read — the sample's value, each
// line's value, the team's account and a TEAM payer's cost are left UNSET; a WAREHOUSE payer's cost is the ongkir the
// warehouse paid, so it is sent (the-warehouse-sees-the-ongkir-it-paid).
//
// With its trail, `missing` holds the goods-missing rows' lines (customShipmentMissingLines), and the OPEN note — the
// latest while the parcel is requested — is its `goods_missing`. A list row has no trail: its caller sets that field from
// customShipmentOpenNotes. A note carries no money, so both sides are sent it whole.
func customShipmentToProto(
	cs *models.CustomShipment,
	withMoney, withLogs bool,
	missing map[uint64][]*inventoryv1.CustomShipmentMissingItem,
) *inventoryv1.CustomShipment {
	out := &inventoryv1.CustomShipment{
		Id:          cs.ID,
		TeamId:      cs.TeamID,
		WarehouseId: cs.WarehouseID,
		Kind:        customShipmentKindToProto(cs.Kind),
		Status:      customShipmentStatusToProto(cs.Status),
		RestockId:   cs.RestockID,
		SupplierId:  cs.SupplierID,
		Recipient: &inventoryv1.CustomShipmentRecipient{
			Name:    cs.RecipientName,
			Phone:   cs.RecipientPhone,
			Address: cs.RecipientAddress,
		},
		ShipmentChannelId:  cs.ShipmentChannelID,
		Payer:              customShipmentPayerToProto(cs.Payer),
		Resi:               cs.Resi,
		Note:               cs.Note,
		CreatedByUserId:    cs.CreatedByUserID,
		CreatedAtUnix:      cs.CreatedAt.Unix(),
		PickedByUserId:     cs.PickedByUserID,
		PickedAtUnix:       unixOrZero(cs.PickedAt),
		HandedOverByUserId: cs.HandedOverByUserID,
		HandedOverAtUnix:   unixOrZero(cs.HandedOverAt),
		CancelledByUserId:  cs.CancelledByUserID,
		CancelledAtUnix:    unixOrZero(cs.CancelledAt),
		// Backlog #101 — which way, and the inbound steps.
		Direction:        customShipmentDirection(cs.Kind),
		ChargeNote:       cs.ChargeNote,
		ArrivedByUserId:  cs.ArrivedByUserID,
		ArrivedAtUnix:    unixOrZero(cs.ArrivedAt),
		ReceivedByUserId: cs.ReceivedByUserID,
		ReceivedAtUnix:   unixOrZero(cs.ReceivedAt),
		LostByUserId:     cs.LostByUserID,
		LostAtUnix:       unixOrZero(cs.LostAt),
		LostReason:       cs.LostReason,
	}

	if cs.TransactionID != nil {
		out.TransactionId = *cs.TransactionID
	}

	switch {
	case withMoney:
		out.FinanceAccountId = cs.FinanceAccountID
		out.ShippingCost = proto.Float64(cs.ShippingCost)
		out.Total = proto.Float64(cs.Total)
	case cs.Payer == models.CustomShipmentPayerWarehouse:
		out.ShippingCost = proto.Float64(cs.ShippingCost)
	}

	for _, item := range cs.Items {
		line := &inventoryv1.CustomShipmentItem{
			Id:          item.ID,
			ProductId:   item.ProductID,
			ProductCode: item.ProductCode,
			Name:        item.Name,
			Quantity:    uint64(item.Quantity),
			BrokenNote:  item.BrokenNote,
		}

		if item.RestockItemID != nil {
			line.RestockItemId = *item.RestockItemID
		}

		if withMoney {
			line.Total = proto.Float64(item.Total)
		}

		// INBOUND: the seller's price (its money — never the warehouse's to read) and Terima's count.
		if cs.Kind == models.CustomShipmentSupplierReshipping {
			if withMoney {
				line.PriceUnit = proto.Float64(item.PriceUnit)
			}

			if item.Received != nil {
				line.Received = proto.Uint64(uint64(*item.Received))
			}

			if item.Broken != nil {
				line.Broken = proto.Uint64(uint64(*item.Broken))
			}

			line.RackId = item.RackID
		}

		out.Items = append(out.Items, line)
	}

	if withLogs {
		for i := range cs.Logs {
			l := &cs.Logs[i]
			note := l.Kind == models.CustomShipmentLogGoodsMissing
			description := l.Description
			// A cost edit's row (from = to) names the TEAM's own cost — "Rp 15.000 → Rp 20.000"; a reader without money
			// (the shipping warehouse) reads that the cost was edited, never the figures
			// (a-warehouse-sees-no-seller-money: not on screen, nor in the data). A goods-missing note is from = to too,
			// but it is the warehouse's own words: it is never blanked.
			if !withMoney && l.FromStatus == l.ToStatus && !note && l.Kind != models.CustomShipmentLogResiEdit {
				description = ""
			}

			row := &inventoryv1.CustomShipmentLog{
				Id:          l.ID,
				FromStatus:  customShipmentStatusToProto(l.FromStatus),
				ToStatus:    customShipmentStatusToProto(l.ToStatus),
				ActorUserId: l.ActorUserID,
				AtUnix:      l.CreatedAt.Unix(),
				// The "by Root team" badge beside the actor (an-override-shows-a-platform-badge).
				IsOverride:  l.IsOverride,
				Description: description,
				Kind:        customShipmentLogKindToProto(l),
			}

			if note {
				row.Missing = missing[l.ID]

				// The open note: the latest while the parcel still waits on the team (the trail is oldest first).
				if cs.Status == models.CustomShipmentRequested {
					out.GoodsMissing = customShipmentNote(l, missing[l.ID])
				}
			}

			out.Logs = append(out.Logs, row)
		}
	}

	return out
}

// customShipmentLogKindToProto is a trail row's kind on the wire. A row written before 00059 carries the kind its
// back-fill gave it (from = to: a cost edit).
func customShipmentLogKindToProto(l *models.CustomShipmentLog) inventoryv1.CustomShipmentLogKind {
	switch l.Kind {
	case models.CustomShipmentLogGoodsMissing:
		return inventoryv1.CustomShipmentLogKind_CUSTOM_SHIPMENT_LOG_KIND_GOODS_MISSING
	case models.CustomShipmentLogCostEdit:
		return inventoryv1.CustomShipmentLogKind_CUSTOM_SHIPMENT_LOG_KIND_COST_EDIT
	case models.CustomShipmentLogResiEdit:
		return inventoryv1.CustomShipmentLogKind_CUSTOM_SHIPMENT_LOG_KIND_RESI_EDIT
	case models.CustomShipmentLogPriceEdit:
		return inventoryv1.CustomShipmentLogKind_CUSTOM_SHIPMENT_LOG_KIND_PRICE_EDIT
	default:
		return inventoryv1.CustomShipmentLogKind_CUSTOM_SHIPMENT_LOG_KIND_STATUS
	}
}

var customShipmentKinds = map[models.CustomShipmentKind]inventoryv1.CustomShipmentKind{
	models.CustomShipmentSample: inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_SAMPLE,
	models.CustomShipmentReship: inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP,
	// INBOUND (backlog #101).
	models.CustomShipmentSupplierReshipping: inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_SUPPLIER_RESHIPPING,
}

func customShipmentKindToProto(k models.CustomShipmentKind) inventoryv1.CustomShipmentKind {
	return customShipmentKinds[k]
}

var customShipmentStatuses = map[models.CustomShipmentStatus]inventoryv1.CustomShipmentStatus{
	models.CustomShipmentRequested:  inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_REQUESTED,
	models.CustomShipmentPicked:     inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_PICKED,
	models.CustomShipmentHandedOver: inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_HANDED_OVER,
	models.CustomShipmentCancelled:  inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_CANCELLED,
	// INBOUND (backlog #101).
	models.CustomShipmentOnTheWay: inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_ON_THE_WAY,
	models.CustomShipmentArrived:  inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_ARRIVED,
	models.CustomShipmentReceived: inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_RECEIVED,
	models.CustomShipmentLost:     inventoryv1.CustomShipmentStatus_CUSTOM_SHIPMENT_STATUS_LOST,
}

// customShipmentStatusToProto maps a stored status to the wire; the empty from of the create's trail row is UNSPECIFIED.
func customShipmentStatusToProto(s models.CustomShipmentStatus) inventoryv1.CustomShipmentStatus {
	return customShipmentStatuses[s]
}

var customShipmentPayers = map[models.CustomShipmentPayer]inventoryv1.CustomShipmentPayer{
	models.CustomShipmentPayerTeam:      inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_TEAM,
	models.CustomShipmentPayerWarehouse: inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE,
}

func customShipmentPayerToProto(p models.CustomShipmentPayer) inventoryv1.CustomShipmentPayer {
	return customShipmentPayers[p]
}

// customShipmentPayerFromProto maps the request's payer to the stored word; UNSPECIFIED (refused by validation) is "".
func customShipmentPayerFromProto(p inventoryv1.CustomShipmentPayer) models.CustomShipmentPayer {
	for stored, wire := range customShipmentPayers {
		if wire == p {
			return stored
		}
	}

	return ""
}
