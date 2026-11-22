package inventory_v1

import (
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE CUSTOM SHIPMENT'S MOVES (backlog #88 P3) — what CostSet, Cancel, Picked and Handover share: the parcel row's lock,
// the status rule, the status write with its trail row, and the refusals only a move makes.
//
//	requested ──Picked (warehouse)──▶ picked ──Handover (warehouse)──▶ handed_over
//	    │                              │
//	    └──Cancel (selling team)──▶ cancelled         CostSet (selling team, TEAM payer): requested or picked, status kept
//
// Every move starts by locking the ONE parcel row `FOR UPDATE`, so two moves of one parcel queue and the second judges
// what the first committed (a cancel racing the pick: exactly one wins).

var (
	errCustomShipmentWrongStatus = errors.New("custom shipment is in the wrong status for this")
	errCustomShipmentTeamPaysNot = errors.New("only a courier the selling team pays has an account and a cost to " +
		"edit — the warehouse types its own cost at the handover")
	errCustomShipmentCostNeeded = errors.New("shipping_cost: required — the warehouse pays this courier, so type what " +
		"it paid (0 if nothing)")
	errCustomShipmentCostRefused = errors.New("shipping_cost: the selling team pays this courier — the warehouse " +
		"types no cost")
)

// customShipmentSide is which end of a parcel a move is made from — the column the caller's team must match.
type customShipmentSide string

const (
	// customShipmentOwner is the owning SELLING team — CostSet and Cancel.
	customShipmentOwner customShipmentSide = "team_id"
	// customShipmentShipper is the warehouse it ships from — Picked and Handover.
	customShipmentShipper customShipmentSide = "warehouse_id"
)

// lockCustomShipment locks ONE parcel row FOR UPDATE, as the side named. A parcel the team is not that side of reads as
// one that never existed (NotFound) — the owning team cannot pick, the warehouse cannot cancel. Lines and trail are not
// loaded: FOR UPDATE and a preload's second statement are judged on the row alone.
func lockCustomShipment(tx *gorm.DB, id, teamID uint64, side customShipmentSide) (*models.CustomShipment, error) {
	var cs models.CustomShipment

	err := tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND "+string(side)+" = ?", id, teamID).
		First(&cs).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errCustomShipmentMissing
	}

	if err != nil {
		return nil, err
	}

	return &cs, nil
}

// requireCustomShipmentStatus refuses a move from any status but the ones named.
func requireCustomShipmentStatus(
	cs *models.CustomShipment,
	action string,
	allowed ...models.CustomShipmentStatus,
) error {
	for _, s := range allowed {
		if cs.Status == s {
			return nil
		}
	}

	return fmt.Errorf("%w: a custom shipment is %s only while %v, and this one is %s", errCustomShipmentWrongStatus,
		action, allowed, cs.Status)
}

// customShipmentActorColumns is where each status keeps who moved the parcel there, and when.
var customShipmentActorColumns = map[models.CustomShipmentStatus][2]string{
	models.CustomShipmentPicked:     {"picked_by_user_id", "picked_at"},
	models.CustomShipmentHandedOver: {"handed_over_by_user_id", "handed_over_at"},
	models.CustomShipmentCancelled:  {"cancelled_by_user_id", "cancelled_at"},
	// The INBOUND steps (backlog #101, moveInbound).
	models.CustomShipmentArrived:  {"arrived_by_user_id", "arrived_at"},
	models.CustomShipmentReceived: {"received_by_user_id", "received_at"},
	models.CustomShipmentLost:     {"lost_by_user_id", "lost_at"},
}

// moveCustomShipment writes a LOCKED parcel's new status — its actor and time, and any extra columns — and its trail row.
// The row in hand is left reading as stored: the event after commit is built from it.
func moveCustomShipment(
	tx *gorm.DB,
	cs *models.CustomShipment,
	to models.CustomShipmentStatus,
	actorID uint64,
	override bool,
	extra map[string]any,
) error {
	// Read before the write: GORM copies an update map back into the row it was given.
	from := cs.Status
	// The stock transaction's clock when the move rides one (a sample's cancel), time.Now() otherwise.
	now := inventory_ledgers.TxNow(tx)

	updates := map[string]any{"status": to, "updated_at": now}
	if cols, ok := customShipmentActorColumns[to]; ok {
		updates[cols[0]] = actorID
		updates[cols[1]] = now
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
	case models.CustomShipmentPicked:
		cs.PickedByUserID, cs.PickedAt = actorID, &now
	case models.CustomShipmentHandedOver:
		cs.HandedOverByUserID, cs.HandedOverAt = actorID, &now
	case models.CustomShipmentCancelled:
		cs.CancelledByUserID, cs.CancelledAt = actorID, &now
	}

	return appendCustomShipmentLog(tx, cs.ID, from, to, actorID, override, "")
}

// customShipmentCostText is a cost edit's trail note — the team's cost before and after, as a person reads it
// ("Rp 15.000 → Rp 20.000", the prototype's row). It names the TEAM's own money, so the warehouse never reads it
// (customShipmentToProto leaves an edit's description out without money).
func customShipmentCostText(oldCost, newCost float64) string {
	return san_money.Text(oldCost) + " → " + san_money.Text(newCost)
}

// customShipmentMoveErr maps a move's refusal to Connect — its own refusals first, then everything the create's map
// knows (NotFound, a count's lock, an inactive account).
func customShipmentMoveErr(err error) error {
	switch {
	case errors.Is(err, errCustomShipmentWrongStatus),
		errors.Is(err, errCustomShipmentTeamPaysNot),
		errors.Is(err, inventory_mutations.ErrNotARequestedParcelSample):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, errCustomShipmentCostNeeded),
		errors.Is(err, errCustomShipmentCostRefused),
		// A goods-missing note naming what the parcel does not hold (CustomShipmentMissingReport).
		errors.Is(err, errCustomShipmentMissingLineUnknown),
		errors.Is(err, errCustomShipmentMissingLineTwice),
		errors.Is(err, errCustomShipmentMissingRack),
		errors.Is(err, errCustomShipmentMissingReshipRack),
		errors.Is(err, errCustomShipmentMissingTooMany):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		return customShipmentErr(err)
	}
}
