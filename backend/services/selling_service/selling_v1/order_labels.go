package selling_v1

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_pdf_merge"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// LabelLinker reaches an order's label file in document_service — behind an interface this service owns, so
// selling_service never imports document_service (see the composition root's order_label_linker.go). It is asked only
// AFTER OrderLabels has checked each order ships from the caller's warehouse, and it is told the label's OWNER — the
// order's selling team — so a document id alone opens nothing.
type LabelLinker interface {
	// LabelURL signs a link to one label. A label that is not there for that owner (removed, never confirmed, another
	// type) answers connect NotFound.
	LabelURL(ctx context.Context, ownerTeamID uint64, documentID string) (url string, expiresAt time.Time, err error)
	// LabelFiles reads the asked labels' bytes, keyed by document id. A label that is not there for its owner is absent;
	// one whose row is there but whose bytes cannot be read comes back with nil Content.
	LabelFiles(ctx context.Context, labels []LabelRef) (map[string]LabelFile, error)
	// StoreOrderLabels stores the merged labels as a private document of the warehouse and signs its link.
	StoreOrderLabels(ctx context.Context, teamID uint64, filename string, content []byte) (url string, expiresAt time.Time, err error)
}

// LabelRef is one label to read: the document, and the team that owns it.
type LabelRef struct {
	OwnerTeamID uint64
	DocumentID  string
}

// LabelFile is one label's bytes and stored type. Content nil = the file is there but cannot be read.
type LabelFile struct {
	Content  []byte
	MimeType string
}

var errNoLabelLinker = errors.New("order labels are not wired on this server")

// OrderLabels implements [sellingv1connect.OrderServiceHandler].
//
// THE LABELS A WAREHOUSE PRINTS (a-warehouse-prints-the-labels-of-orders-it-ships): the order service checks each
// order ships from the caller's warehouse — its `warehouse_id` is the scope — and only then asks document_service, under
// its own identity, for the label. The warehouse never meets the document's owner check, and no label is shared
// document by document. The root team opens any order's label (readsEveryTeam).
//
//   - ONE id is the same call as ever: the link is that order's own file, as it was uploaded (a picture stays a
//     picture, and it downloads under its own name).
//   - SEVERAL are merged into ONE PDF, in the order of the ids (the list's order): a PDF label adds its pages, a label
//     photo one page. The PDF is stored as a private ORDER_LABELS document of the caller's team and the link is that.
//     Two orders naming the same file print it once.
//
// Every asked order gets a result: included, NOT_SHIPPED_HERE (another warehouse's, or no such order — the two read
// alike, so ids cannot be probed), NO_LABEL (none attached, or the file is gone) or UNREADABLE (a file the merge cannot
// read — broken, not a PDF or a picture, or missing from storage). A refusal never blocks the rest, and a hostile file
// cannot crash the service (san_pdf_merge recovers per file).
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

	// The orders whose label is to be fetched, in the asked order.
	labelled := make([]*selling_service_models.Order, 0, len(ids))
	results := make(map[uint64]*sellingv1.OrderLabelResult, len(ids))

	for _, id := range ids {
		result := &sellingv1.OrderLabelResult{OrderId: id}
		res.Results = append(res.Results, result)
		results[id] = result

		order := byID[id]

		switch {
		case order == nil:
			result.Reason = sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NOT_SHIPPED_HERE
		case order.ReceiptDocumentID == "":
			result.Reason = sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NO_LABEL
		default:
			labelled = append(labelled, order)
		}
	}

	if len(labelled) == 0 {
		return connect.NewResponse(res), nil
	}

	if len(ids) == 1 {
		err = s.linkOneLabel(ctx, labelled[0], results[labelled[0].ID], res)
	} else {
		err = s.mergeLabels(ctx, teamID, labelled, results, res)
	}

	if err != nil {
		return nil, err
	}

	return connect.NewResponse(res), nil
}

// linkOneLabel is one asked order: the link is its own file.
func (s *Service) linkOneLabel(
	ctx context.Context,
	order *selling_service_models.Order,
	result *sellingv1.OrderLabelResult,
	res *sellingv1.OrderLabelsResponse,
) error {
	url, expiresAt, err := s.labels.LabelURL(ctx, order.TeamID, order.ReceiptDocumentID)
	if err != nil {
		if connect.CodeOf(err) != connect.CodeNotFound {
			return err
		}

		// The order names a file its seller no longer holds — no label, rather than a broken link.
		slog.WarnContext(ctx, "order labels: the order names a label document_service does not hold",
			"order_id", order.ID, "document_id", order.ReceiptDocumentID)

		result.Reason = sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NO_LABEL

		return nil
	}

	result.Included = true
	res.Url = url
	res.ExpiresAtUnix = expiresAt.Unix()

	return nil
}

// mergeLabels is several asked orders: their files, read once each, merged into one stored PDF.
func (s *Service) mergeLabels(
	ctx context.Context,
	teamID uint64,
	labelled []*selling_service_models.Order,
	results map[uint64]*sellingv1.OrderLabelResult,
	res *sellingv1.OrderLabelsResponse,
) error {
	refs := make([]LabelRef, 0, len(labelled))
	for _, order := range labelled {
		refs = append(refs, LabelRef{OwnerTeamID: order.TeamID, DocumentID: order.ReceiptDocumentID})
	}

	files, err := s.labels.LabelFiles(ctx, refs)
	if err != nil {
		return err
	}

	// One merge input per distinct file, in the order its first order was asked; every order naming it shares its fate.
	inputs := make([]san_pdf_merge.File, 0, len(labelled))
	inputOf := make(map[string]int, len(labelled))
	ordersOf := make([][]uint64, 0, len(labelled))

	for _, order := range labelled {
		file, ok := files[order.ReceiptDocumentID]
		if !ok {
			slog.WarnContext(ctx, "order labels: the order names a label document_service does not hold",
				"order_id", order.ID, "document_id", order.ReceiptDocumentID)

			results[order.ID].Reason = sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NO_LABEL

			continue
		}

		at, seen := inputOf[order.ReceiptDocumentID]
		if !seen {
			at = len(inputs)
			inputOf[order.ReceiptDocumentID] = at

			inputs = append(inputs, san_pdf_merge.File{Content: file.Content, MimeType: file.MimeType})
			ordersOf = append(ordersOf, nil)
		}

		ordersOf[at] = append(ordersOf[at], order.ID)
	}

	if len(inputs) == 0 {
		return nil
	}

	merged, outcome, err := san_pdf_merge.Merge(inputs)
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	for at, result := range outcome {
		for _, orderID := range ordersOf[at] {
			if result.Err != nil {
				slog.WarnContext(ctx, "order labels: a label file cannot be read", "order_id", orderID, "err", result.Err)

				results[orderID].Reason = sellingv1.OrderLabelReason_ORDER_LABEL_REASON_UNREADABLE

				continue
			}

			results[orderID].Included = true
		}
	}

	if merged == nil {
		return nil
	}

	filename := "labels-" + time.Now().In(wib).Format("2006-01-02-150405") + ".pdf"

	url, expiresAt, err := s.labels.StoreOrderLabels(ctx, teamID, filename, merged)
	if err != nil {
		return err
	}

	res.Url = url
	res.ExpiresAtUnix = expiresAt.Unix()

	return nil
}
