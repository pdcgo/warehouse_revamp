package inventory_v1

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// ProductReprintRecord is CETAK ULANG KODE's recorded print (backlog #151; products-have-their-own-tag-list, its 🔄 *what
// clears*: the tag stays until EACH warehouse holding stock has printed — as the order label's *Cetak ulang label* clears
// on its recorded print, a-changed-label-asks-the-warehouse-to-reprint). The page sends it right after the print, for the
// products whose every label was in it, each with the code the labels carried.
//
// In ONE transaction, handed across the seam (the liability_poster shape — ProductReader.RecordReprint, product_service's
// own rows on this transaction): this warehouse no longer waits for each product printed with its LIVE code; a product
// whose code changed again since the page read it is NOT cleared and comes back in `code_changed_ids`, so the page
// re-reads and prints again; a product no warehouse waits for any more loses `need_reprint_code`, taken off by the app.
// Only THIS warehouse's waits are touched (the scope). Idempotent: the same print recorded twice changes nothing the
// second time and is not refused.
func (s *Service) ProductReprintRecord(
	ctx context.Context,
	req *connect.Request[inventoryv1.ProductReprintRecordRequest],
) (*connect.Response[inventoryv1.ProductReprintRecordResponse], error) {
	warehouseID := req.Msg.GetWarehouseId()

	printed := make([]ReprintPrinted, 0, len(req.Msg.GetItems()))
	for _, item := range req.Msg.GetItems() {
		printed = append(printed, ReprintPrinted{ProductID: item.GetProductId(), ProductCode: item.GetProductCode()})
	}

	var recorded ReprintRecorded

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var recordErr error

		recorded, recordErr = s.products.RecordReprint(ctx, tx, warehouseID, printed)

		return recordErr
	})
	if errors.Is(err, errNoProductReprints) {
		return nil, connect.NewError(connect.CodeUnavailable, err)
	}

	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("record the reprint: %w", err))
	}

	return connect.NewResponse(&inventoryv1.ProductReprintRecordResponse{
		ClearedIds:     recorded.Cleared,
		CodeChangedIds: recorded.CodeChanged,
		UntaggedIds:    recorded.Untagged,
	}), nil
}
