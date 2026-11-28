package main

import (
	"context"
	"errors"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// The reprint half of ProductReader (backlog #151) for lostOrderCatalog — the found-parcel test never asks for it.

var errLostOrderNoReprints = errors.New("the lost-order catalogue knows no reprint waits")

func (lostOrderCatalog) ReprintWaits(context.Context, uint64, int, int) (inventory_v1.ReprintWaitPage, error) {
	return inventory_v1.ReprintWaitPage{}, errLostOrderNoReprints
}

func (lostOrderCatalog) ReprintWaitingCount(context.Context, uint64) (int64, error) {
	return 0, errLostOrderNoReprints
}

func (lostOrderCatalog) RecordReprint(context.Context, *gorm.DB, uint64, []inventory_v1.ReprintPrinted) (inventory_v1.ReprintRecorded, error) {
	return inventory_v1.ReprintRecorded{}, errLostOrderNoReprints
}

func (lostOrderCatalog) ReprintArrivals(context.Context, *gorm.DB, uint64, []uint64) error {
	return nil
}
