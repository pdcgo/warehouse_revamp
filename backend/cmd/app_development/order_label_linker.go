package main

import (
	"context"
	"time"

	document_v1 "github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// orderLabelLinker answers selling's LabelLinker from document_service: an order's label, for the warehouse that ships
// it (a-warehouse-prints-the-labels-of-orders-it-ships). OrderLabels has already checked the order ships from the
// caller's warehouse; document_service checks the file is an active ORDER RECEIPT of the team the order service names
// as its owner, and signs or reads it under its own identity. Several labels merged into one PDF are stored back as a
// private ORDER_LABELS document of the warehouse.
//
// It calls plain methods, not RPCs — as inventoryProductReader calls SearchAmong — because the owner it is told is the
// order service's finding, and must never come from a browser.
type orderLabelLinker struct {
	documents *document_v1.Service
}

func NewOrderLabelLinker(documents *document_v1.Service) selling_v1.LabelLinker {
	return &orderLabelLinker{documents: documents}
}

func (l *orderLabelLinker) LabelURL(ctx context.Context, ownerTeamID uint64, documentID string) (string, time.Time, error) {
	return l.documents.LabelURL(ctx, ownerTeamID, documentID)
}

func (l *orderLabelLinker) LabelFiles(ctx context.Context, labels []selling_v1.LabelRef) (map[string]selling_v1.LabelFile, error) {
	refs := make([]document_v1.LabelRef, 0, len(labels))
	for _, label := range labels {
		refs = append(refs, document_v1.LabelRef{OwnerTeamID: label.OwnerTeamID, DocumentID: label.DocumentID})
	}

	files, err := l.documents.LabelFiles(ctx, refs)
	if err != nil {
		return nil, err
	}

	out := make(map[string]selling_v1.LabelFile, len(files))
	for id, file := range files {
		out[id] = selling_v1.LabelFile{Content: file.Content, MimeType: file.MimeType}
	}

	return out, nil
}

func (l *orderLabelLinker) StoreOrderLabels(
	ctx context.Context,
	teamID uint64,
	filename string,
	content []byte,
) (string, time.Time, error) {
	return l.documents.StoreOrderLabels(ctx, teamID, filename, content)
}
