package inventory_v1

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RESTOCK RESOLUTIONS (backlog #101 P1) — what RestockResolutionCreate, RestockRequestSettle, the outbound reship's
// `return` row and the inbound parcel's Terima share:
//
//   - a-restock-problem-is-settled-by-resolution-rows (+ every 🔄): a problem restock — Diterima carrying *Barang kurang*
//     / *Barang rusak* — or a lost one (Hilang) takes resolution rows, as many as it needs, no units on a row; a Hilang
//     restock takes no `return`; a settled restock still takes rows and stays settled; the seller's *Tandai Selesai* takes
//     the problem tags off; an inbound parcel's Terima with short or broken units REOPENS it (the matching tag back on,
//     the settled mark lifted);
//   - a-suppliers-reshipping-comes-in-as-a-custom-shipment (+ every 🔄): `restock_custom_shipments` joins the restock, the
//     row, the parcel and the stock-in its Terima makes.
//
// LOCK ORDER (audits/services/inventory_service/concurrency/lock-order.md): the RESTOCK row first, then any custom
// shipment row, then the stock ledgers — a resolution, a settle and an inbound Terima all queue on the restock row, so a
// settle and a Terima that reopens it are judged one after the other (the second reads what the first committed).

var (
	errResolutionNotAProblem = errors.New("only a received restock carrying a problem tag (Barang kurang / Barang rusak), " +
		"a settled one, or a lost one takes resolutions")
	errResolutionReturnOnLost  = errors.New("a lost restock takes no return — nothing arrived to send back")
	errResolutionShape         = errors.New("a refund names its amount and account; a return its outbound reship; a reshipping its inbound parcel — and nothing of the others")
	errResolutionKeyUsed       = errors.New("idempotency_key: already used by another resolution of this restock")
	errResolutionParcelMissing = errors.New("custom shipment not found — a return links an outbound reship of this restock")
	errResolutionParcelTaken   = errors.New("this reship is already a resolution of the restock")
	errResolutionParcelDead    = errors.New("a cancelled reship cannot be a return")
	errRestockAlreadySettled   = errors.New("this restock is already settled")
	errReshippingNotOwned      = errors.New("a reshipping carries only the team's own products")
	errReshippingLineTwice     = errors.New("a product appears once per reshipping")
	errReshippingSupplier      = errors.New("supplier_id: the reshipping's supplier must be one a line of the restock names")
)

// The restock's problem tags — the app's own (a-restock-problem-is-a-system-tag).
var restockProblemTasks = []string{appTaskProblemMissing, appTaskProblemBroken}

// restockTakesResolutions is the one eligibility rule (a-restock-problem-is-settled-by-resolution-rows): a LOST restock,
// or an ACCEPTED one carrying a problem tag or already settled. Judged on the LOCKED row, in the caller's transaction.
func restockTakesResolutions(tx *gorm.DB, rr *models.Restock) error {
	switch rr.Status {
	case restockStatusLost:
		return nil
	case restockStatusAccepted:
		if rr.SettledAt != nil {
			return nil
		}

		tagged, err := restockHasProblemTag(tx, rr.ID)
		if err != nil {
			return err
		}

		if tagged {
			return nil
		}
	}

	return fmt.Errorf("%w: this restock is %s", errResolutionNotAProblem, rr.Status)
}

// restockHasProblemTag is whether *Barang kurang* or *Barang rusak* is on the restock. One statement on the key of
// `restock_tags`.
func restockHasProblemTag(tx *gorm.DB, restockID uint64) (bool, error) {
	var tagged bool

	err := tx.
		Raw(`SELECT EXISTS (
			SELECT 1 FROM restock_tags rt JOIN tags t ON t.id = rt.tag_id
			WHERE rt.restock_id = ? AND t.app_task IN ?)`, restockID, restockProblemTasks).
		Scan(&tagged).
		Error
	if err != nil {
		return false, fmt.Errorf("read the restock's problem tags: %w", err)
	}

	return tagged, nil
}

// takeProblemTagsOff is *Tandai Selesai*'s second half: *Barang kurang* and *Barang rusak* come off the restock, in the
// caller's transaction. ONE statement.
func takeProblemTagsOff(tx *gorm.DB, restockID uint64) error {
	return tx.Exec(`
		DELETE FROM restock_tags rt
		USING tags t
		WHERE rt.tag_id = t.id AND rt.restock_id = ? AND t.app_task IN ?`,
		restockID, restockProblemTasks,
	).Error
}

// lockSellingRestock locks the restock row FOR UPDATE as its SELLING team reads it — every resolution write's first
// lock. Another team's restock reads as one that never existed (NotFound).
func lockSellingRestock(tx *gorm.DB, restockID, teamID uint64) (*models.Restock, error) {
	var rr models.Restock

	err := tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND team_id = ?", restockID, teamID).
		First(&rr).
		Error
	if err != nil {
		return nil, err
	}

	return &rr, nil
}

// resolutionTypeToProto / FromProto map the stored word and the wire.
var resolutionTypes = map[models.RestockResolutionType]inventoryv1.RestockResolutionType{
	models.RestockResolutionRefund:     inventoryv1.RestockResolutionType_RESTOCK_RESOLUTION_TYPE_REFUND,
	models.RestockResolutionReturn:     inventoryv1.RestockResolutionType_RESTOCK_RESOLUTION_TYPE_RETURN,
	models.RestockResolutionReshipping: inventoryv1.RestockResolutionType_RESTOCK_RESOLUTION_TYPE_RESHIPPING,
}

func resolutionTypeFromProto(t inventoryv1.RestockResolutionType) models.RestockResolutionType {
	for stored, wire := range resolutionTypes {
		if wire == t {
			return stored
		}
	}

	return ""
}

// resolutionRow is one row as the reads join it: the resolution and its link, if it rides a parcel.
type resolutionRow struct {
	models.RestockResolution
	CustomShipmentID       uint64
	InventoryTransactionID uint64
}

// resolutionToProto is one row on the wire — without money for the warehouse (a-warehouse-sees-no-seller-money): a
// refund's amount UNSET, its account 0.
func resolutionToProto(r *resolutionRow, withMoney bool) *inventoryv1.RestockResolution {
	out := &inventoryv1.RestockResolution{
		Id:                     r.ID,
		RestockId:              r.RestockID,
		Type:                   resolutionTypes[r.ResolutionType],
		Note:                   r.Note,
		CustomShipmentId:       r.CustomShipmentID,
		InventoryTransactionId: r.InventoryTransactionID,
		CreatedByUserId:        r.CreatedByUserID,
		CreatedByIsOverride:    r.CreatedByIsOverride,
		CreatedAtUnix:          r.CreatedAt.Unix(),
	}

	if withMoney && r.ResolutionType == models.RestockResolutionRefund {
		out.RefundAmount = proto.Float64(r.RefundAmount)
		out.FinanceAccountId = r.FinanceAccountID
	}

	return out
}

// restockResolutionRows reads one restock's rows with their links, oldest first. ONE statement on
// restock_resolutions_restock_key and the link's resolution key.
func restockResolutionRows(db *gorm.DB, restockID uint64) ([]resolutionRow, error) {
	var rows []resolutionRow

	err := db.
		Table("restock_resolutions r").
		Select("r.*, COALESCE(l.custom_shipment_id, 0) AS custom_shipment_id, "+
			"COALESCE(l.inventory_transaction_id, 0) AS inventory_transaction_id").
		Joins("LEFT JOIN restock_custom_shipments l ON l.resolution_id = r.id").
		Where("r.restock_id = ?", restockID).
		Order("r.id ASC").
		Scan(&rows).
		Error
	if err != nil {
		return nil, fmt.Errorf("read the restock's resolutions: %w", err)
	}

	return rows, nil
}

// restockReadsMoney is whether `readerTeamID` may read the selling team's refunds on this restock: its own selling team
// and the root team; never the receiving warehouse.
func restockReadsMoney(sellingTeamID, readerTeamID uint64) bool {
	return readerTeamID == sellingTeamID || readerTeamID == san_auth.RootTeamID
}

// withRestockResolutions fills a Detail's resolutions and their count, as `readerTeamID` reads them.
func withRestockResolutions(db *gorm.DB, wire *inventoryv1.RestockRequest, readerTeamID uint64) error {
	rows, err := restockResolutionRows(db, wire.GetId())
	if err != nil {
		return err
	}

	withMoney := restockReadsMoney(wire.GetRequestingTeamId(), readerTeamID)

	wire.Resolutions = make([]*inventoryv1.RestockResolution, 0, len(rows))
	for i := range rows {
		wire.Resolutions = append(wire.Resolutions, resolutionToProto(&rows[i], withMoney))
	}

	wire.ResolutionCount = uint32(len(rows))

	return nil
}

// withResolutionCounts fills a page of list rows' resolution counts — ONE grouped statement on
// restock_resolutions_restock_key, none for an empty page. The settled mark rides the row itself (restockRequestToProto).
func withResolutionCounts(db *gorm.DB, wire ...*inventoryv1.RestockRequest) error {
	if len(wire) == 0 {
		return nil
	}

	ids := make([]uint64, 0, len(wire))
	for _, w := range wire {
		ids = append(ids, w.GetId())
	}

	var rows []struct {
		RestockID uint64
		N         uint32
	}

	err := db.
		Table("restock_resolutions").
		Select("restock_id, COUNT(*) AS n").
		Where("restock_id IN ?", ids).
		Group("restock_id").
		Scan(&rows).
		Error
	if err != nil {
		return fmt.Errorf("count the page's resolutions: %w", err)
	}

	byID := make(map[uint64]uint32, len(rows))
	for _, r := range rows {
		byID[r.RestockID] = r.N
	}

	for _, w := range wire {
		w.ResolutionCount = byID[w.GetId()]
	}

	return nil
}

// insertResolution writes one resolution row, first in its transaction after the restock's lock — a used key refuses
// before anything else is written.
func insertResolution(tx *gorm.DB, row *models.RestockResolution) error {
	err := tx.
		Create(row).
		Error
	if err != nil {
		if isUniqueViolation(err) {
			return errResolutionKeyUsed
		}

		return fmt.Errorf("restock resolution: %w", err)
	}

	return nil
}

// linkResolutionParcel writes the `restock_custom_shipments` row joining a restock, its resolution and the parcel it
// rides. A parcel already linked (unique) is refused.
func linkResolutionParcel(tx *gorm.DB, restockID, resolutionID, shipmentID uint64) error {
	err := tx.
		Create(&models.RestockCustomShipment{
			RestockID:        restockID,
			ResolutionID:     resolutionID,
			CustomShipmentID: shipmentID,
		}).
		Error
	if err != nil {
		if isUniqueViolation(err) {
			return errResolutionParcelTaken
		}

		return fmt.Errorf("restock custom shipment link: %w", err)
	}

	return nil
}

// parcelLink is a parcel's resolution link as the custom-shipment reads carry it.
type parcelLink struct {
	CustomShipmentID       uint64
	ResolutionID           uint64
	InventoryTransactionID uint64
}

// parcelLinks reads the resolution links of the parcels named — ONE statement on the link's custom_shipment_id key,
// none for no id.
func parcelLinks(db *gorm.DB, shipmentIDs []uint64) (map[uint64]parcelLink, error) {
	out := make(map[uint64]parcelLink, len(shipmentIDs))
	if len(shipmentIDs) == 0 {
		return out, nil
	}

	var rows []parcelLink

	err := db.
		Table("restock_custom_shipments").
		Select("custom_shipment_id, resolution_id, COALESCE(inventory_transaction_id, 0) AS inventory_transaction_id").
		Where("custom_shipment_id IN ?", shipmentIDs).
		Scan(&rows).
		Error
	if err != nil {
		return nil, fmt.Errorf("read the parcels' resolution links: %w", err)
	}

	for _, r := range rows {
		out[r.CustomShipmentID] = r
	}

	return out, nil
}

// restockRefundedEvent announces a REFUND row — the money into the account it names, posted by financial_account as a
// `restock` row (restock-is-never-typed-by-hand), the way a cancelled restock's money comes back. Its id is the row's:
// one per refund, so a redelivery or a republish posts once.
func restockRefundedEvent(rr *models.Restock, row *models.RestockResolution) *eventsv1.Event {
	ref := strconv.FormatUint(rr.ID, 10)

	return &eventsv1.Event{
		EventId:     "restock-refunded:" + strconv.FormatUint(row.ID, 10),
		OccurredAt:  timestamppb.New(row.CreatedAt),
		AggregateId: "restock:" + ref,
		Message: &eventsv1.Event_RestockRefunded{RestockRefunded: &eventsv1.RestockRefunded{
			RestockId:        rr.ID,
			ResolutionId:     row.ID,
			TeamId:           rr.TeamID,
			FinanceAccountId: row.FinanceAccountID,
			Amount:           row.RefundAmount,
			ActorId:          row.CreatedByUserID,
			ActorIsOverride:  row.CreatedByIsOverride,
			RefundedAtUnix:   row.CreatedAt.Unix(),
		}},
	}
}

// publishRestockRefund sends the refund's event after its commit — logged with its event_id when it fails, never
// failing the request that already committed (no-outbox-the-publish-is-trusted), as every restock money event.
func (s *Service) publishRestockRefund(ctx context.Context, event *eventsv1.Event) {
	err := s.events(ctx, publishIdentity(ctx), event)
	if err != nil {
		slog.ErrorContext(ctx, "restock refund committed but its event was not published — the account is short this "+
			"refund until a replay",
			"event_id", event.GetEventId(),
			"error", err,
		)
	}
}
