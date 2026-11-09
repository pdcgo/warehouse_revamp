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
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// FOUND STOCK WAITING FOR APPROVAL (an-adjust-found-waits-for-the-owner-or-admin) — what the four FoundRequestService
// handlers share: the refusals, the lookup, the mapping with what approving would post (or posted), and the settle a
// count's finalize runs (a-count-settles-the-found-it-counted).

var (
	errFoundMissing        = errors.New("found request not found")
	errFoundArgs           = errors.New("a found names a product, a rack and a positive quantity")
	errFoundStaffOwnOnly   = errors.New("staff withdraw only the founds they reported — the warehouse Owner or Admin rejects the rest")
	errFoundNoPerson       = errors.New("a found request is reported and decided by a person")
	errFoundNotWaiting     = errors.New("the found request is no longer waiting — it was approved, rejected or settled by a count")
	errFoundOwnReport      = errors.New("you reported this found — another Owner or Admin approves it")
	errFoundReasonMissing  = errors.New("a rejection says why — the reporter reads it")
	errFoundProductMissing = errors.New("product not found")
	errFoundRackGone       = errors.New("the rack was deleted — reject the request")
	// The approval's backstop: the report refuses a product never stocked here, so this means the batches changed under
	// the request — nothing posts (a-found-never-stocked-here-is-refused-at-the-report).
	errFoundNoPrice = errors.New("nothing to claim and the team never had a batch of this product here — it cannot post")
)

// neverStockedHereError refuses a found of a product its owner team never had a batch of in this warehouse: there is no
// price to mint it at, so it comes in by the team's restock (a-found-never-stocked-here-is-refused-at-the-report).
type neverStockedHereError struct {
	product string
	teamID  uint64
}

func (e *neverStockedHereError) Error() string {
	return fmt.Sprintf("%s was never stocked here for team #%d — bring it in by restock", e.product, e.teamID)
}

// foundErr maps a found request's refusal to Connect.
func foundErr(err error) error {
	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		return connectErr
	}

	if refused := countedRefusal(err); refused != nil {
		return refused
	}

	var never *neverStockedHereError
	if errors.As(err, &never) {
		return connect.NewError(connect.CodeFailedPrecondition, never)
	}

	switch {
	case errors.Is(err, errFoundMissing), errors.Is(err, gorm.ErrRecordNotFound):
		return connect.NewError(connect.CodeNotFound, errFoundMissing)
	case errors.Is(err, errRackMissing), errors.Is(err, errFoundProductMissing):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, errFoundReasonMissing):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, errFoundNoPerson), errors.Is(err, errFoundStaffOwnOnly):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, errFoundArgs):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, errFoundNotWaiting),
		errors.Is(err, errFoundOwnReport),
		errors.Is(err, errFoundRackGone),
		errors.Is(err, errFoundNoPrice),
		errors.Is(err, inventory_mutations.ErrNeverStockedHere):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}

// foundRequestOf reads a request of THIS warehouse; another warehouse's reads as not found. strength "" reads it
// plainly, "UPDATE" locks it — the first lock an approval or a rejection takes.
func foundRequestOf(db *gorm.DB, warehouseID, id uint64, strength string) (models.FoundRequest, error) {
	var row models.FoundRequest

	query := db
	if strength != "" {
		query = query.Clauses(clause.Locking{Strength: strength})
	}

	err := query.Where("id = ? AND warehouse_id = ?", id, warehouseID).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return row, errFoundMissing
	}

	return row, err
}

// isFoundStaff is whether the caller reads and decides found stock as STAFF — warehouse staff, who report founds
// (staff-may-report-a-found) and may only see and withdraw their own (the-reporter-may-withdraw-their-found). The
// Owner, the Admin, Root and the Administrator (an override reads as no role in the team) and a monitor are not.
func isFoundStaff(ctx context.Context) bool {
	return san_auth.GetCallerRole(ctx) == role_basev1.Role_ROLE_WAREHOUSE_STAFF
}

// foundNote is what an approval's transaction says it was.
func foundNote(id uint64) string {
	return fmt.Sprintf("found request #%d", id)
}

func foundStatusProto(s models.FoundRequestStatus) inventoryv1.FoundRequestStatus {
	switch s {
	case models.FoundWaiting:
		return inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_WAITING
	case models.FoundApproved:
		return inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_APPROVED
	case models.FoundRejected:
		return inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_REJECTED
	case models.FoundSettled:
		return inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_SETTLED_BY_COUNT
	default:
		return inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_UNSPECIFIED
	}
}

// foundStatusOf is a list filter's status; "" for UNSPECIFIED — every status.
func foundStatusOf(s inventoryv1.FoundRequestStatus) models.FoundRequestStatus {
	switch s {
	case inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_WAITING:
		return models.FoundWaiting
	case inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_APPROVED:
		return models.FoundApproved
	case inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_REJECTED:
		return models.FoundRejected
	case inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_SETTLED_BY_COUNT:
		return models.FoundSettled
	default:
		return ""
	}
}

func foundPostTypeProto(t inventory_mutations.SettleType) inventoryv1.FoundRequestPostType {
	switch t {
	case inventory_mutations.SettleClaim:
		return inventoryv1.FoundRequestPostType_FOUND_REQUEST_POST_TYPE_CLAIM
	case inventory_mutations.SettleMint:
		return inventoryv1.FoundRequestPostType_FOUND_REQUEST_POST_TYPE_MINT
	default:
		return inventoryv1.FoundRequestPostType_FOUND_REQUEST_POST_TYPE_UNSPECIFIED
	}
}

// foundApproveBlock is why THIS caller may not approve the request now: decided already, their own report (checked
// against the person, never the role — nobody-finalizes-their-own-count), or a count holding the product on its rack.
func foundApproveBlock(r models.FoundRequest, actor uint64, lock *inventory_ledgers.CountLock) inventoryv1.FoundRequestApproveBlock {
	switch {
	case r.Status != models.FoundWaiting:
		return inventoryv1.FoundRequestApproveBlock_FOUND_REQUEST_APPROVE_BLOCK_NOT_WAITING
	case r.ReportedByID == actor:
		return inventoryv1.FoundRequestApproveBlock_FOUND_REQUEST_APPROVE_BLOCK_OWN_REPORT
	case lock != nil:
		return inventoryv1.FoundRequestApproveBlock_FOUND_REQUEST_APPROVE_BLOCK_BEING_COUNTED
	default:
		return inventoryv1.FoundRequestApproveBlock_FOUND_REQUEST_APPROVE_BLOCK_UNSPECIFIED
	}
}

// foundRequestsProto maps requests of ONE warehouse for this caller, keyed by id — in a fixed number of statements
// whatever their number: the racks' codes; for the WAITING ones, what approving would post now (one plain read of the
// register and the prices, inventory_mutations.PreviewFound) and the count locks over them; for the APPROVED ones, what
// they posted — their claims and their minted batch.
func foundRequestsProto(db *gorm.DB, actor uint64, rows []models.FoundRequest) (map[uint64]*inventoryv1.FoundRequest, error) {
	out := make(map[uint64]*inventoryv1.FoundRequest, len(rows))
	if len(rows) == 0 {
		return out, nil
	}

	warehouseID := rows[0].WarehouseID

	placements := make([]uint64, 0, len(rows))
	for _, r := range rows {
		placements = append(placements, r.PlacementID)
	}

	codes, err := placementCodesOf(db, placements)
	if err != nil {
		return nil, err
	}

	var (
		waiting   []int
		units     []inventory_mutations.FoundUnits
		keys      []inventory_ledgers.RackKey
		txIDs     []uint64
		mintedIDs []uint64
	)

	for i, r := range rows {
		switch r.Status {
		case models.FoundWaiting:
			waiting = append(waiting, i)
			units = append(units, inventory_mutations.FoundUnits{
				WarehouseID: r.WarehouseID, TeamID: r.TeamID, ProductID: r.ProductID, PlacementID: r.PlacementID,
				PlacementCode: codes[r.PlacementID], Count: r.StockCount,
			})
			keys = append(keys, inventory_ledgers.RackKey{ProductID: r.ProductID, PlacementID: r.PlacementID})
		case models.FoundApproved:
			if r.TransactionID != nil {
				txIDs = append(txIDs, *r.TransactionID)
			}

			if r.MintedBatchID != nil {
				mintedIDs = append(mintedIDs, *r.MintedBatchID)
			}
		}
	}

	previews, err := inventory_mutations.PreviewFound(db, warehouseID, units)
	if err != nil {
		return nil, err
	}

	locks, err := inventory_ledgers.CountLocks(db, keys)
	if err != nil {
		return nil, err
	}

	claims, minted, err := foundPostedLines(db, txIDs, mintedIDs)
	if err != nil {
		return nil, err
	}

	lines := make(map[int][]*inventoryv1.FoundRequestPostLine, len(rows))

	for j, i := range waiting {
		for _, l := range previews[j].Lines {
			line := &inventoryv1.FoundRequestPostLine{
				Type: foundPostTypeProto(l.Type), BatchId: l.BatchID, StockCount: l.Count, PriceUnit: l.PriceUnit,
				Amount: l.Amount, ProblemId: l.ProblemID,
			}

			if l.ProblemID != 0 {
				line.ProblemCreatedAtUnix = l.ProblemCreatedAt.Unix()
			}

			lines[i] = append(lines[i], line)
		}
	}

	for i, r := range rows {
		if r.Status != models.FoundApproved {
			continue
		}

		if r.TransactionID != nil {
			lines[i] = append(lines[i], claims[*r.TransactionID]...)
		}

		if r.MintedBatchID != nil {
			if m := minted[*r.MintedBatchID]; m != nil {
				lines[i] = append(lines[i], m)
			}
		}
	}

	for i, r := range rows {
		p := foundRequestProto(r, codes[r.PlacementID])
		p.Lines = lines[i]

		for _, l := range p.GetLines() {
			switch l.GetType() {
			case inventoryv1.FoundRequestPostType_FOUND_REQUEST_POST_TYPE_CLAIM:
				p.ClaimedAmount += l.GetAmount()
			case inventoryv1.FoundRequestPostType_FOUND_REQUEST_POST_TYPE_MINT:
				p.MintedAmount += l.GetAmount()
			}
		}

		var lock *inventory_ledgers.CountLock
		if held, ok := locks[inventory_ledgers.RackKey{ProductID: r.ProductID, PlacementID: r.PlacementID}]; ok && r.Status == models.FoundWaiting {
			lock = &held
		}

		p.Block = foundApproveBlock(r, actor, lock)
		if p.GetBlock() == inventoryv1.FoundRequestApproveBlock_FOUND_REQUEST_APPROVE_BLOCK_BEING_COUNTED {
			p.CountingSessionId = lock.SessionID
		}

		out[r.ID] = p
	}

	return out, nil
}

// foundPostedLines reads what approved requests posted: each transaction's claims, oldest loss first, and each minted
// batch as its mint line — two statements.
func foundPostedLines(
	db *gorm.DB,
	txIDs, mintedIDs []uint64,
) (map[uint64][]*inventoryv1.FoundRequestPostLine, map[uint64]*inventoryv1.FoundRequestPostLine, error) {
	claims := map[uint64][]*inventoryv1.FoundRequestPostLine{}
	minted := map[uint64]*inventoryv1.FoundRequestPostLine{}

	if len(txIDs) > 0 {
		var rows []struct {
			TransactionID     uint64
			ProblemID         uint64
			ClaimedStockCount int64
			BatchID           uint64
			PriceUnit         float64
			CreatedAt         time.Time
		}

		err := db.Raw(`
			SELECT c.transaction_id, c.problem_id, c.claimed_stock_count, p.batch_id, p.price_unit, p.created_at
			FROM problem_claimed_transactions c
			JOIN warehouse_stock_problems p ON p.id = c.problem_id
			WHERE c.transaction_id IN ?
			ORDER BY c.transaction_id, p.created_at, p.id`, txIDs).Scan(&rows).Error
		if err != nil {
			return nil, nil, fmt.Errorf("claims of %d found transaction(s): %w", len(txIDs), err)
		}

		for _, r := range rows {
			claims[r.TransactionID] = append(claims[r.TransactionID], &inventoryv1.FoundRequestPostLine{
				Type:                 inventoryv1.FoundRequestPostType_FOUND_REQUEST_POST_TYPE_CLAIM,
				BatchId:              r.BatchID,
				StockCount:           r.ClaimedStockCount,
				PriceUnit:            r.PriceUnit,
				Amount:               float64(r.ClaimedStockCount) * r.PriceUnit,
				ProblemId:            r.ProblemID,
				ProblemCreatedAtUnix: r.CreatedAt.Unix(),
			})
		}
	}

	if len(mintedIDs) > 0 {
		var batches []models.Batch

		err := db.Select("id, price_unit, init_stock_count, init_stock_valuation").Where("id IN ?", mintedIDs).Find(&batches).Error
		if err != nil {
			return nil, nil, fmt.Errorf("minted batches: %w", err)
		}

		for _, b := range batches {
			minted[b.ID] = &inventoryv1.FoundRequestPostLine{
				Type:       inventoryv1.FoundRequestPostType_FOUND_REQUEST_POST_TYPE_MINT,
				BatchId:    b.ID,
				StockCount: b.InitStockCount,
				PriceUnit:  b.PriceUnit,
				Amount:     b.InitStockValuation,
			}
		}
	}

	return claims, minted, nil
}

// foundRequestProto maps a request's own columns; lines, amounts and block are the caller's.
func foundRequestProto(r models.FoundRequest, rackCode string) *inventoryv1.FoundRequest {
	p := &inventoryv1.FoundRequest{
		Id:             r.ID,
		WarehouseId:    r.WarehouseID,
		TeamId:         r.TeamID,
		ProductId:      r.ProductID,
		ProductCode:    r.ProductCode,
		ProductName:    r.ProductName,
		RackId:         r.PlacementID,
		RackCode:       rackCode,
		StockCount:     r.StockCount,
		Note:           r.Note,
		ReportedById:   r.ReportedByID,
		ReportedAtUnix: r.ReportedAt.Unix(),
		Status:         foundStatusProto(r.Status),
		RejectReason:   r.RejectReason,
	}

	if r.DecidedByID != nil {
		p.DecidedById = *r.DecidedByID
	}

	if r.DecidedAt != nil {
		p.DecidedAtUnix = r.DecidedAt.Unix()
	}

	if r.TransactionID != nil {
		p.TransactionId = *r.TransactionID
	}

	if r.SettledByCountingSessionID != nil {
		p.SettledByCountingSessionId = *r.SettledByCountingSessionID
	}

	return p
}

// settleFoundByCount closes, inside a count's finalize, every WAITING found request whose product and rack the session
// held a row for: the count counted those units on the shelf and posts them itself, so the request posts nothing and
// names the count (a-count-settles-the-found-it-counted). The rows are locked FOR UPDATE in id order — after the session
// and before the register, the batches and the racks, the order an approval takes them (request first) — and a request
// an approval finished first is no longer waiting when the lock is granted, so it is left alone.
func settleFoundByCount(tx *gorm.DB, warehouseID, sessionID, actor uint64, at time.Time) (int64, error) {
	var ids []uint64

	err := tx.Model(&models.FoundRequest{}).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("warehouse_id = ? AND status = ?", warehouseID, models.FoundWaiting).
		Where(`EXISTS (SELECT 1 FROM opname_session_snapshots s
			WHERE s.opname_session_id = ? AND s.product_id = found_requests.product_id
			  AND s.placement_id = found_requests.placement_id)`, sessionID).
		Order("id").
		Pluck("id", &ids).Error
	if err != nil {
		return 0, fmt.Errorf("lock the found requests count #%d settles: %w", sessionID, err)
	}

	if len(ids) == 0 {
		return 0, nil
	}

	res := tx.Model(&models.FoundRequest{}).
		Where("id IN ?", ids).
		Updates(map[string]any{
			"status":                         models.FoundSettled,
			"decided_by_id":                  actor,
			"decided_at":                     at,
			"settled_by_counting_session_id": sessionID,
		})
	if res.Error != nil {
		return 0, fmt.Errorf("settle %d found request(s) by count #%d: %w", len(ids), sessionID, res.Error)
	}

	return res.RowsAffected, nil
}
