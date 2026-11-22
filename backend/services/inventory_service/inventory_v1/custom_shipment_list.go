package inventory_v1

import (
	"context"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// CustomShipmentList is every side's list of parcels, newest first, paged (HARD RULE 9): the selling team its own
// (team_id), a warehouse the ones it ships (warehouse_id), the root team every one. The scope is the one Detail reads
// (customShipmentForWire), so a row on the list always opens.
//
// The warehouse reads NO seller money in any row: the sample's value, each line's value, the team's account and a TEAM
// payer's cost are left UNSET — the mapper Detail answers with, row by row (customShipmentReadsMoney); a WAREHOUSE
// payer's cost is the ongkir it paid (a-warehouse-sees-no-seller-money, the-warehouse-sees-the-ongkir-it-paid,
// the-custom-shipments-prototype-is-accepted). Each row carries its lines; the trail is Detail's alone.
//
// The filter is the accepted list screen's: ONE status (its tabs), ONE kind, free text, and — the selling side's — the
// warehouse it ships from. Three statements: the count, the page, the page's lines — and, when the page holds a
// requested parcel, its open goods-missing notes (customShipmentOpenNotes: one more, two when one has a note).
//
// A requested parcel the warehouse noted goods missing on carries its open note — the latest — on BOTH sides' rows: the
// badge on the team's list and on the warehouse's queue (the-goods-missing-badge-is-on-both-lists). No money in it.
func (s *Service) CustomShipmentList(
	ctx context.Context,
	req *connect.Request[inventoryv1.CustomShipmentListRequest],
) (*connect.Response[inventoryv1.CustomShipmentListResponse], error) {
	teamID := req.Msg.GetTeamId()
	page := req.Msg.GetPage()

	query := customShipmentListScope(s.db.WithContext(ctx), teamID, req.Msg.GetFilter())

	var total int64

	err := query.
		Count(&total).
		Error
	if err != nil {
		return nil, customShipmentErr(err)
	}

	var rows []models.CustomShipment

	err = query.
		Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		Order("custom_shipments.id DESC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&rows).
		Error
	if err != nil {
		return nil, customShipmentErr(err)
	}

	notes, err := customShipmentOpenNotes(s.db.WithContext(ctx), rows)
	if err != nil {
		return nil, customShipmentErr(err)
	}

	// THE PAGE'S RESOLUTION LINKS (backlog #101) — a return's and an inbound parcel's row, and an inbound one's stock-in —
	// in ONE statement on the link's parcel key.
	ids := make([]uint64, 0, len(rows))
	for i := range rows {
		ids = append(ids, rows[i].ID)
	}

	links, err := parcelLinks(s.db.WithContext(ctx), ids)
	if err != nil {
		return nil, customShipmentErr(err)
	}

	out := make([]*inventoryv1.CustomShipment, 0, len(rows))
	for i := range rows {
		wire := customShipmentToProto(&rows[i], customShipmentReadsMoney(&rows[i], teamID), false, nil)
		wire.GoodsMissing = notes[rows[i].ID]
		withParcelLink(wire, links)
		out = append(out, wire)
	}

	return connect.NewResponse(&inventoryv1.CustomShipmentListResponse{
		CustomShipments: out,
		PageInfo:        pageInfo(page, total),
	}), nil
}

// customShipmentListScope is THE list's predicate — the reader's parcels narrowed by the filter — with nothing selected,
// ordered or paged, so the count and the page read one set.
//
// The reader's parcels: the root team reads every one; any other team the ones it owns OR ships — the WHERE Detail
// reads (customShipmentForWire). A team is one side only (a selling team owns, a warehouse ships), so one leg of the OR
// is always empty.
func customShipmentListScope(db *gorm.DB, teamID uint64, filter *inventoryv1.CustomShipmentListFilter) *gorm.DB {
	query := db.
		Model(&models.CustomShipment{})

	if teamID != san_auth.RootTeamID {
		query = query.Where("(custom_shipments.team_id = ? OR custom_shipments.warehouse_id = ?)", teamID, teamID)
	}

	// One status (the screen's tab) or all.
	if status := customShipmentStatusFromProto(filter.GetStatus()); status != "" {
		query = query.Where("custom_shipments.status = ?", status)
	}

	// One kind or both.
	if kind := customShipmentKindFromProto(filter.GetKind()); kind != "" {
		query = query.Where("custom_shipments.kind = ?", kind)
	}

	// WHICH WAY (backlog #101): asked, that direction; unasked, both for the selling team and the root team (its Kirim
	// Paket lists the inbound parcels under Semua) and OUTBOUND for a warehouse — its queue is what it ships, and it reads
	// the parcels coming in through INBOUND (its incoming list), so the queue it had reads as before.
	switch filter.GetDirection() {
	case inventoryv1.CustomShipmentDirection_CUSTOM_SHIPMENT_DIRECTION_INBOUND:
		query = query.Where("custom_shipments.kind = ?", models.CustomShipmentSupplierReshipping)
	case inventoryv1.CustomShipmentDirection_CUSTOM_SHIPMENT_DIRECTION_OUTBOUND:
		query = query.Where("custom_shipments.kind <> ?", models.CustomShipmentSupplierReshipping)
	default:
		if teamID != san_auth.RootTeamID {
			query = query.Where("(custom_shipments.team_id = ? OR custom_shipments.kind <> ?)", teamID,
				models.CustomShipmentSupplierReshipping)
		}
	}

	// The warehouse it ships from — the selling side's lens; it narrows the scope, never widens it.
	if warehouseID := filter.GetWarehouseId(); warehouseID != 0 {
		query = query.Where("custom_shipments.warehouse_id = ?", warehouseID)
	}

	return applyCustomShipmentSearch(query, filter.GetQ())
}

// applyCustomShipmentSearch narrows by free text over what a person remembers about a parcel: its number (a whole id,
// with or without its #), the recipient, a line's product code or name. The lines match with EXISTS, so a parcel is
// never counted once per matching line.
func applyCustomShipmentSearch(query *gorm.DB, q string) *gorm.DB {
	q = strings.TrimSpace(q)
	if q == "" {
		return query
	}

	like := "%" + strings.ToLower(q) + "%"

	conditions := []string{
		"LOWER(custom_shipments.recipient_name) LIKE ?",
		"EXISTS (SELECT 1 FROM custom_shipment_items i WHERE i.custom_shipment_id = custom_shipments.id " +
			"AND (LOWER(i.product_code) LIKE ? OR LOWER(i.name) LIKE ?))",
	}
	args := []any{like, like, like}

	id, err := strconv.ParseUint(strings.TrimPrefix(q, "#"), 10, 64)
	if err == nil && id != 0 {
		conditions = append(conditions, "custom_shipments.id = ?")
		args = append(args, id)
	}

	return query.Where("("+strings.Join(conditions, " OR ")+")", args...)
}

// customShipmentOpenNotes is, per REQUESTED parcel of a page, its open goods-missing note — the latest — with its lines:
// what a list row carries for the badge (a list row has no trail). A parcel picked, handed over or cancelled has none
// open, so only the page's requested ids are read. Two statements at most — the notes (one row per parcel, on the
// trail's (custom_shipment_id, id) key), then their lines — and none for a page with no requested parcel.
func customShipmentOpenNotes(
	db *gorm.DB,
	rows []models.CustomShipment,
) (map[uint64]*inventoryv1.CustomShipmentGoodsMissing, error) {
	out := map[uint64]*inventoryv1.CustomShipmentGoodsMissing{}

	var ids []uint64

	for i := range rows {
		if rows[i].Status == models.CustomShipmentRequested {
			ids = append(ids, rows[i].ID)
		}
	}

	if len(ids) == 0 {
		return out, nil
	}

	var notes []models.CustomShipmentLog

	err := db.
		Model(&models.CustomShipmentLog{}).
		Select("DISTINCT ON (custom_shipment_id) *").
		Where("custom_shipment_id IN ? AND kind = ?", ids, models.CustomShipmentLogGoodsMissing).
		Order("custom_shipment_id, id DESC").
		Find(&notes).
		Error
	if err != nil {
		return nil, err
	}

	noteIDs := make([]uint64, 0, len(notes))
	for _, n := range notes {
		noteIDs = append(noteIDs, n.ID)
	}

	lines, err := customShipmentMissingLines(db, noteIDs)
	if err != nil {
		return nil, err
	}

	for i := range notes {
		out[notes[i].CustomShipmentID] = customShipmentNote(&notes[i], lines[notes[i].ID])
	}

	return out, nil
}

// customShipmentStatusFromProto is the stored word of a filter's status; UNSPECIFIED (all) is "".
func customShipmentStatusFromProto(status inventoryv1.CustomShipmentStatus) models.CustomShipmentStatus {
	for stored, wire := range customShipmentStatuses {
		if wire == status {
			return stored
		}
	}

	return ""
}

// customShipmentKindFromProto is the stored word of a filter's kind; UNSPECIFIED (both) is "".
func customShipmentKindFromProto(kind inventoryv1.CustomShipmentKind) models.CustomShipmentKind {
	for stored, wire := range customShipmentKinds {
		if wire == kind {
			return stored
		}
	}

	return ""
}
