package inventory_v1

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// *BARANG TIDAK KETEMU* (backlog #88 P6, docs/business/custom_shipments/context_decision.md).
//
//	missing-goods-leave-a-note-on-the-custom-shipment   the shipping warehouse records goods missing — what, and from
//	                                                    which rack — as a row on the parcel's trail; the parcel stays
//	                                                    requested and the owning team decides (cancel, or wait); the
//	                                                    warehouse never cancels; a stock count finds the shortfall
//	the-goods-missing-prototype-is-accepted             one row per rack the sample's take used, each its own most; a
//	                                                    reship's rows name no rack; an optional note ≤ 200; nothing else
//	                                                    moves — no status, no stock write, nothing posts; the warehouse
//	                                                    may record again while requested (the prototype's default)
//	missing-reship-units-are-not-offered-again          the units a note names on a reship that is then cancelled stay
//	                                                    off the reship choices and the create's cap (reshipItemGone)
var (
	errCustomShipmentMissingLineUnknown = errors.New("a goods-missing line names a line that is not this parcel's")
	errCustomShipmentMissingLineTwice   = errors.New("a goods-missing note names a line and rack once")
	errCustomShipmentMissingRack        = errors.New("a goods-missing line names a rack this line's take did not draw from")
	errCustomShipmentMissingReshipRack  = errors.New("a reship's broken units were never on a rack — its lines name none")
	errCustomShipmentMissingTooMany     = errors.New("more missing than the parcel holds there")
)

// CustomShipmentMissingReport is the shipping warehouse noting goods it cannot find on a parcel still REQUESTED: ONE
// trail row of its own kind (goods_missing, from = to = requested) with its lines and its optional note. Nothing else is
// written — the parcel's row is not touched, no ledger, no event: the status stays, the team decides
// (missing-goods-leave-a-note-on-the-custom-shipment). It may be recorded again while requested; each note is a row, the
// latest is the open one the badge and the notices read.
//
// The parcel row is locked FOR UPDATE first — the lock Picked and Cancel take — so a note racing the pick or the cancel
// of the same parcel queues behind it and is judged on what that committed: once picked or cancelled it is refused
// (FailedPrecondition), and a cancel after the note finds it written (the cancelled reship's named units stay gone).
//
// The lines: a SAMPLE line names a rack its take drew this line's product from, at most what it drew there (the take's
// own rack rows — takeRackUnits, the pick page's reading), or rack 0 only when the take recorded no rack for it, at most
// the line's units; a RESHIP line names no rack (its broken units were never on one), at most the line's units. A line
// and rack once per note. The owning team and any other warehouse read NotFound. The answer is read as the warehouse
// reads it — no seller money.
func (s *Service) CustomShipmentMissingReport(
	ctx context.Context,
	req *connect.Request[inventoryv1.CustomShipmentMissingReportRequest],
) (*connect.Response[inventoryv1.CustomShipmentMissingReportResponse], error) {
	msg := req.Msg
	actor := actorFrom(ctx)
	override := overrideFrom(ctx)
	note := strings.TrimSpace(msg.GetNote())

	var cs *models.CustomShipment

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var lockErr error

		cs, lockErr = lockCustomShipment(tx, msg.GetId(), msg.GetTeamId(), customShipmentShipper)
		if lockErr != nil {
			return lockErr
		}

		statusErr := requireCustomShipmentStatus(cs, "noted with goods missing", models.CustomShipmentRequested)
		if statusErr != nil {
			return statusErr
		}

		lines, judgeErr := judgeMissingLines(tx, cs, msg.GetLines())
		if judgeErr != nil {
			return judgeErr
		}

		row := &models.CustomShipmentLog{
			CustomShipmentID: cs.ID,
			Kind:             models.CustomShipmentLogGoodsMissing,
			FromStatus:       models.CustomShipmentRequested,
			ToStatus:         models.CustomShipmentRequested,
			ActorUserID:      actor,
			IsOverride:       override,
			Description:      note,
		}

		writeErr := writeCustomShipmentLog(tx, row)
		if writeErr != nil {
			return writeErr
		}

		for i := range lines {
			lines[i].CustomShipmentLogID = row.ID
		}

		return tx.
			Create(&lines).
			Error
	})
	if err != nil {
		return nil, customShipmentMoveErr(err)
	}

	wire, err := customShipmentForWire(s.db.WithContext(ctx), cs.ID, msg.GetTeamId())
	if err != nil {
		return nil, customShipmentMoveErr(err)
	}

	return connect.NewResponse(&inventoryv1.CustomShipmentMissingReportResponse{CustomShipment: wire}), nil
}

// missingKey is one line on one rack — named once per note.
type missingKey struct {
	itemID uint64
	rackID uint64
}

// judgeMissingLines resolves a note's lines on its LOCKED parcel: each a line of it, a line and rack once, and none
// over what the parcel holds there — a sample's line on a rack at most what its take drew from that rack (rack 0 only
// for a line the take recorded no rack for, at most the line's units); a reship's line on no rack, at most its units.
// Two statements for a sample (its lines, its take's racks), one for a reship.
func judgeMissingLines(
	tx *gorm.DB,
	cs *models.CustomShipment,
	wanted []*inventoryv1.CustomShipmentMissingLine,
) ([]models.CustomShipmentMissingLine, error) {
	var items []models.CustomShipmentItem

	err := tx.
		Where("custom_shipment_id = ?", cs.ID).
		Order("id ASC").
		Find(&items).
		Error
	if err != nil {
		return nil, fmt.Errorf("read the parcel's lines: %w", err)
	}

	byID := make(map[uint64]*models.CustomShipmentItem, len(items))
	for i := range items {
		byID[items[i].ID] = &items[i]
	}

	// A sample's racks — what its take drew, per product and rack. A reship took nothing.
	drawn := map[uint64]map[uint64]int64{}

	if cs.Kind == models.CustomShipmentSample && cs.TransactionID != nil {
		racks, racksErr := takeRackUnits(tx, []uint64{*cs.TransactionID}, cs.WarehouseID)
		if racksErr != nil {
			return nil, fmt.Errorf("read the take's racks: %w", racksErr)
		}

		for _, r := range racks {
			if drawn[r.ProductID] == nil {
				drawn[r.ProductID] = map[uint64]int64{}
			}

			drawn[r.ProductID][r.RackID] += r.Quantity
		}
	}

	seen := map[missingKey]bool{}
	out := make([]models.CustomShipmentMissingLine, 0, len(wanted))

	for _, w := range wanted {
		item := byID[w.GetItemId()]
		if item == nil {
			return nil, fmt.Errorf("%w: line %d", errCustomShipmentMissingLineUnknown, w.GetItemId())
		}

		key := missingKey{itemID: item.ID, rackID: w.GetRackId()}
		if seen[key] {
			return nil, fmt.Errorf("%w: line %d, rack %d", errCustomShipmentMissingLineTwice, item.ID, w.GetRackId())
		}

		seen[key] = true

		most, mostErr := missingMost(cs, item, w.GetRackId(), drawn[item.ProductID])
		if mostErr != nil {
			return nil, mostErr
		}

		if int64(w.GetQuantity()) > most {
			return nil, fmt.Errorf("%w: line %d (product %d), rack %d — %d missing, %d there",
				errCustomShipmentMissingTooMany, item.ID, item.ProductID, w.GetRackId(), w.GetQuantity(), most)
		}

		out = append(out, models.CustomShipmentMissingLine{
			CustomShipmentItemID: item.ID,
			RackID:               w.GetRackId(),
			Quantity:             int64(w.GetQuantity()),
		})
	}

	return out, nil
}

// missingMost is the most a note may say is missing of one line on one rack: a reship's line (rack 0 only) its units; a
// sample's line on a rack its take drew from what it drew there, and on rack 0 its units only when the take recorded no
// rack for it (the dialog's one row for such a line).
func missingMost(
	cs *models.CustomShipment,
	item *models.CustomShipmentItem,
	rackID uint64,
	racks map[uint64]int64,
) (int64, error) {
	if cs.Kind == models.CustomShipmentReship {
		if rackID != 0 {
			return 0, fmt.Errorf("%w: line %d", errCustomShipmentMissingReshipRack, item.ID)
		}

		return item.Quantity, nil
	}

	if rackID == 0 {
		if len(racks) > 0 {
			return 0, fmt.Errorf("%w: line %d names no rack, and its take drew from one", errCustomShipmentMissingRack,
				item.ID)
		}

		return item.Quantity, nil
	}

	units, ok := racks[rackID]
	if !ok {
		return 0, fmt.Errorf("%w: line %d, rack %d", errCustomShipmentMissingRack, item.ID, rackID)
	}

	return units, nil
}
