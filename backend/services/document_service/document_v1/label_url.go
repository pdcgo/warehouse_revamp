package document_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
)

// LabelURL signs a short-lived link to a shipping label for the service that has checked the caller's right to it: the
// ORDER SERVICE, once the order ships from the caller's warehouse (a-warehouse-prints-the-labels-of-orders-it-ships),
// and INVENTORY, once the restock is going to the caller's warehouse (the-restocks-warehouse-opens-its-label-photo — the
// restock form's ReceiptUpload stores its label photo as an order receipt too), and once the caller is a side of a
// warehouse transfer (every-side-of-a-transfer-opens-its-label-photo — A's ship form uploads it the same way). It is a Go method reached in-process
// through the composition root (order_label_linker.go, restock_photo_linker.go) — NOT an RPC: no browser can call it,
// and no request names the owner.
//
// ⚠ IT IS THE ONE DOOR PAST GetDownloadUrl's TWO, and it is narrow on purpose:
//
//   - only an ORDER RECEIPT — never a payment proof, a statement or any other private file;
//   - only the team the calling service says OWNS it (the order's or the restock's selling team, a transfer's sending
//     warehouse) — the id alone
//     opens nothing;
//   - only an ACTIVE one.
//
// Anything else is NotFound, exactly as GetDownloadUrl answers. No `document_shares` row is written: nothing to
// re-share when the seller replaces the label.
func (s *Service) LabelURL(ctx context.Context, ownerTeamID uint64, documentID string) (string, time.Time, error) {
	var docs []document_service_models.Document

	err := s.db.
		WithContext(ctx).
		Select("id", "object_key", "filename").
		Where("id = ? AND team_id = ? AND resource_type = ? AND status = ?",
			documentID, ownerTeamID, resourceOrderReceipt, statusActive).
		Limit(1).
		Find(&docs).
		Error
	if err != nil {
		return "", time.Time{}, connect.NewError(connect.CodeInternal, err)
	}

	if len(docs) == 0 {
		return "", time.Time{}, notFound()
	}

	expiry := time.Now().Add(s.cfg.URLTTL)

	// The link carries the label's own name, so it downloads as that (a-download-keeps-its-files-name).
	return s.signer.SignedGetURL(docs[0].ObjectKey, docs[0].Filename), expiry, nil
}
