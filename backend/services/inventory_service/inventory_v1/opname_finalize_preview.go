package inventory_v1

import (
	"context"
	"sort"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// OpnameFinalizePreview is what finalize would post, per product, and why this person may not finalize yet. It runs the
// finalize's own settlement (inventory_mutations.SettleCount) over a plain read, so the review and the post are one rule
// (broken-posts-as-written-the-rest-nets). A row not yet counted is read as matching its book, so the review shows what
// the counted rows say so far; the block says the rest are not in.
func (s *Service) OpnameFinalizePreview(
	ctx context.Context,
	req *connect.Request[inventoryv1.OpnameFinalizePreviewRequest],
) (*connect.Response[inventoryv1.OpnameFinalizePreviewResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	db := s.db.WithContext(ctx)

	session, err := opnameSessionOf(db, warehouseID, req.Msg.GetSessionId(), "")
	if err != nil {
		return nil, opnameErr(err)
	}

	count, err := readOpnameCount(db, session.ID, true)
	if err != nil {
		return nil, opnameErr(err)
	}

	res := &inventoryv1.OpnameFinalizePreviewResponse{Block: opnameFinalizeBlock(session, count, actorFrom(ctx))}

	// A finished count posted already, and a cancelled one never will: nothing to settle.
	if session.Status != models.OpnameActive {
		return connect.NewResponse(res), nil
	}

	book, err := inventory_mutations.LoadCountBook(db, warehouseID, count.products, false)
	if err != nil {
		return nil, opnameErr(err)
	}

	settled, err := inventory_mutations.SettleCount(book, count.products)
	if err != nil {
		return nil, opnameErr(err)
	}

	for _, p := range settled {
		if !p.Posts() {
			continue
		}

		product := opnameFinalizeProduct(p, count.labels[opnameProductKey{p.TeamID, p.ProductID}])
		res.Products = append(res.Products, product)

		for _, l := range product.GetLines() {
			switch l.GetType() {
			case inventoryv1.OpnamePostType_OPNAME_POST_TYPE_BROKEN, inventoryv1.OpnamePostType_OPNAME_POST_TYPE_LOST:
				res.OwedAmount += l.GetAmount()
			case inventoryv1.OpnamePostType_OPNAME_POST_TYPE_CLAIM:
				res.ClaimedAmount += l.GetAmount()
			case inventoryv1.OpnamePostType_OPNAME_POST_TYPE_MINT:
				res.MintedAmount += l.GetAmount()
			}
		}
	}

	// By team, then name.
	sort.SliceStable(res.Products, func(i, j int) bool {
		a, b := res.Products[i], res.Products[j]
		if a.GetTeamId() != b.GetTeamId() {
			return a.GetTeamId() < b.GetTeamId()
		}

		return a.GetProductName() < b.GetProductName()
	})

	return connect.NewResponse(res), nil
}

// opnameProductKey names one owner's product.
type opnameProductKey struct {
	TeamID    uint64
	ProductID uint64
}

// opnameCount is a session's rows as the finalize reads them.
type opnameCount struct {
	rows     []models.OpnameSessionSnapshot
	products []inventory_mutations.CountProduct
	labels   map[opnameProductKey]models.OpnameSessionSnapshot
}

// readOpnameCount reads every row of a session with its drafts, grouped per owner's product. preview reads a row not
// yet counted as matching its book.
func readOpnameCount(db *gorm.DB, sessionID uint64, preview bool) (opnameCount, error) {
	var out opnameCount

	err := db.Where("opname_session_id = ?", sessionID).Order("team_id, product_id, placement_id").Find(&out.rows).Error
	if err != nil {
		return out, err
	}

	var drafts []models.OpnameProblemsDraft

	err = db.Where("opname_session_id = ?", sessionID).Find(&drafts).Error
	if err != nil {
		return out, err
	}

	type rowKey struct {
		ProductID   uint64
		PlacementID uint64
	}

	broken := map[rowKey]models.OpnameProblemsDraft{}
	lost := map[rowKey]models.OpnameProblemsDraft{}

	for _, d := range drafts {
		k := rowKey{d.ProductID, d.PlacementID}
		if d.ProblemType == models.ProblemBroken {
			broken[k] = d
		} else {
			lost[k] = d
		}
	}

	ids := make([]uint64, 0, len(out.rows))
	for _, r := range out.rows {
		ids = append(ids, r.PlacementID)
	}

	codes, err := placementCodesOf(db, ids)
	if err != nil {
		return out, err
	}

	out.labels = map[opnameProductKey]models.OpnameSessionSnapshot{}
	index := map[opnameProductKey]int{}

	for _, r := range out.rows {
		key := opnameProductKey{r.TeamID, r.ProductID}

		i, seen := index[key]
		if !seen {
			i = len(out.products)
			index[key] = i
			out.products = append(out.products, inventory_mutations.CountProduct{TeamID: r.TeamID, ProductID: r.ProductID})
			out.labels[key] = r
		}

		row := inventory_mutations.CountRow{
			PlacementID: r.PlacementID, PlacementCode: codes[r.PlacementID], System: r.SystemStockCount, Counted: r.Count(),
		}

		if preview && r.Status != models.OpnameRowCounted {
			row.Counted = r.SystemStockCount
		} else {
			k := rowKey{r.ProductID, r.PlacementID}
			row.Broken = broken[k].ProblemStockCount
			row.BrokenNote = broken[k].Note
			row.LostNote = lost[k].Note
		}

		out.products[i].Rows = append(out.products[i].Rows, row)
	}

	return out, nil
}

// opnameFinalizeBlock is why this person may not finalize now: the count is not active, a row is not counted, or they
// counted one (nobody-finalizes-their-own-count — checked against the PERSON, never the role).
func opnameFinalizeBlock(session models.OpnameSession, count opnameCount, actor uint64) inventoryv1.OpnameFinalizeBlock {
	if session.Status != models.OpnameActive {
		return inventoryv1.OpnameFinalizeBlock_OPNAME_FINALIZE_BLOCK_NOT_ACTIVE
	}

	for _, r := range count.rows {
		if r.Status != models.OpnameRowCounted {
			return inventoryv1.OpnameFinalizeBlock_OPNAME_FINALIZE_BLOCK_ROWS_NOT_COUNTED
		}
	}

	for _, r := range count.rows {
		if r.CountedByID != nil && *r.CountedByID == actor {
			return inventoryv1.OpnameFinalizeBlock_OPNAME_FINALIZE_BLOCK_OWN_COUNT
		}
	}

	return inventoryv1.OpnameFinalizeBlock_OPNAME_FINALIZE_BLOCK_UNSPECIFIED
}

// opnameFinalizeProduct maps one product's settlement.
func opnameFinalizeProduct(p inventory_mutations.ProductSettlement, label models.OpnameSessionSnapshot) *inventoryv1.OpnameFinalizeProduct {
	out := &inventoryv1.OpnameFinalizeProduct{
		TeamId:          p.TeamID,
		ProductId:       p.ProductID,
		ProductCode:     label.ProductCode,
		ProductName:     label.ProductName,
		BookCount:       p.Book,
		SellableCount:   p.Sellable,
		BrokenCount:     p.Broken,
		RestCount:       p.Rest,
		RackChangeCount: p.RackChanges,
		MovedCount:      p.Moved,
	}

	for _, l := range p.Lines {
		out.Lines = append(out.Lines, &inventoryv1.OpnamePostLine{
			Type:       opnamePostTypeProto(l.Type),
			BatchId:    l.BatchID,
			StockCount: l.Count,
			PriceUnit:  l.PriceUnit,
			Amount:     l.Amount,
			ProblemId:  l.ProblemID,
		})
	}

	return out
}

func opnamePostTypeProto(t inventory_mutations.SettleType) inventoryv1.OpnamePostType {
	switch t {
	case inventory_mutations.SettleBroken:
		return inventoryv1.OpnamePostType_OPNAME_POST_TYPE_BROKEN
	case inventory_mutations.SettleLost:
		return inventoryv1.OpnamePostType_OPNAME_POST_TYPE_LOST
	case inventory_mutations.SettleClaim:
		return inventoryv1.OpnamePostType_OPNAME_POST_TYPE_CLAIM
	case inventory_mutations.SettleMint:
		return inventoryv1.OpnamePostType_OPNAME_POST_TYPE_MINT
	default:
		return inventoryv1.OpnamePostType_OPNAME_POST_TYPE_UNSPECIFIED
	}
}
