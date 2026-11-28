package product_v1

import (
	"context"
	"slices"
	"strings"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductCodesByIds answers the codes that still find KNOWN products (backlog #152, #141 P4 —
// a-team-code-change-recomposes-its-product-codes, its 🔄 *an old sticker scanned before the reprint*, owner Q1 "A": a
// product's former codes still find it): each one's code now and every code it carried before — the `old_code` of its
// `code_changed` history lines (#149's product_logs), newest first, each once, never its code now.
//
// The pick pages' item scan asks it ONCE per page for the order's or the parcel's products, so a scan matches the line's
// code (kept as written: 🔄 *past lines keep their code*), the product's live code and every former code of the same
// product — the new sticker on an order placed before the change, the old sticker on one placed after.
//
// Each side reads only its own, by readableByIds — ProductTagsByIds' rule: the team's own products and, for a warehouse,
// those it has held. Any other id is ABSENT, never refused. A read: three statements at most — the team's own among the
// ids, inventory's held check for the rest, and the codes in one join.
func (s *Service) ProductCodesByIds(
	ctx context.Context,
	req *connect.Request[productv1.ProductCodesByIdsRequest],
) (*connect.Response[productv1.ProductCodesByIdsResponse], error) {
	ids := slices.Clone(req.Msg.GetProductIds())
	slices.Sort(ids)
	ids = slices.Compact(ids)

	db := s.db.WithContext(ctx)

	visible, err := s.readableByIds(ctx, db, req.Msg.GetTeamId(), ids)
	if err != nil {
		return nil, err
	}

	items := make(map[uint64]*productv1.ProductCodes, len(visible))
	if len(visible) == 0 {
		return connect.NewResponse(&productv1.ProductCodesByIdsResponse{Items: items}), nil
	}

	// Each product with its history's former codes beside it, newest line first — one row per line, one row with no
	// former code for a product whose code never changed. The ids are bound on the history's side too, so its lines are
	// read through product_logs_product_idx for these products alone, never by a hash over every product's history.
	var rows []struct {
		ID          uint64
		ProductCode string
		OldCode     *string
	}

	inVisible := idArray(visible)

	err = db.
		Table("products").
		Select("products.id, products.product_code, product_logs.old_code").
		Joins("LEFT JOIN product_logs ON product_logs.product_id = products.id AND product_logs.kind = ? "+
			"AND product_logs.product_id = ANY(CAST(? AS bigint[]))",
			product_service_models.ProductLogCodeChanged, inVisible).
		Where("products.id = ANY(CAST(? AS bigint[]))", inVisible).
		Order("products.id, product_logs.id DESC").
		Scan(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	// Each former code once, compared as the scan and the search compare (case-insensitive), and never the code it carries
	// now — a team that took its own former code back (TeamCodeUpdate allows it) wears it live again.
	seen := make(map[uint64]map[string]bool, len(visible))

	for _, row := range rows {
		codes, ok := items[row.ID]
		if !ok {
			codes = &productv1.ProductCodes{ProductCode: row.ProductCode}
			items[row.ID] = codes
			seen[row.ID] = map[string]bool{strings.ToLower(row.ProductCode): true}
		}

		if row.OldCode == nil {
			continue
		}

		folded := strings.ToLower(*row.OldCode)
		if seen[row.ID][folded] {
			continue
		}

		seen[row.ID][folded] = true
		codes.FormerCodes = append(codes.FormerCodes, *row.OldCode)
	}

	return connect.NewResponse(&productv1.ProductCodesByIdsResponse{Items: items}), nil
}
