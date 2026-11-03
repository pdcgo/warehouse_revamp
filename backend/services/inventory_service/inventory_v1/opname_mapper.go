package inventory_v1

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE STOCK COUNT (OpnameService — docs/business/inventory/opname.md, accepted 2026-11-02). What every opname_*.go file
// shares: the errors, the session and row lookups with their locks, and the mapping to the contract.
//
// LOCK ORDER, everywhere in the count: the session row first (FOR SHARE to work one row of it, FOR UPDATE to finalize or
// cancel it), then a snapshot row, then — finalize only — the register's open losses, the batches, the racks. A row write
// and a finalize therefore queue on the session, and two people on one row queue on the row.

var (
	errOpnameSessionMissing = errors.New("opname session not found")
	errOpnameRowMissing     = errors.New("opname row not found")
	errOpnameNotActive      = errors.New("the count is not active")
	errOpnameActiveExists   = errors.New("another count of this warehouse is active")
	errOpnameNothingToCount = errors.New("the plan selects no shelf row — nothing to count")
	errOpnamePlanTarget     = errors.New("a plan names exactly its own target: a team, a product or a rack — and `all` none")
	errOpnameRowCounted     = errors.New("the row is counted — the admin sends it back to count it again")
	errOpnameRecountUsed    = errors.New("the one recount is used")
	errOpnameNotRevealed    = errors.New("count the row first")
	errOpnameNotCounted     = errors.New("only a counted row is sent back")
	errOpnameReasonMissing  = errors.New("every draft needs its reason")
	errOpnameRackNotHere    = errors.New("the rack is not in this count")
	errOpnameRowExists      = errors.New("the product already has a row on this rack")
	errOpnameNeverHere      = errors.New("its team never had this product in this warehouse — take it off the rack; the team restocks it")
	errOpnameNoPerson       = errors.New("a finalize needs a person")
	errOpnameRowsLeft       = errors.New("rows of the count are not counted yet")
	errOpnameOwnCount       = errors.New("you counted rows of this count — another Owner or Admin finalizes it")
)

// opnameErr maps a count's refusal to Connect.
func opnameErr(err error) error {
	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		return connectErr
	}

	if refused := countedRefusal(err); refused != nil {
		return refused
	}

	var short *inventory_ledgers.NotEnoughStockError

	switch {
	case errors.Is(err, errOpnameSessionMissing), errors.Is(err, gorm.ErrRecordNotFound):
		return connect.NewError(connect.CodeNotFound, errOpnameSessionMissing)
	case errors.Is(err, errOpnameRowMissing), errors.Is(err, errOpnameRackNotHere), errors.Is(err, errRackMissing):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, errOpnameRowExists):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, errOpnamePlanTarget), errors.Is(err, errOpnameReasonMissing):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, errOpnameNoPerson):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, errOpnameNotActive),
		errors.Is(err, errOpnameActiveExists),
		errors.Is(err, errOpnameNothingToCount),
		errors.Is(err, errOpnameRowCounted),
		errors.Is(err, errOpnameRecountUsed),
		errors.Is(err, errOpnameNotRevealed),
		errors.Is(err, errOpnameNotCounted),
		errors.Is(err, errOpnameNeverHere),
		errors.Is(err, errOpnameRowsLeft),
		errors.Is(err, errOpnameOwnCount),
		errors.Is(err, inventory_mutations.ErrCountTakesMoreThanHeld),
		errors.Is(err, inventory_mutations.ErrNeverStockedHere):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.As(err, &short):
		return connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("product %d: %d wanted, %d held", short.ProductID, short.Wanted, short.Available))
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}

// isCounterRead is whether the caller reads as a COUNTER — warehouse staff, who must not see a book figure before they
// count (a-count-is-blind-then-revealed). The Owner, the Admin, Root and a monitor read the admin's figures.
func isCounterRead(ctx context.Context) bool {
	return san_auth.GetCallerRole(ctx) == role_basev1.Role_ROLE_WAREHOUSE_STAFF
}

// ── Lookups ─────────────────────────────────────────────────────────────────────────────────────────────────────────

// opnameSessionOf reads a session of THIS warehouse; another warehouse's reads as not found, never as forbidden.
// strength "" reads it plainly, "SHARE" or "UPDATE" locks it.
func opnameSessionOf(db *gorm.DB, warehouseID, sessionID uint64, strength string) (models.OpnameSession, error) {
	var session models.OpnameSession

	query := db
	if strength != "" {
		query = query.Clauses(clause.Locking{Strength: strength})
	}

	err := query.Where("id = ? AND warehouse_id = ?", sessionID, warehouseID).Take(&session).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return session, errOpnameSessionMissing
	}

	return session, err
}

// lockOpnameRow takes the row's session FOR SHARE and must find it active, then locks the row itself — the order every
// row write keeps, so a finalize (FOR UPDATE on the session) and a row write never pass each other.
func lockOpnameRow(tx *gorm.DB, warehouseID, rowID uint64) (models.OpnameSession, models.OpnameSessionSnapshot, error) {
	var row models.OpnameSessionSnapshot

	err := tx.Where("id = ? AND warehouse_id = ?", rowID, warehouseID).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return models.OpnameSession{}, row, errOpnameRowMissing
	}

	if err != nil {
		return models.OpnameSession{}, row, err
	}

	session, err := opnameSessionOf(tx, warehouseID, row.OpnameSessionID, "SHARE")
	if err != nil {
		return session, row, err
	}

	if session.Status != models.OpnameActive {
		return session, row, errOpnameNotActive
	}

	err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", rowID).Take(&row).Error
	if err != nil {
		return session, row, err
	}

	return session, row, nil
}

// ── Progress ────────────────────────────────────────────────────────────────────────────────────────────────────────

type opnameProgress struct {
	SessionID          uint64
	RowCount           int64
	CountedRowCount    int64
	DifferenceRowCount int64
	RackCount          int64
	ProductCount       int64
}

// opnameProgressOf reads every session's progress in two statements whatever their number: one grouped read of their
// rows, and one of the racks an `all` session visits — every rack of the warehouse, and any rack a row of it sits on
// since deleted (an-all-count-visits-every-rack).
func opnameProgressOf(db *gorm.DB, sessions []models.OpnameSession) (map[uint64]opnameProgress, error) {
	out := make(map[uint64]opnameProgress, len(sessions))
	if len(sessions) == 0 {
		return out, nil
	}

	ids := make([]uint64, 0, len(sessions))
	var allIDs []uint64

	for _, s := range sessions {
		ids = append(ids, s.ID)
		if s.Plan == models.OpnamePlanAll {
			allIDs = append(allIDs, s.ID)
		}
	}

	var rows []opnameProgress

	err := db.Raw(`
		SELECT opname_session_id AS session_id,
		       COUNT(*) AS row_count,
		       COUNT(*) FILTER (WHERE status = 'counted') AS counted_row_count,
		       COUNT(*) FILTER (WHERE status = 'counted' AND recounted_stock_count <> system_stock_count) AS difference_row_count,
		       COUNT(DISTINCT placement_id) AS rack_count,
		       COUNT(DISTINCT product_id) AS product_count
		FROM opname_session_snapshots
		WHERE opname_session_id IN ?
		GROUP BY opname_session_id`, ids).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("count progress: %w", err)
	}

	for _, r := range rows {
		out[r.SessionID] = r
	}

	if len(allIDs) == 0 {
		return out, nil
	}

	// An `all` count visits every live rack of its warehouse — counted once per warehouse, not joined per session — and
	// any rack one of its rows sits on that has since been deleted.
	live := map[uint64]int64{}

	for _, s := range sessions {
		if s.Plan != models.OpnamePlanAll {
			continue
		}

		if _, seen := live[s.WarehouseID]; seen {
			continue
		}

		var n int64

		err = db.Model(&models.Rack{}).Where("warehouse_id = ? AND deleted_at IS NULL", s.WarehouseID).Count(&n).Error
		if err != nil {
			return nil, fmt.Errorf("racks of an all count: %w", err)
		}

		live[s.WarehouseID] = n
	}

	var deleted []struct {
		SessionID uint64
		RackCount int64
	}

	err = db.Raw(`
		SELECT r.opname_session_id AS session_id, COUNT(DISTINCT r.placement_id) AS rack_count
		FROM opname_session_snapshots r
		JOIN placements p ON p.id = r.placement_id AND p.deleted_at IS NOT NULL
		WHERE r.opname_session_id IN ?
		GROUP BY r.opname_session_id`, allIDs).Scan(&deleted).Error
	if err != nil {
		return nil, fmt.Errorf("deleted racks of an all count: %w", err)
	}

	gone := map[uint64]int64{}
	for _, d := range deleted {
		gone[d.SessionID] = d.RackCount
	}

	for _, s := range sessions {
		if s.Plan != models.OpnamePlanAll {
			continue
		}

		p := out[s.ID]
		p.SessionID = s.ID
		p.RackCount = live[s.WarehouseID] + gone[s.ID]
		out[s.ID] = p
	}

	return out, nil
}

// ── The contract ────────────────────────────────────────────────────────────────────────────────────────────────────

func opnameStatusProto(s models.OpnameStatus) inventoryv1.OpnameSessionStatus {
	switch s {
	case models.OpnameActive:
		return inventoryv1.OpnameSessionStatus_OPNAME_SESSION_STATUS_ACTIVE
	case models.OpnameFinish:
		return inventoryv1.OpnameSessionStatus_OPNAME_SESSION_STATUS_FINISH
	case models.OpnameCancel:
		return inventoryv1.OpnameSessionStatus_OPNAME_SESSION_STATUS_CANCEL
	default:
		return inventoryv1.OpnameSessionStatus_OPNAME_SESSION_STATUS_UNSPECIFIED
	}
}

func opnameStatusOf(s inventoryv1.OpnameSessionStatus) models.OpnameStatus {
	switch s {
	case inventoryv1.OpnameSessionStatus_OPNAME_SESSION_STATUS_ACTIVE:
		return models.OpnameActive
	case inventoryv1.OpnameSessionStatus_OPNAME_SESSION_STATUS_FINISH:
		return models.OpnameFinish
	case inventoryv1.OpnameSessionStatus_OPNAME_SESSION_STATUS_CANCEL:
		return models.OpnameCancel
	default:
		return ""
	}
}

func opnamePlanProto(p models.OpnamePlan) inventoryv1.OpnamePlan {
	switch p {
	case models.OpnamePlanAll:
		return inventoryv1.OpnamePlan_OPNAME_PLAN_ALL
	case models.OpnamePlanTeam:
		return inventoryv1.OpnamePlan_OPNAME_PLAN_TEAM
	case models.OpnamePlanProduct:
		return inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT
	case models.OpnamePlanPlacement:
		return inventoryv1.OpnamePlan_OPNAME_PLAN_PLACEMENT
	default:
		return inventoryv1.OpnamePlan_OPNAME_PLAN_UNSPECIFIED
	}
}

func opnamePlanOf(p inventoryv1.OpnamePlan) models.OpnamePlan {
	switch p {
	case inventoryv1.OpnamePlan_OPNAME_PLAN_ALL:
		return models.OpnamePlanAll
	case inventoryv1.OpnamePlan_OPNAME_PLAN_TEAM:
		return models.OpnamePlanTeam
	case inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT:
		return models.OpnamePlanProduct
	case inventoryv1.OpnamePlan_OPNAME_PLAN_PLACEMENT:
		return models.OpnamePlanPlacement
	default:
		return ""
	}
}

// opnameSessionProto maps a session. `blind` is a counter's read: an unfinished session's difference count would leak
// the book, so it reads 0 (a-count-is-blind-then-revealed).
func opnameSessionProto(s models.OpnameSession, p opnameProgress, blind bool) *inventoryv1.OpnameSession {
	out := &inventoryv1.OpnameSession{
		Id:              s.ID,
		WarehouseId:     s.WarehouseID,
		Status:          opnameStatusProto(s.Status),
		Plan:            opnamePlanProto(s.Plan),
		CreatedById:     s.CreatedByID,
		CreatedAtUnix:   s.CreatedAt.Unix(),
		RowCount:        p.RowCount,
		CountedRowCount: p.CountedRowCount,
		RackCount:       p.RackCount,
		ProductCount:    p.ProductCount,
	}

	if !blind || s.Status != models.OpnameActive {
		out.DifferenceRowCount = p.DifferenceRowCount
	}

	if s.FinalizedByID != nil {
		out.FinalizedById = *s.FinalizedByID
	}

	if s.FinalizedAt != nil {
		out.FinalizedAtUnix = s.FinalizedAt.Unix()
	}

	return out
}

// opnameRowRef names one snapshot row by what its drafts carry.
type opnameRowRef struct {
	ProductID   uint64
	PlacementID uint64
}

// opnameDraftsOf reads the drafts of the given rows of one session — both tables in ONE statement — as the contract's
// drafts, broken · lost · surplus.
func opnameDraftsOf(db *gorm.DB, sessionID uint64, rows []models.OpnameSessionSnapshot) (map[opnameRowRef][]*inventoryv1.OpnameDraft, error) {
	out := map[opnameRowRef][]*inventoryv1.OpnameDraft{}
	if len(rows) == 0 {
		return out, nil
	}

	pairs := make([][]any, 0, len(rows))
	for _, r := range rows {
		pairs = append(pairs, []any{r.ProductID, r.PlacementID})
	}

	var drafts []struct {
		ProductID   uint64
		PlacementID uint64
		Kind        string
		StockCount  int64
		Note        string
	}

	err := db.Raw(`
		SELECT product_id, placement_id, problem_type AS kind, problem_stock_count AS stock_count, note
		FROM opname_problems_drafts WHERE opname_session_id = ? AND (product_id, placement_id) IN ?
		UNION ALL
		SELECT product_id, placement_id, 'surplus' AS kind, surplus_stock_count AS stock_count, note
		FROM opname_surplus_drafts WHERE opname_session_id = ? AND (product_id, placement_id) IN ?`,
		sessionID, pairs, sessionID, pairs).Scan(&drafts).Error
	if err != nil {
		return nil, fmt.Errorf("drafts: %w", err)
	}

	kindOf := map[string]inventoryv1.OpnameDraftType{
		string(models.ProblemBroken): inventoryv1.OpnameDraftType_OPNAME_DRAFT_TYPE_BROKEN,
		string(models.ProblemLost):   inventoryv1.OpnameDraftType_OPNAME_DRAFT_TYPE_LOST,
		"surplus":                    inventoryv1.OpnameDraftType_OPNAME_DRAFT_TYPE_SURPLUS,
	}

	sort.SliceStable(drafts, func(i, j int) bool { return kindOf[drafts[i].Kind] < kindOf[drafts[j].Kind] })

	for _, d := range drafts {
		ref := opnameRowRef{d.ProductID, d.PlacementID}
		out[ref] = append(out[ref], &inventoryv1.OpnameDraft{Type: kindOf[d.Kind], StockCount: d.StockCount, Note: d.Note})
	}

	return out, nil
}

// opnameRowProto maps a snapshot row. `blind` is a counter's read: the book figure reads 0 until the row is counted
// (a-count-is-blind-then-revealed).
func opnameRowProto(r models.OpnameSessionSnapshot, placementCode string, drafts []*inventoryv1.OpnameDraft, blind bool) *inventoryv1.OpnameRow {
	out := &inventoryv1.OpnameRow{
		Id:                  r.ID,
		SessionId:           r.OpnameSessionID,
		TeamId:              r.TeamID,
		ProductId:           r.ProductID,
		ProductCode:         r.ProductCode,
		ProductName:         r.ProductName,
		PlacementId:         r.PlacementID,
		PlacementCode:       placementCode,
		Status:              opnameRowStatusProto(r.Status),
		Revealed:            r.Revealed(),
		SystemStockCount:    r.SystemStockCount,
		RecountedStockCount: r.Count(),
		Recounted:           r.Recounted,
		FoundHere:           r.FoundHere,
		Drafts:              drafts,
	}

	if blind && !r.Revealed() {
		out.SystemStockCount = 0
	}

	if r.CountedByID != nil {
		out.CountedById = *r.CountedByID
	}

	return out
}

func opnameRowStatusProto(s models.OpnameRowStatus) inventoryv1.OpnameRowStatus {
	switch s {
	case models.OpnameRowCreated:
		return inventoryv1.OpnameRowStatus_OPNAME_ROW_STATUS_CREATED
	case models.OpnameRowCounted:
		return inventoryv1.OpnameRowStatus_OPNAME_ROW_STATUS_COUNTED
	default:
		return inventoryv1.OpnameRowStatus_OPNAME_ROW_STATUS_UNSPECIFIED
	}
}

// placementCodesOf is each rack's code, for the rows' labels — one statement.
func placementCodesOf(db *gorm.DB, ids []uint64) (map[uint64]string, error) {
	out := map[uint64]string{}
	if len(ids) == 0 {
		return out, nil
	}

	var racks []models.Rack

	err := db.Select("id, code").Where("id IN ?", ids).Find(&racks).Error
	if err != nil {
		return nil, fmt.Errorf("rack codes: %w", err)
	}

	for _, r := range racks {
		out[r.ID] = r.Code
	}

	return out, nil
}

// opnameRowsProto maps rows with their drafts and their racks' codes. codes may be nil: they are then read, in one
// statement — a caller that already holds them (a list that joined the racks, one rack's count) passes them.
func opnameRowsProto(
	db *gorm.DB,
	sessionID uint64,
	rows []models.OpnameSessionSnapshot,
	codes map[uint64]string,
	blind bool,
) ([]*inventoryv1.OpnameRow, error) {
	drafts, err := opnameDraftsOf(db, sessionID, rows)
	if err != nil {
		return nil, err
	}

	if codes == nil {
		ids := make([]uint64, 0, len(rows))
		for _, r := range rows {
			ids = append(ids, r.PlacementID)
		}

		codes, err = placementCodesOf(db, ids)
		if err != nil {
			return nil, err
		}
	}

	out := make([]*inventoryv1.OpnameRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, opnameRowProto(r, codes[r.PlacementID], drafts[opnameRowRef{r.ProductID, r.PlacementID}], blind))
	}

	return out, nil
}

// generalOf is a list's GENERAL slice: the id and a label.
func generalOf(ids []uint64, label func(uint64) string) *commonv1.GeneralMapItem {
	m := make(map[uint64]*commonv1.GeneralItem, len(ids))
	for _, id := range ids {
		m[id] = &commonv1.GeneralItem{Id: id, Name: label(id)}
	}

	return &commonv1.GeneralMapItem{MapData: m}
}
