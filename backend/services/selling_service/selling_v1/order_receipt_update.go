package selling_v1

import (
	"context"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

var (
	// errReceiptNothingAsked is a request that names neither the number nor the file.
	errReceiptNothingAsked = errors.New("say what to change — the tracking number, the label file, or both")
	// errReceiptFrozen is an edit once the courier has the parcel (the-seller-edits-the-resi-until-handover).
	errReceiptFrozen = errors.New("the tracking number is fixed once the parcel is handed to the courier — " +
		"a different number is a different parcel")
)

// receiptEditable is where Edit Resi is offered: the parcel is still in the building. From shipping on the courier has
// scanned the number, and a cancelled order ships nothing.
var receiptEditable = map[string]bool{
	orderStatusPending:   true,
	orderStatusProcessed: true,
	orderStatusPicked:    true,
}

// OrderReceiptUpdate is EDIT RESI (the-seller-edits-the-resi-until-handover): the selling team replaces the tracking
// number (`orders.receipt`), the label file (`receipt_document_id` and its two labels), or both — each on its own, and
// nothing else on the order.
//
// SCOPED TO THE SELLING TEAM. loadScopedOrder's `team_id` clause is the scope check, so the order's warehouse reads
// NotFound like any other team: the marketplace issues the number on the seller's label, and the warehouse does not
// edit it.
//
// THE ROW LOCK is what makes the status gate true at the write. A handover (picked → shipping, OrderStatusChange)
// locks the same row, so either the edit commits first and the parcel ships with the new number, or the handover
// does and the edit is refused — never an edit written onto a parcel the courier already has. Two edits at once
// queue the same way, and the second one's note names the first one's value as its old.
//
// THE RECORD is a note row — no status, from `selling` — naming the old and the new. Not a status row: the status
// did not move, and a row into the current status would reset the list's status date (Order.status_at_unix).
// A request that names only what is already there writes nothing.
func (s *Service) OrderReceiptUpdate(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderReceiptUpdateRequest],
) (*connect.Response[sellingv1.OrderReceiptUpdateResponse], error) {
	if req.Msg.ReceiptCode == nil && req.Msg.Receipt == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errReceiptNothingAsked)
	}

	var order selling_service_models.Order

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := loadScopedOrder(tx, req.Msg.GetTeamId(), req.Msg.GetOrderId(), &order)
		if loadErr != nil {
			return loadErr
		}

		if !receiptEditable[order.Status] {
			return errReceiptFrozen
		}

		changes := map[string]any{}
		notes := []string{}

		if req.Msg.ReceiptCode != nil && req.Msg.GetReceiptCode() != order.Receipt {
			code := req.Msg.GetReceiptCode()
			changes["receipt"] = code
			notes = append(notes, "Resi: "+orBlank(order.Receipt)+" → "+orBlank(code))
			order.Receipt = code
		}

		if req.Msg.Receipt != nil && req.Msg.GetReceipt().GetDocumentId() != order.ReceiptDocumentID {
			file := req.Msg.GetReceipt()
			// A removed file takes its labels with it, so a row never names a file it no longer has.
			filename, mimeType := file.GetFilename(), file.GetMimeType()
			if file.GetDocumentId() == "" {
				filename, mimeType = "", ""
			}

			changes["receipt_document_id"] = file.GetDocumentId()
			changes["receipt_filename"] = filename
			changes["receipt_mime_type"] = mimeType
			notes = append(notes, "Label: "+orBlank(order.ReceiptFilename)+" → "+orBlank(filename))
			order.ReceiptDocumentID, order.ReceiptFilename, order.ReceiptMimeType = file.GetDocumentId(), filename, mimeType
		}

		if len(changes) == 0 {
			return nil
		}

		now := time.Now()
		changes["updated_at"] = now

		updateErr := tx.
			Model(&selling_service_models.Order{}).
			Where("id = ?", order.ID).
			Updates(changes).
			Error
		if updateErr != nil {
			return updateErr
		}

		order.UpdatedAt = now

		return recordTimelineLogs(tx, []selling_service_models.OrderTimelineLog{{
			OrderID: order.ID,
			// No status: the edit moves nothing.
			Status:    "",
			Note:      strings.Join(notes, " · "),
			From:      timelineFromSelling,
			ActorID:   eventActor(ctx),
			CreatedAt: now,
		}})
	})
	if err != nil {
		if errors.Is(err, errReceiptFrozen) {
			return nil, connect.NewError(connect.CodeFailedPrecondition, err)
		}

		return nil, mapOrderErr(err)
	}

	return connect.NewResponse(&sellingv1.OrderReceiptUpdateResponse{Order: orderToProto(&order)}), nil
}

// orBlank is how an empty value reads in a note: a dash, so "— → JNE123" says it was added.
func orBlank(value string) string {
	if value == "" {
		return "—"
	}

	return value
}
