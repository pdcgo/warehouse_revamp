package main

import (
	"slices"
	"testing"

	supplier_service "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service"
)

// THE SUPPLIER'S REPLAY SEEKS EVERY SUBSCRIPTION FEEDING ITS TWO REPORTS (the-report-is-processed-like-settlement): the
// replay deletes the restock figures AND Penjualan from its day, so a subscription it does not seek is a report's moves
// deleted and never brought back — and the window it may reach is the shortest of the four.
func TestSupplierReplayBroker_SeeksEveryFeedOfBothReports(t *testing.T) {
	broker, ok := NewSupplierReplayBroker(nil).(*replayBroker)
	if !ok {
		t.Fatalf("NewSupplierReplayBroker is %T, want *replayBroker", NewSupplierReplayBroker(nil))
	}

	got := append([]string{broker.subscription}, broker.also...)
	slices.Sort(got)

	want := []string{
		supplier_service.FoldSubscription,           // RestockAccepted — the restock figures
		supplier_service.CountCorrectedSubscription, // RestockReceivedCountCorrected — the restock figures
		supplier_service.SalesPlacedSubscription,    // OrderPlaced — Penjualan
		supplier_service.SalesCancelledSubscription, // OrderCancelled — Penjualan
	}
	slices.Sort(want)

	if !slices.Equal(got, want) {
		t.Fatalf("the supplier replay seeks %v, want %v", got, want)
	}
}
