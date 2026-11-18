package inventory_v1

import (
	"context"
	"log/slog"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockDoorPhotos implements [inventoryv1connect.RestockRequestServiceHandler].
//
// THE PHOTOS TAKEN AT THE DOOR, READ BACK (the-detail-pages-show-the-broken-photo,
// the-detail-pages-show-the-slip-and-the-broken-rack): the courier's slip and each line's broken units, as the receiving
// warehouse kept them at Terima. Both detail pages show them, so either side of the restock may ask — its selling team or
// the warehouse it is going to, RestockRequestDetail's two sides exactly; any other team reads NotFound, as an id that
// does not exist.
//
// The photos are the WAREHOUSE's uploads, so document_service is asked, in-process, through the label photo's own door
// (ReceiptPhotoLinker → document_v1.LabelURL) to sign each with the restock's warehouse as its owner — inventory's
// finding, never the browser's, so a document id alone opens nothing. No share is written. A photo the warehouse no
// longer holds (removed, never confirmed) is left out of the answer and logged; a restock with none answers empty.
func (s *Service) RestockDoorPhotos(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockDoorPhotosRequest],
) (*connect.Response[inventoryv1.RestockDoorPhotosResponse], error) {
	if s.photos == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errNoReceiptPhotoLinker)
	}

	teamID := req.Msg.GetTeamId()

	var restocks []inventory_service_models.Restock

	// THE CHECK: the caller is a side of the restock — the raising team or the receiving warehouse. Find, not First —
	// an empty answer is NotFound below.
	err := s.db.
		WithContext(ctx).
		Select("id", "team_id", "warehouse_id", "warehouse_additional_cost_file").
		Where("id = ? AND (team_id = ? OR warehouse_id = ?)", req.Msg.GetRequestId(), teamID, teamID).
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

	// Each line's broken row that kept a photo — one row per line and kind, so one photo per line.
	var broken []inventory_service_models.RestockProblemItem

	err = s.db.
		WithContext(ctx).
		Select("product_id", "photo_file").
		Where("restock_id = ? AND problem_type = ? AND photo_file <> ''", restock.ID, restockProblemBroken).
		Order("product_id ASC").
		Find(&broken).
		Error
	if err != nil {
		return nil, restockErr(err)
	}

	out := &inventoryv1.RestockDoorPhotosResponse{}

	var expiresAt time.Time

	// sign links one photo for its owner, the restock's warehouse; "" when the file is gone.
	sign := func(documentID string) (string, error) {
		url, expiry, signErr := s.photos.LabelURL(ctx, restock.WarehouseID, documentID)
		if signErr != nil {
			if connect.CodeOf(signErr) != connect.CodeNotFound {
				return "", signErr
			}

			slog.WarnContext(ctx, "restock door photos: the restock names a photo document_service does not hold",
				"restock_id", restock.ID, "document_id", documentID)

			return "", nil
		}

		if expiresAt.IsZero() || expiry.Before(expiresAt) {
			expiresAt = expiry
		}

		return url, nil
	}

	if restock.WarehouseAdditionalCostFile != "" {
		out.CourierSlipUrl, err = sign(restock.WarehouseAdditionalCostFile)
		if err != nil {
			return nil, err
		}
	}

	for i := range broken {
		url, signErr := sign(broken[i].PhotoFile)
		if signErr != nil {
			return nil, signErr
		}

		if url == "" {
			continue
		}

		out.Broken = append(out.Broken, &inventoryv1.RestockBrokenPhoto{
			ProductId: broken[i].ProductID,
			Url:       url,
		})
	}

	if !expiresAt.IsZero() {
		out.ExpiresAtUnix = expiresAt.Unix()
	}

	return connect.NewResponse(out), nil
}
