package main

import (
	"context"
	"time"

	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// settlementOpenedMarker answers settlement's OrderOpenedMarker from the order service
// (a-missing-account-is-found-by-its-opened-at): when settlement commits an order's first `initial_total`, the order's
// own `settlement_opened_at` is stamped by selling_v1.SettlementOpened — selling writes its row, settlement never does.
//
// A plain method, not an RPC: the moment is settlement's finding and must never come from a browser. In-process, so a
// stamp costs one UPDATE by primary key and no hop.
type settlementOpenedMarker struct {
	orders *selling_v1.Service
}

func NewSettlementOpenedMarker(orders *selling_v1.Service) settlement_v1.OrderOpenedMarker {
	return &settlementOpenedMarker{orders: orders}
}

func (m *settlementOpenedMarker) SettlementOpened(ctx context.Context, orderID uint64, openedAt time.Time) error {
	return m.orders.SettlementOpened(ctx, orderID, openedAt)
}
