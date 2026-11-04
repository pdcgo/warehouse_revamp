package selling_v1

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// LabelLinker signs a link to an order's label file — document_service's, behind an interface this service owns, so
// selling_service never imports document_service (see the composition root's order_label_linker.go). It is asked
// only AFTER OrderLabels has checked the order ships from the caller's warehouse, and it is told the label's OWNER —
// the order's selling team — so a document id alone opens nothing.
//
// A label that is not there for that owner (removed, never confirmed, another type) answers connect NotFound.
type LabelLinker interface {
	LabelURL(ctx context.Context, ownerTeamID uint64, documentID string) (url string, expiresAt time.Time, err error)
}

var errNoLabelLinker = errors.New("order labels are not wired on this server")

// OrderLabels implements [sellingv1connect.OrderServiceHandler].
//
// THE LABELS A WAREHOUSE PRINTS (a-warehouse-prints-the-labels-of-orders-it-ships): the order service checks each
// order ships from the caller's warehouse — its `warehouse_id` is the scope — and only then asks document_service, under
// its own identity, for the label's link. The warehouse never meets the document's owner check, and no label is shared
// document by document. The root team opens any order's label (readsEveryTeam).
//
// Every asked order gets a result: included, NOT_SHIPPED_HERE (another warehouse's, or no such order — the two read
// alike, so ids cannot be probed) or NO_LABEL (none attached, or the file is gone).
//
// ⚠ STEP 1: ONE ORDER (the request's max_items). Several, merged into one PDF, is step 2.
func (s *Service) OrderLabels(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderLabelsRequest],
) (*connect.Response[sellingv1.OrderLabelsResponse], error) {
	if s.labels == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errNoLabelLinker)
	}

	ids := req.Msg.GetOrderIds()
	teamID := req.Msg.GetTeamId()

	query := s.db.
		WithContext(ctx).
		Model(&selling_service_models.Order{}).
		Select("id", "team_id", "warehouse_id", "receipt_document_id").
		Where("id IN ?", ids)

	if !readsEveryTeam(teamID) {
		// THE CHECK: the order ships from this warehouse.
		query = query.Where("warehouse_id = ?", teamID)
	}

	var orders []selling_service_models.Order

	err := query.
		Find(&orders).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	byID := make(map[uint64]*selling_service_models.Order, len(orders))
	for i := range orders {
		byID[orders[i].ID] = &orders[i]
	}

	res := &sellingv1.OrderLabelsResponse{Results: make([]*sellingv1.OrderLabelResult, 0, len(ids))}

	for _, id := range ids {
		result := &sellingv1.OrderLabelResult{OrderId: id}
		res.Results = append(res.Results, result)

		order := byID[id]

		switch {
		case order == nil:
			result.Reason = sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NOT_SHIPPED_HERE

			continue
		case order.ReceiptDocumentID == "":
			result.Reason = sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NO_LABEL

			continue
		}

		// Step 1 has one order, so its link is the link. Step 2 merges the included files instead.
		url, expiresAt, linkErr := s.labels.LabelURL(ctx, order.TeamID, order.ReceiptDocumentID)
		if linkErr != nil {
			if connect.CodeOf(linkErr) != connect.CodeNotFound {
				return nil, linkErr
			}

			// The order names a file its seller no longer holds — no label, rather than a broken link.
			slog.WarnContext(ctx, "order labels: the order names a label document_service does not hold",
				"order_id", order.ID, "document_id", order.ReceiptDocumentID)

			result.Reason = sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NO_LABEL

			continue
		}

		result.Included = true
		res.Url = url
		res.ExpiresAtUnix = expiresAt.Unix()
	}

	return connect.NewResponse(res), nil
}
