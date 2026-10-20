package inventory_v1

import (
	"context"
	"math"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// BatchList reads a warehouse's batches as COST LAYERS (#209) — one row per batch of the batch ledger. It backs both
// the product detail's Batches tab (filtered to one product) and the warehouse-wide batch list, so it carries the
// search, supplier and expiry filters both use.
//
// Newest batch first: the list is read top-down as "what came in recently", while the oldest-first draw is a property
// of the take, not of how the list is ordered.
//
// The delivery and receipt come from the restock whose accept minted the batch, sku and name from its line (or the
// transfer line, for a batch a transfer minted) — see batchQuery.
func (s *Service) BatchList(
	ctx context.Context,
	req *connect.Request[inventoryv1.BatchListRequest],
) (*connect.Response[inventoryv1.BatchListResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	filter := req.Msg.GetFilter()
	page := req.Msg.GetPage()

	base := func() *gorm.DB {
		q := batchQuery(s.db.WithContext(ctx)).Where("b.warehouse_id = ?", warehouseID)

		if productID := filter.GetProductId(); productID != 0 {
			q = q.Where("b.product_id = ?", productID)
		}

		// The delivery number (with or without its #) or the receipt.
		if search := filter.GetSearch(); search != "" {
			like := "%" + search + "%"
			bare := "%" + trimHash(search) + "%"
			q = q.Where("(CAST(r.id AS TEXT) ILIKE ? OR r.receipt ILIKE ?)", bare, like)
		}

		if supplierID := filter.GetSupplierId(); supplierID != 0 {
			q = q.Where("b.supplier_id = ?", supplierID)
		}

		switch filter.GetExpiry() {
		case inventoryv1.BatchExpiryFilter_BATCH_EXPIRY_FILTER_EXPIRING_SOON:
			q = q.Where("b.expired_at IS NOT NULL AND b.expired_at <= ?", soonCutoff())
		case inventoryv1.BatchExpiryFilter_BATCH_EXPIRY_FILTER_NO_EXPIRY:
			q = q.Where("b.expired_at IS NULL")
		}

		var dateCol string

		switch filter.GetDateField() {
		case inventoryv1.BatchDateField_BATCH_DATE_FIELD_ARRIVED:
			dateCol = "b.created_at"
		case inventoryv1.BatchDateField_BATCH_DATE_FIELD_EXPIRING:
			dateCol = "b.expired_at"
		}

		if dateCol != "" {
			if from := filter.GetFromUnix(); from > 0 {
				q = q.Where(dateCol+" >= ?", time.Unix(from, 0))
			}

			if to := filter.GetToUnix(); to > 0 {
				q = q.Where(dateCol+" <= ?", time.Unix(to, 0))
			}
		}

		return q
	}

	var total int64

	err := base().Count(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var rows []batchRow

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = base().
		Select(batchSelect).
		Order("b.id DESC").
		Offset(offset).
		Limit(int(page.GetLimit())).
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Over the WHOLE filtered set, not this page: the header's "ready value" and "expiring soon" count every batch the
	// filter matched.
	var agg struct {
		ReadyValue   float64
		ExpiringSoon int64
	}

	err = base().
		Select(`
			COALESCE(SUM(b.stock_valuation), 0) AS ready_value,
			COALESCE(SUM(CASE WHEN b.expired_at IS NOT NULL AND b.expired_at <= ? THEN 1 ELSE 0 END), 0) AS expiring_soon`,
			soonCutoff()).
		Scan(&agg).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	batches := make([]*inventoryv1.StockBatch, 0, len(rows))
	for i := range rows {
		batches = append(batches, batchRowToProto(&rows[i]))
	}

	items, ids := batchListItems(batches, req.Msg.GetDataRequest())

	return connect.NewResponse(&inventoryv1.BatchListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   pageCount(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
		ReadyValueTotal:   int64(math.Round(agg.ReadyValue)),
		ExpiringSoonCount: uint64(agg.ExpiringSoon),
	}), nil
}

// soonCutoff is the "expiring ≤ 30 days" boundary — a batch is soon-to-expire when its date is on or
// before it. A date, not a timestamp: expiry is a calendar day.
func soonCutoff() time.Time {
	return time.Now().AddDate(0, 0, 30)
}

// trimHash drops a leading '#', which is how a delivery/batch number reads on screen but not how it is
// stored — so a search for "#3007" matches the row 3007.
func trimHash(s string) string {
	if len(s) > 0 && s[0] == '#' {
		return s[1:]
	}
	return s
}

func pageCount(total int64, limit uint32) uint32 {
	if limit == 0 {
		return 0
	}
	return uint32(math.Ceil(float64(total) / float64(limit)))
}
