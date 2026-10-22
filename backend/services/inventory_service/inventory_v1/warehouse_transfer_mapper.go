package inventory_v1

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE WAREHOUSE TRANSFER (docs/business/inventory/warehouse_transfer_decision.md): a selling team moves its own stock
// from A to B. Its legs are ledger transactions (post_transfer.go); this file holds what every handler shares — the
// errors, the row lock, the trail and the wire shape.

var (
	errTransferMissing          = errors.New("warehouse transfer not found")
	errTransferToItself         = errors.New("a transfer never goes to its own warehouse")
	errTransferProductTwice     = errors.New("a product appears once per transfer")
	errTransferProductNotOwned  = errors.New("a transfer carries only the team's own products")
	errTransferAccountRequired  = errors.New("finance_account_id: required when shipment_cost is above 0")
	errTransferChargeNoteNeeded = errors.New("warehouse_additional_cost_note: required when the charge is above 0")
	errTransferWrongStatus      = errors.New("the transfer is not in a status that allows this")
	errTransferCountEveryLine   = errors.New("lines: every line must be counted exactly once")
	errTransferCountInvalid     = errors.New("a counted line does not add up")
)

// transferSide is the column a team must match to act on a transfer: the owning team, A or B
// (the-team-opens-the-sender-ships-the-receiver-accepts). Any other team reads NotFound — never "forbidden", or the
// error confirms the transfer exists.
type transferSide string

const (
	sideOwner    transferSide = "team_id"
	sideSender   transferSide = "from_warehouse_id"
	sideReceiver transferSide = "to_warehouse_id"
)

// transferErr maps a transfer's refusal to Connect.
func transferErr(err error) error {
	var short *inventory_mutations.ShortLinesError

	switch {
	case errors.Is(err, gorm.ErrRecordNotFound), errors.Is(err, errTransferMissing):
		return connect.NewError(connect.CodeNotFound, errTransferMissing)
	case errors.Is(err, errRackMissing):
		return connect.NewError(connect.CodeNotFound, errRackMissing)
	case errors.As(err, &short):
		// Too few at A fails the create and names every short line (a-transfer-takes-from-the-sender-at-create).
		msg := "not enough stock at the sending warehouse:"
		for _, line := range short.Lines {
			msg += fmt.Sprintf(" product %d wants %d, holds %d;", line.ProductID, line.Wanted, line.Available)
		}

		return connect.NewError(connect.CodeFailedPrecondition, errors.New(msg))
	case errors.Is(err, errTransferWrongStatus):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, errTransferToItself),
		errors.Is(err, errTransferProductTwice),
		errors.Is(err, errTransferProductNotOwned),
		errors.Is(err, errTransferAccountRequired),
		errors.Is(err, errTransferChargeNoteNeeded),
		errors.Is(err, errTransferCountEveryLine),
		errors.Is(err, errTransferCountInvalid):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}

// lockTransfer locks ONE transfer row FOR UPDATE, as the side named (a-transfer-is-locked-before-any-status-change).
// Every status change starts here, so whoever comes second waits and then sees what the first did. Lines and problems
// load separately: FOR UPDATE and a join do not mix.
func lockTransfer(tx *gorm.DB, transferID, teamID uint64, side transferSide) (*models.WarehouseTransfer, error) {
	var t models.WarehouseTransfer

	err := tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND "+string(side)+" = ?", transferID, teamID).
		First(&t).
		Error
	if err != nil {
		return nil, err
	}

	return &t, nil
}

// requireStatus refuses a change from any status but the ones named.
func requireStatus(t *models.WarehouseTransfer, action string, allowed ...models.TransferStatus) error {
	for _, s := range allowed {
		if t.Status == s {
			return nil
		}
	}

	return fmt.Errorf("%w: a transfer is %s only while %v, and this one is %s", errTransferWrongStatus, action, allowed, t.Status)
}

// statusActorColumns is where each status keeps who moved it there, and when.
var statusActorColumns = map[models.TransferStatus][2]string{
	models.TransferProcess:  {"processed_by_user_id", "processed_at"},
	models.TransferShipped:  {"shipped_by_user_id", "shipped_at"},
	models.TransferArrived:  {"arrived_by_user_id", "arrived_at"},
	models.TransferAccepted: {"accepted_by_user_id", "accepted_at"},
	models.TransferCancel:   {"cancelled_by_user_id", "cancelled_at"},
	models.TransferLost:     {"lost_by_user_id", "lost_at"},
}

// moveTransfer writes a LOCKED transfer's new status — with its actor and time, and any extra columns — and its trail row
// (every-transfer-status-change-is-logged).
func moveTransfer(
	tx *gorm.DB,
	t *models.WarehouseTransfer,
	to models.TransferStatus,
	actorID uint64,
	description string,
	extra map[string]any,
) error {
	// Read before the write: GORM copies an update map back into the row it was given.
	from := t.Status
	now := time.Now()

	updates := map[string]any{"status": to, "updated_at": now}
	if cols, ok := statusActorColumns[to]; ok {
		updates[cols[0]] = actorID
		updates[cols[1]] = now
	}

	for k, v := range extra {
		updates[k] = v
	}

	err := tx.Model(t).Updates(updates).Error
	if err != nil {
		return fmt.Errorf("transfer %d to %s: %w", t.ID, to, err)
	}

	// The row in hand reads as stored — the events after commit are built from it.
	setStatusActor(t, to, actorID, now)
	t.Status = to

	return appendTransferLog(tx, t.ID, from, to, actorID, description)
}

func setStatusActor(t *models.WarehouseTransfer, to models.TransferStatus, actorID uint64, at time.Time) {
	t.UpdatedAt = at

	switch to {
	case models.TransferProcess:
		t.ProcessedByUserID, t.ProcessedAt = actorID, &at
	case models.TransferShipped:
		t.ShippedByUserID, t.ShippedAt = actorID, &at
	case models.TransferArrived:
		t.ArrivedByUserID, t.ArrivedAt = actorID, &at
	case models.TransferAccepted:
		t.AcceptedByUserID, t.AcceptedAt = actorID, &at
	case models.TransferCancel:
		t.CancelledByUserID, t.CancelledAt = actorID, &at
	case models.TransferLost:
		t.LostByUserID, t.LostAt = actorID, &at
	}
}

func appendTransferLog(
	tx *gorm.DB,
	transferID uint64,
	from, to models.TransferStatus,
	actorID uint64,
	description string,
) error {
	err := tx.Create(&models.WarehouseTransferLog{
		TransferID:  transferID,
		FromStatus:  from,
		ToStatus:    to,
		ActorUserID: actorID,
		Description: description,
	}).Error
	if err != nil {
		return fmt.Errorf("transfer %d trail: %w", transferID, err)
	}

	return nil
}

// transferLegDescription names the transfer on its ledger transactions, so a history row reads back to it.
func transferLegDescription(transferID uint64) string {
	return fmt.Sprintf("warehouse transfer #%d", transferID)
}

// ── reading back for the wire ───────────────────────────────────────────────────────────────────────────────────────

// legRacks is one transfer leg's rack rows: per product, the racks and units. A pick is a unit leaving A's rack, a
// put-away one arriving on B's — read back from the ledger, never stored twice.
type legRacks map[uint64][]*inventoryv1.WarehouseTransferPlacement

// loadLegRacks reads the rack rows of the given legs in ONE query: the out-leg's takes (negative) and the in-leg's puts
// (positive). A rolled-back out-leg's reversals are positive, so they never read as picks; only an in-leg's puts are read.
func loadLegRacks(db *gorm.DB, transfers []models.WarehouseTransfer) (picks, putaway map[uint64]legRacks, err error) {
	ids := make([]uint64, 0, 2*len(transfers))
	for _, t := range transfers {
		if t.OutboundTransactionID != nil {
			ids = append(ids, *t.OutboundTransactionID)
		}

		if t.InboundTransactionID != nil {
			ids = append(ids, *t.InboundTransactionID)
		}
	}

	picks = map[uint64]legRacks{}
	putaway = map[uint64]legRacks{}

	if len(ids) == 0 {
		return picks, putaway, nil
	}

	var rows []models.ProductPlacementLog

	err = db.
		Select("transaction_id", "product_id", "placement_id", "stock_change").
		Where("transaction_id IN ?", ids).
		Order("id").
		Find(&rows).Error
	if err != nil {
		return nil, nil, fmt.Errorf("read the legs' rack rows: %w", err)
	}

	for _, r := range rows {
		switch {
		case r.StockChange < 0:
			if picks[r.TransactionID] == nil {
				picks[r.TransactionID] = legRacks{}
			}

			picks[r.TransactionID][r.ProductID] = append(picks[r.TransactionID][r.ProductID],
				&inventoryv1.WarehouseTransferPlacement{PlacementId: r.PlacementID, Quantity: -r.StockChange})
		case r.StockChange > 0:
			if putaway[r.TransactionID] == nil {
				putaway[r.TransactionID] = legRacks{}
			}

			putaway[r.TransactionID][r.ProductID] = append(putaway[r.TransactionID][r.ProductID],
				&inventoryv1.WarehouseTransferPlacement{PlacementId: r.PlacementID, Quantity: r.StockChange})
		}
	}

	return picks, putaway, nil
}

// transferForWire reloads one transfer with its lines, problems, trail and both legs' racks — what every write answers.
func transferForWire(db *gorm.DB, transferID uint64) (*inventoryv1.WarehouseTransfer, error) {
	var t models.WarehouseTransfer

	err := db.
		Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		Preload("Problems", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		Preload("Logs", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		First(&t, transferID).Error
	if err != nil {
		return nil, err
	}

	picks, putaway, err := loadLegRacks(db, []models.WarehouseTransfer{t})
	if err != nil {
		return nil, err
	}

	return transferToProto(&t, picks, putaway, true), nil
}

func transferToProto(
	t *models.WarehouseTransfer,
	picks, putaway map[uint64]legRacks,
	withLogs bool,
) *inventoryv1.WarehouseTransfer {
	out := &inventoryv1.WarehouseTransfer{
		Id:                          t.ID,
		TeamId:                      t.TeamID,
		FromWarehouseId:             t.FromWarehouseID,
		ToWarehouseId:               t.ToWarehouseID,
		Status:                      transferStatusToProto(t.Status),
		Note:                        t.Note,
		Total:                       t.Total,
		ShipmentId:                  t.ShipmentID,
		Receipt:                     t.Receipt,
		ReceiptFile:                 t.ReceiptFile,
		ShipmentCost:                t.ShipmentCost,
		FinanceAccountId:            t.FinanceAccountID,
		WarehouseAdditionalCost:     t.WarehouseAdditionalCost,
		WarehouseAdditionalCostNote: t.WarehouseAdditionalCostNote,
		CreatedByUserId:             t.CreatedByUserID,
		CreatedAtUnix:               t.CreatedAt.Unix(),
		ProcessedByUserId:           t.ProcessedByUserID,
		ProcessedAtUnix:             unixOrZero(t.ProcessedAt),
		ShippedByUserId:             t.ShippedByUserID,
		ShippedAtUnix:               unixOrZero(t.ShippedAt),
		ArrivedByUserId:             t.ArrivedByUserID,
		ArrivedAtUnix:               unixOrZero(t.ArrivedAt),
		AcceptedByUserId:            t.AcceptedByUserID,
		AcceptedAtUnix:              unixOrZero(t.AcceptedAt),
		CancelledByUserId:           t.CancelledByUserID,
		CancelledAtUnix:             unixOrZero(t.CancelledAt),
		LostByUserId:                t.LostByUserID,
		LostAtUnix:                  unixOrZero(t.LostAt),
	}

	var outPicks, inPuts legRacks

	if t.OutboundTransactionID != nil {
		out.OutboundTransactionId = *t.OutboundTransactionID
		outPicks = picks[*t.OutboundTransactionID]
	}

	if t.InboundTransactionID != nil {
		out.InboundTransactionId = *t.InboundTransactionID
		inPuts = putaway[*t.InboundTransactionID]
	}

	problems := map[uint64][]*inventoryv1.WarehouseTransferProblem{}
	for _, p := range t.Problems {
		problems[p.ProductID] = append(problems[p.ProductID], &inventoryv1.WarehouseTransferProblem{
			Type:      transferProblemToProto(p.ProblemType),
			Count:     p.Count,
			PriceUnit: p.PriceUnit,
			Total:     p.Total,
			Note:      p.Note,
		})
	}

	for _, item := range t.Items {
		out.Items = append(out.Items, &inventoryv1.WarehouseTransferItem{
			Id:           item.ID,
			ProductId:    item.ProductID,
			Sku:          item.SKU,
			Name:         item.Name,
			Count:        item.Count,
			Total:        item.Total,
			PriceUnit:    item.PriceUnit,
			Picks:        outPicks[item.ProductID],
			ArrivedCount: item.ArrivedCount,
			Placements:   inPuts[item.ProductID],
			Problems:     problems[item.ProductID],
		})
	}

	if withLogs {
		for _, l := range t.Logs {
			out.Logs = append(out.Logs, &inventoryv1.WarehouseTransferLog{
				Id:          l.ID,
				FromStatus:  transferStatusToProto(l.FromStatus),
				ToStatus:    transferStatusToProto(l.ToStatus),
				ActorUserId: l.ActorUserID,
				Description: l.Description,
				AtUnix:      l.CreatedAt.Unix(),
			})
		}
	}

	return out
}

func unixOrZero(at *time.Time) int64 {
	if at == nil {
		return 0
	}

	return at.Unix()
}

var transferStatuses = map[models.TransferStatus]inventoryv1.WarehouseTransferStatus{
	models.TransferCreated:  inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_CREATED,
	models.TransferProcess:  inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_PROCESS,
	models.TransferShipped:  inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_SHIPPED,
	models.TransferArrived:  inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_ARRIVED,
	models.TransferAccepted: inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_ACCEPTED,
	models.TransferCancel:   inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_CANCELLED,
	models.TransferLost:     inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_LOST,
}

// transferStatusToProto maps a stored status to the wire; the empty status of a first trail row's from is UNSPECIFIED.
func transferStatusToProto(s models.TransferStatus) inventoryv1.WarehouseTransferStatus {
	return transferStatuses[s]
}

// transferStatusFromProto maps a filter's status to the stored word; UNSPECIFIED is "".
func transferStatusFromProto(s inventoryv1.WarehouseTransferStatus) models.TransferStatus {
	for stored, wire := range transferStatuses {
		if wire == s {
			return stored
		}
	}

	return ""
}

func transferProblemToProto(p models.TransferProblemType) inventoryv1.WarehouseTransferProblemType {
	switch p {
	case models.TransferProblemBroken:
		return inventoryv1.WarehouseTransferProblemType_WAREHOUSE_TRANSFER_PROBLEM_TYPE_BROKEN
	case models.TransferProblemMissing:
		return inventoryv1.WarehouseTransferProblemType_WAREHOUSE_TRANSFER_PROBLEM_TYPE_MISSING
	default:
		return inventoryv1.WarehouseTransferProblemType_WAREHOUSE_TRANSFER_PROBLEM_TYPE_UNSPECIFIED
	}
}

// transition is a status change with no ledger work — Process, Ship, Arrive, MarkLost: lock the transfer as the side
// named, check its status, write the new one with any extra columns and its trail row, and answer the transfer as
// stored.
func (s *Service) transition(
	ctx context.Context,
	transferID, teamID uint64,
	side transferSide,
	action string,
	from []models.TransferStatus,
	to models.TransferStatus,
	description string,
	extra map[string]any,
) (*inventoryv1.WarehouseTransfer, error) {
	actor := actorFrom(ctx)

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		t, lockErr := lockTransfer(tx, transferID, teamID, side)
		if lockErr != nil {
			return lockErr
		}

		statusErr := requireStatus(t, action, from...)
		if statusErr != nil {
			return statusErr
		}

		return moveTransfer(tx, t, to, actor, description, extra)
	})
	if err != nil {
		return nil, transferErr(err)
	}

	wire, err := transferForWire(s.db.WithContext(ctx), transferID)
	if err != nil {
		return nil, transferErr(err)
	}

	return wire, nil
}
