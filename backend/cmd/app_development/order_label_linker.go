package main

import (
	"context"
	"time"

	document_v1 "github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// orderLabelLinker answers selling's LabelLinker from document_service: the link to an order's label, for the
// warehouse that ships it (a-warehouse-prints-the-labels-of-orders-it-ships). OrderLabels has already checked the
// order ships from the caller's warehouse; document_service checks the file is an active ORDER RECEIPT of the team
// the order service names as its owner, and signs it under its own identity.
//
// It calls a plain method, not an RPC — as inventoryProductReader calls SearchAmong — because the owner it is told is
// the order service's finding, and must never come from a browser.
type orderLabelLinker struct {
	documents *document_v1.Service
}

func NewOrderLabelLinker(documents *document_v1.Service) selling_v1.LabelLinker {
	return &orderLabelLinker{documents: documents}
}

func (l *orderLabelLinker) LabelURL(ctx context.Context, ownerTeamID uint64, documentID string) (string, time.Time, error) {
	return l.documents.LabelURL(ctx, ownerTeamID, documentID)
}
