package inventory_v1

import (
	"context"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// CustomShipmentReshipOptions is what a reship can send: the selling team's RECEIVED restocks whose broken units are not
// all on a live reship yet, newest accept first, paged (HARD RULE 9 — it grows with every problem restock), each with
// only its broken lines that still have units free (the-custom-shipments-prototype-is-accepted: *"at most the broken
// count minus the units already on another live reship"*).
//
// It offers exactly what CustomShipmentCreate accepts (createReship → judgeReshipLines): an ACCEPTED restock of the
// team, a line's broken units its BROKEN problem row's count (written by Terima, which also puts the *Barang rusak* tag
// on — a-restock-problem-is-a-system-tag), less what reships hold of it (reshipItemHeld — the units on reships that are
// not cancelled, and those a goods-missing note named on a cancelled one, missing-reship-units-are-not-offered-again;
// reshipUnitsSent, the create's own reader). It keys on the broken rows, never on the tag: what takes the tag off is
// the owner's parked restock-problem context.
//
// A line carries its supplier and store as supplier_service ids; the form resolves the names and prefills the
// recipient (SupplierByIds) — no inventory→supplier seam. Free text matches the restock's number (a whole id, with or
// without its #) or a FREE broken line's product code or name.
//
// Three statements: the page WITH its count (COUNT(*) OVER () — every restock of the team is probed once, never twice;
// a page past the end counts alone), its broken lines, the units live reships carry of them.
func (s *Service) CustomShipmentReshipOptions(
	ctx context.Context,
	req *connect.Request[inventoryv1.CustomShipmentReshipOptionsRequest],
) (*connect.Response[inventoryv1.CustomShipmentReshipOptionsResponse], error) {
	db := s.db.WithContext(ctx)
	page := req.Msg.GetPage()
	teamID := req.Msg.GetTeamId()
	q := req.Msg.GetQ()

	var restocks []struct {
		ID          uint64
		TeamID      uint64
		WarehouseID uint64
		AcceptedAt  *time.Time
		Total       int64
	}

	err := reshipOptionScope(db, teamID, q).
		Select("r.id, r.team_id, r.warehouse_id, r.accepted_at, COUNT(*) OVER () AS total").
		Order("r.accepted_at DESC NULLS LAST, r.id DESC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Scan(&restocks).
		Error
	if err != nil {
		return nil, customShipmentErr(err)
	}

	var total int64

	switch {
	case len(restocks) > 0:
		total = restocks[0].Total
	case pageOffset(page) > 0:
		// A page past the end carries no row to read the count from.
		err = reshipOptionScope(db, teamID, q).
			Count(&total).
			Error
		if err != nil {
			return nil, customShipmentErr(err)
		}
	}

	ids := make([]uint64, 0, len(restocks))
	for _, r := range restocks {
		ids = append(ids, r.ID)
	}

	lines, err := reshipOptionLines(db, ids)
	if err != nil {
		return nil, customShipmentErr(err)
	}

	options := make([]*inventoryv1.CustomShipmentReshipOption, 0, len(restocks))

	for _, r := range restocks {
		option := &inventoryv1.CustomShipmentReshipOption{
			RestockId:   r.ID,
			TeamId:      r.TeamID,
			WarehouseId: r.WarehouseID,
			Lines:       lines[r.ID],
		}

		if r.AcceptedAt != nil {
			option.AcceptedAtUnix = r.AcceptedAt.Unix()
		}

		options = append(options, option)
	}

	return connect.NewResponse(&inventoryv1.CustomShipmentReshipOptionsResponse{
		Options:  options,
		PageInfo: pageInfo(page, total),
	}), nil
}

// reshipLineFree is the SQL of "this broken row's line still has units free": its count above what reships hold of the
// line — reshipItemHeld summed, reshipUnitsSent's rule, per line. `p` is the broken row, `ri` its line.
const reshipLineFree = "p.count > COALESCE((SELECT SUM(" + reshipItemHeld + ") FROM custom_shipment_items i " +
	"JOIN custom_shipments c ON c.id = i.custom_shipment_id " +
	"WHERE i.restock_item_id = ri.id), 0)"

// reshipOptionScope is the offered set — the team's accepted restocks with at least one broken line still free, narrowed
// by the free text — with nothing selected, ordered or paged, so the count and the page read one set. `r` is the
// restock.
//
// ⚠ The OFFSET 0 is load-bearing: it keeps the EXISTS a per-restock probe (the team's restocks, each looked up on
// restock_problem_items' (restock_id, …) key and restock_items' (restock_id, product_id) key). Without it the planner
// flattens the EXISTS into a semi-join that hashes EVERY team's broken rows joined to a seq scan of every team's
// restock lines — the cost then grows with the platform, not the team (measured in custom_shipment_list_perf_test.go:
// a team of 2 000 restocks among 50 000, 100 ms → see the test's A/B).
func reshipOptionScope(db *gorm.DB, teamID uint64, q string) *gorm.DB {
	free := "EXISTS (SELECT 1 FROM restock_problem_items p " +
		"JOIN restock_items ri ON ri.restock_id = p.restock_id AND ri.product_id = p.product_id " +
		"WHERE p.restock_id = r.id AND p.problem_type = ? AND " + reshipLineFree
	args := []any{restockProblemBroken}

	q = strings.TrimSpace(q)
	if q != "" {
		like := "%" + strings.ToLower(q) + "%"

		match := []string{"LOWER(ri.product_code) LIKE ?", "LOWER(ri.name) LIKE ?"}
		args = append(args, like, like)

		id, err := strconv.ParseUint(strings.TrimPrefix(q, "#"), 10, 64)
		if err == nil && id != 0 {
			match = append(match, "r.id = ?")
			args = append(args, id)
		}

		free += " AND (" + strings.Join(match, " OR ") + ")"
	}

	return db.
		Table("restocks AS r").
		Where("r.team_id = ? AND r.status = ?", teamID, restockStatusAccepted).
		Where(free+" OFFSET 0)", args...)
}

// reshipOptionLines is, per restock of a page, its broken lines that still have units free, in line order: the broken
// row joined to its line (one statement), then what reships hold of those lines (reshipUnitsSent — the create's own
// reader, so the offer and the refusal count alike).
func reshipOptionLines(db *gorm.DB, restockIDs []uint64) (map[uint64][]*inventoryv1.CustomShipmentReshipLine, error) {
	out := make(map[uint64][]*inventoryv1.CustomShipmentReshipLine, len(restockIDs))
	if len(restockIDs) == 0 {
		return out, nil
	}

	var rows []struct {
		RestockID         uint64
		RestockItemID     uint64
		ProductID         uint64
		ProductCode       string
		Name              string
		Broken            int64
		BrokenNote        string
		SupplierID        *uint64
		SupplierChannelID *uint64
	}

	err := db.
		Table("restock_problem_items AS p").
		Select("p.restock_id, ri.id AS restock_item_id, ri.product_id, ri.product_code, ri.name, "+
			"p.count AS broken, p.note AS broken_note, ri.supplier_id, ri.supplier_channel_id").
		Joins("JOIN restock_items ri ON ri.restock_id = p.restock_id AND ri.product_id = p.product_id").
		Where("p.restock_id IN ? AND p.problem_type = ?", restockIDs, restockProblemBroken).
		Order("p.restock_id, ri.id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	itemIDs := make([]uint64, 0, len(rows))
	for _, r := range rows {
		itemIDs = append(itemIDs, r.RestockItemID)
	}

	sent := map[uint64]reshipUnits{}
	if len(itemIDs) > 0 {
		sent, err = reshipUnitsSent(db, itemIDs)
		if err != nil {
			return nil, err
		}
	}

	for _, r := range rows {
		held := sent[r.RestockItemID]
		if r.Broken <= held.held() {
			// Every broken unit of it is on a live reship, or noted gone on a cancelled one: nothing left to offer.
			continue
		}

		line := &inventoryv1.CustomShipmentReshipLine{
			RestockItemId: r.RestockItemID,
			ProductId:     r.ProductID,
			ProductCode:   r.ProductCode,
			Name:          r.Name,
			Broken:        uint64(r.Broken),
			AlreadySent:   uint64(held.Live),
			NotFound:      uint64(held.NotFound),
			BrokenNote:    r.BrokenNote,
		}

		if r.SupplierID != nil {
			line.SupplierId = *r.SupplierID
		}

		if r.SupplierChannelID != nil {
			line.SupplierChannelId = *r.SupplierChannelID
		}

		out[r.RestockID] = append(out[r.RestockID], line)
	}

	return out, nil
}
