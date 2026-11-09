package inventory_v1

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// ReceiptPhotoLinker signs a link to a label photo — document_service's file, behind an interface this service owns,
// so inventory_service never imports document_service (see the composition root's restock_photo_linker.go). It is asked
// only AFTER the handler has checked the caller's right to it, and it is told the photo's OWNER, so a document id alone
// opens nothing:
//
//   - RestockReceiptPhoto — the restock is going to the caller's warehouse; the owner is the restock's selling team;
//   - WarehouseTransferLabelPhoto — the caller is a side of the transfer; the owner is the sending warehouse
//     (every-side-of-a-transfer-opens-its-label-photo).
//
// A photo that is not there for that owner (removed, never confirmed, another type) answers connect NotFound.
type ReceiptPhotoLinker interface {
	LabelURL(ctx context.Context, ownerTeamID uint64, documentID string) (url string, expiresAt time.Time, err error)
}

var (
	errNoReceiptPhotoLinker = errors.New("restock label photos are not wired on this server")
	// The restock names no photo, or names one its selling team no longer holds — said, not a broken link.
	errRestockNoReceiptPhoto = errors.New("this restock has no label photo")
)

// RestockReceiptPhoto implements [inventoryv1connect.RestockRequestServiceHandler].
//
// THE WAREHOUSE OPENS THE LABEL PHOTO (the-restocks-warehouse-opens-its-label-photo): the restock must be going to the
// caller's warehouse — its `warehouse_id` is the scope, as RestockRequestLabels — and only then is document_service
// asked, in-process, to sign the selling team's `receipt_file`. No share is written; any other warehouse's call reads
// NotFound, exactly as an id that does not exist. Root and the Administrator name the warehouse as team_id.
//
// A restock with no photo — none attached, or the file is gone — is FailedPrecondition "this restock has no label
// photo", so the screen can say why.
func (s *Service) RestockReceiptPhoto(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockReceiptPhotoRequest],
) (*connect.Response[inventoryv1.RestockReceiptPhotoResponse], error) {
	if s.photos == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errNoReceiptPhotoLinker)
	}

	var restocks []inventory_service_models.Restock

	// THE CHECK: the restock is going to this warehouse. Find, not First — an empty answer is NotFound below.
	err := s.db.
		WithContext(ctx).
		Select("id", "team_id", "warehouse_id", "receipt_file").
		Where("id = ? AND warehouse_id = ?", req.Msg.GetRequestId(), req.Msg.GetTeamId()).
		Limit(1).
		Find(&restocks).
		Error
	if err != nil {
		return nil, restockErr(err)
	}

	if len(restocks) == 0 {
		return nil, connect.NewError(connect.CodeNotFound, errRestockMissing)
	}

	restock := restocks[0]

	if restock.ReceiptFile == "" {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errRestockNoReceiptPhoto)
	}

	// The owner is the restock's selling team — inventory's finding, never the browser's.
	url, expiresAt, err := s.photos.LabelURL(ctx, restock.TeamID, restock.ReceiptFile)
	if err != nil {
		if connect.CodeOf(err) != connect.CodeNotFound {
			return nil, err
		}

		slog.WarnContext(ctx, "restock receipt photo: the restock names a photo document_service does not hold",
			"restock_id", restock.ID, "document_id", restock.ReceiptFile)

		return nil, connect.NewError(connect.CodeFailedPrecondition, errRestockNoReceiptPhoto)
	}

	return connect.NewResponse(&inventoryv1.RestockReceiptPhotoResponse{
		Url:           url,
		ExpiresAtUnix: expiresAt.Unix(),
	}), nil
}
