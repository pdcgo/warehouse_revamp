package product_v1

import (
	"context"
	"strconv"
	"strings"

	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductSearchAmong is one search among a KNOWN set of products: those of `IDs` whose name or product code contains
// `Q` (case-insensitive, anywhere), one window of them by name, and how many match in all. An EMPTY `Q` lists the whole
// set — still only `IDs`, never the rest of the catalogue.
type ProductSearchAmong struct {
	IDs    []uint64
	Q      string
	Offset int
	Limit  int
}

// SearchAmong answers a warehouse's product picker (a-warehouse-picks-only-what-it-has-held) and its Stock screen
// (the-stock-screen-lists-what-the-warehouse-has-held): inventory knows which products have had a batch in a building,
// and hands their ids here, where the names and codes live. It searches only among them — never the rest of the
// catalogue — so a warehouse finds what it has held and nothing it has not.
//
// Two modes, one statement: with a term it narrows by name or code (the picker, which asks only with a term of 2 or
// more); with NONE it lists every product of the set, in the same order (the Stock screen before anything is typed).
//
// A plain method, not an RPC: the composition root calls it for inventory's WarehouseProductSearch, which ran its own
// policy against the warehouse, and it reads nothing but product_service's rows (HARD RULE 3). As an RPC it would have to
// take the id list from a caller — the very browse ProductDiscover keeps from warehouse roles. That is also why an empty
// term may list: the set is inventory's, never a browser's.
//
// ARCHIVED products are in, flagged (an-archived-product-held-here-can-be-picked): archiving retires a product from its
// catalogue and every other picker, not its units from a shelf, so the warehouse that holds them still finds it. A
// LOCKED one is in too — the lock keeps other teams from selling it, not the warehouse holding it from finding it.
//
// The ids go as ONE array parameter, not a list GORM expands: a warehouse that has held 5 000 products would otherwise
// send 5 000 placeholders per keystroke. And they go ONCE: the window and the count of every match come back from one
// statement (COUNT(*) OVER (), taken before the LIMIT), so the list is not shipped a second time for the total.
func (s *Service) SearchAmong(
	ctx context.Context,
	search ProductSearchAmong,
) ([]*productv1.ProductRowItem, int64, error) {
	q := strings.TrimSpace(search.Q)
	if len(search.IDs) == 0 || search.Limit <= 0 {
		return nil, 0, nil
	}

	query := s.db.
		WithContext(ctx).
		Model(&product_service_models.Product{}).
		Where("id = ANY(CAST(? AS bigint[]))", idArray(search.IDs))

	// No term: the whole set, listed. A term: those of it whose name or code holds it.
	if q != "" {
		pattern := "%" + escapeLike(q) + "%"

		query = query.Where("name ILIKE ? OR product_code ILIKE ?", pattern, pattern)
	}

	var found []searchAmongRow

	err := query.
		Session(&gorm.Session{}).
		Select("products.*, COUNT(*) OVER () AS total_matches").
		Order("name ASC, product_code ASC, id ASC").
		Offset(search.Offset).
		Limit(search.Limit).
		Scan(&found).
		Error
	if err != nil {
		return nil, 0, err
	}

	var total int64

	switch {
	case len(found) > 0:
		total = found[0].TotalMatches
	case search.Offset > 0:
		// A window past the last match carries no row to read the count from — the one case that counts on its own.
		err = query.
			Count(&total).
			Error
		if err != nil {
			return nil, 0, err
		}
	}

	rows := make([]*productv1.ProductRowItem, 0, len(found))
	for i := range found {
		rows = append(rows, productRowItem(&found[i].Product))
	}

	return rows, total, nil
}

// searchAmongRow is a product row and the count of every match beside it.
type searchAmongRow struct {
	product_service_models.Product
	TotalMatches int64
}

// idArray is a Postgres bigint array literal, bound as one parameter.
func idArray(ids []uint64) string {
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		parts = append(parts, strconv.FormatUint(id, 10))
	}

	return "{" + strings.Join(parts, ",") + "}"
}
