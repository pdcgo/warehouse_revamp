package inventory_v1

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// The transfer names no photo, or names one its sending warehouse no longer holds — said, not a broken link.
var errTransferNoLabelPhoto = errors.New("this transfer has no label photo")

// WarehouseTransferLabelPhoto implements [inventoryv1connect.WarehouseTransferServiceHandler].
//
// EVERY SIDE OPENS THE LABEL PHOTO (every-side-of-a-transfer-opens-its-label-photo): the caller's team must be the
// sending warehouse A, the receiving warehouse B or the selling team that owns the transfer — the same three sides
// WarehouseTransferDetail reads for. Only then is document_service asked, in-process, to sign the photo A attached at
// ship (`receipt_file`, A's upload through ReceiptUpload). No share is written; any other team's call reads NotFound,
// exactly as an id that does not exist, and document_service is never asked.
//
// The seam is the restock's ReceiptPhotoLinker (the-restocks-warehouse-opens-its-label-photo) — one narrow door to
// document_service, told the photo's OWNER by inventory: here A, `from_warehouse_id`, never the caller.
//
// A transfer with no photo — not shipped yet, none attached, or the file is gone — is FailedPrecondition "this transfer
// has no label photo", so the screen can say why.
func (s *Service) WarehouseTransferLabelPhoto(
	ctx context.Context,
	req *connect.Request[inventoryv1.WarehouseTransferLabelPhotoRequest],
) (*connect.Response[inventoryv1.WarehouseTransferLabelPhotoResponse], error) {
	if s.photos == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errNoReceiptPhotoLinker)
	}

	teamID := req.Msg.GetTeamId()

	var transfers []models.WarehouseTransfer

	// THE CHECK: the caller is a side of the transfer. Find, not First — an empty answer is NotFound below.
	err := s.db.
		WithContext(ctx).
		Select("id", "from_warehouse_id", "receipt_file").
		Where("id = ? AND (team_id = ? OR from_warehouse_id = ? OR to_warehouse_id = ?)",
			req.Msg.GetTransferId(), teamID, teamID, teamID).
		Limit(1).
		Find(&transfers).
		Error
	if err != nil {
		return nil, transferErr(err)
	}

	if len(transfers) == 0 {
		return nil, transferErr(errTransferMissing)
	}

	transfer := transfers[0]

	if transfer.ReceiptFile == "" {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errTransferNoLabelPhoto)
	}

	// The owner is the sending warehouse, whose crew attached it at ship — inventory's finding, never the browser's.
	url, expiresAt, err := s.photos.LabelURL(ctx, transfer.FromWarehouseID, transfer.ReceiptFile)
	if err != nil {
		if connect.CodeOf(err) != connect.CodeNotFound {
			return nil, err
		}

		slog.WarnContext(ctx, "transfer label photo: the transfer names a photo document_service does not hold",
			"transfer_id", transfer.ID, "document_id", transfer.ReceiptFile)

		return nil, connect.NewError(connect.CodeFailedPrecondition, errTransferNoLabelPhoto)
	}

	return connect.NewResponse(&inventoryv1.WarehouseTransferLabelPhotoResponse{
		Url:           url,
		ExpiresAtUnix: expiresAt.Unix(),
	}), nil
}
