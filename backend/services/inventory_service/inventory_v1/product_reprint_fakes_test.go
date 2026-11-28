package inventory_v1_test

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// The reprint half of ProductReader (backlog #151) for this package's hand-written product readers — none of their tests
// asks for it, so the reads refuse and a transfer arrival tells nothing (as the nil reader's factsUnchecked does).

var errFakeNoReprints = errors.New("this fake reader knows no reprint waits")

func (fakeFacts) ReprintWaits(context.Context, uint64, int, int) (inventory_v1.ReprintWaitPage, error) {
	return inventory_v1.ReprintWaitPage{}, errFakeNoReprints
}

func (fakeFacts) ReprintWaitingCount(context.Context, uint64) (int64, error) {
	return 0, errFakeNoReprints
}

func (fakeFacts) RecordReprint(context.Context, *gorm.DB, uint64, []inventory_v1.ReprintPrinted) (inventory_v1.ReprintRecorded, error) {
	return inventory_v1.ReprintRecorded{}, errFakeNoReprints
}

func (fakeFacts) ReprintArrivals(context.Context, *gorm.DB, uint64, []uint64) error {
	return nil
}

func (fakeOwners) ReprintWaits(context.Context, uint64, int, int) (inventory_v1.ReprintWaitPage, error) {
	return inventory_v1.ReprintWaitPage{}, errFakeNoReprints
}

func (fakeOwners) ReprintWaitingCount(context.Context, uint64) (int64, error) {
	return 0, errFakeNoReprints
}

func (fakeOwners) RecordReprint(context.Context, *gorm.DB, uint64, []inventory_v1.ReprintPrinted) (inventory_v1.ReprintRecorded, error) {
	return inventory_v1.ReprintRecorded{}, errFakeNoReprints
}

func (fakeOwners) ReprintArrivals(context.Context, *gorm.DB, uint64, []uint64) error {
	return nil
}

// The Stock screen's fake answers the count it is asked (0: nothing waits) — WarehouseStockList asks it only with the
// REPRINT_WAITING slice.
func (wslCatalogue) ReprintWaits(context.Context, uint64, int, int) (inventory_v1.ReprintWaitPage, error) {
	return inventory_v1.ReprintWaitPage{}, errFakeNoReprints
}

func (wslCatalogue) ReprintWaitingCount(context.Context, uint64) (int64, error) {
	return 0, nil
}

func (wslCatalogue) RecordReprint(context.Context, *gorm.DB, uint64, []inventory_v1.ReprintPrinted) (inventory_v1.ReprintRecorded, error) {
	return inventory_v1.ReprintRecorded{}, errFakeNoReprints
}

func (wslCatalogue) ReprintArrivals(context.Context, *gorm.DB, uint64, []uint64) error {
	return nil
}
