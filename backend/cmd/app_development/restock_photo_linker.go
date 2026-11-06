package main

import (
	"context"
	"time"

	document_v1 "github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// restockPhotoLinker answers inventory's ReceiptPhotoLinker from document_service: the link to a restock's label photo,
// for the warehouse it is going to (the-restocks-warehouse-opens-its-label-photo). RestockReceiptPhoto has already
// checked the restock's warehouse_id is the caller; document_service checks the file is an active ORDER RECEIPT (the
// type the restock form's ReceiptUpload stores) of the team inventory names as its owner — the restock's selling team
// — and signs it under its own identity. It is the same narrow door as orderLabelLinker's, never a share.
//
// The same linker serves a warehouse transfer's label photo (every-side-of-a-transfer-opens-its-label-photo):
// WarehouseTransferLabelPhoto has checked the caller is the sender, the receiver or the owning selling team, and names
// the SENDING warehouse as the owner — A's crew attached the photo at ship, through the same ReceiptUpload.
//
// It calls a plain method, not an RPC, because the owner it is told is inventory's finding and must never come from a
// browser.
type restockPhotoLinker struct {
	documents *document_v1.Service
}

func NewRestockPhotoLinker(documents *document_v1.Service) inventory_v1.ReceiptPhotoLinker {
	return &restockPhotoLinker{documents: documents}
}

func (l *restockPhotoLinker) LabelURL(ctx context.Context, ownerTeamID uint64, documentID string) (string, time.Time, error) {
	return l.documents.LabelURL(ctx, ownerTeamID, documentID)
}
