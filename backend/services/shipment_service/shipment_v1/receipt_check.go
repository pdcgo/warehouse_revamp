package shipment_v1

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/pdcgo/san_receipt_readers"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
)

// ReceiptCheck reads an uploaded shipping label and answers what it says (receipt-check-is-shipments).
//
// It READS and never VERIFIES (receipt-check-returns-what-the-library-reads): the answer is
// san_receipt_readers.Extract's ReceiptData, field for field, and comparing it with what a person typed is
// the order form's job — so nothing can refuse an order on it. It stores nothing and reads no table.
//
// Every answer the reader gives about the file is a RESULT in a successful response
// (a-label-outcome-is-a-result-not-an-error): a label not learned yet is normal, not a failure. So the handler's
// ONE error is about the server, never the file — two checks already running (receiptChecksAtOnce). The rest are
// the chain's: a malformed request is the validator's (the 2 MB `max_len`), a body over 3 MB is the transport's
// (register.go, receipt-check-caps-the-body-before-reading), and a caller with no token is the access
// interceptor's (receipt-check-needs-a-login).
func (s *Service) ReceiptCheck(
	ctx context.Context,
	req *connect.Request[shipmentv1.ReceiptCheckRequest],
) (*connect.Response[shipmentv1.ReceiptCheckResponse], error) {
	content := req.Msg.GetFileContent()

	// TWO AT ONCE, AND NO QUEUE (an-attached-file-is-up-to-15-mb-and-two-checks-run-at-once). A call that finds both
	// slots taken is refused NOW, before the reader sees a byte: the order form answers a failed check as "no check"
	// (checkLabel returns null) and the person types the numbers, so waiting would only make them wait for nothing.
	if !s.tryHoldCheck() {
		slog.WarnContext(ctx, "receipt check refused: two already running", slog.Int("size", len(content)))

		return nil, checksBusy()
	}

	started := time.Now()

	data, err := s.readLabel(content)
	result := labelResult(err)

	// ⚠ THE RESULT, NEVER THE READING (receipt-check-logs-only-the-result). The response carries a buyer's
	// name and address — harmless to the caller, who sent the file, but a log line would copy them into our
	// logs. Extract's error stays out too: its text can carry the PDF library's own message about the file.
	slog.InfoContext(ctx, "receipt check",
		slog.String("result", result.String()),
		slog.Int("size", len(content)),
		slog.Duration("took", time.Since(started)),
	)

	// Every field is "" unless the label was read — a file that is not a label fills nothing, and so
	// contradicts nothing on the form.
	if result != shipmentv1.ReceiptCheckResult_RECEIPT_CHECK_RESULT_READ {
		return connect.NewResponse(&shipmentv1.ReceiptCheckResponse{Result: result}), nil
	}

	return connect.NewResponse(&shipmentv1.ReceiptCheckResponse{
		Result:       result,
		Receipt:      data.Receipt,
		OrderRefId:   data.OrderID,
		CustomerName: data.CustomerName,
		Phone:        data.Phone,
		Address:      data.Address,
	}), nil
}

// receiptChecksAtOnce is how many label checks run at the same moment
// (an-attached-file-is-up-to-15-mb-and-two-checks-run-at-once).
//
// It exists because one check is cheap and one FILE is not: a real label reads in milliseconds, but the reader's
// page lookup is quadratic, and a 2 MB file of thousands of pages holds a core for over a minute
// (audits/services/shipment_service/performances/ReceiptCheck.md). Two such files cost two cores — never the rest
// of the system.
//
// ⚠ PER PROCESS. The slots live on the Service, and each instance of the API has its own.
const receiptChecksAtOnce = 2

var errChecksBusy = errors.New("two label checks are already running — try again in a moment")

// checksBusy is built per call: a *connect.Error carries a metadata map, and one shared value would be one map
// written by every refused call at once.
func checksBusy() error {
	return connect.NewError(connect.CodeResourceExhausted, errChecksBusy)
}

// tryHoldCheck takes a slot if one is free, and never waits for one.
func (s *Service) tryHoldCheck() bool {
	select {
	case s.checks <- struct{}{}:
		return true
	default:
		return false
	}
}

// readLabel runs the reader on a held slot and gives the slot back when the reader RETURNS — deferred, so a
// panic the reader did not catch cannot keep it forever.
//
// ⚠ NOT WHEN THE CALLER LEAVES. Extract takes no context, so a request cancelled mid-read — the person picked
// another file, or closed the tab — keeps its slot until Extract finishes on its own. That is the point of the
// limit, not a leak: the core is still busy, and the slot says so.
func (s *Service) readLabel(content []byte) (san_receipt_readers.ReceiptData, error) {
	defer func() { <-s.checks }()

	return s.extract(bytes.NewReader(content))
}

// labelResult is Extract's answer as the contract's result (a-label-outcome-is-a-result-not-an-error).
//
// The reader exports two errors and a file is never both (unreadable-and-not-a-label-are-two-errors).
// Anything else it says is "a label, and not one I know".
//
// ⚠ THAT INCLUDES A BULK PRINT. The reader's more-than-one-label error is unexported (receipt_readers
// critique 4), so it cannot be told apart from an unknown layout, and a file of several labels answers
// UNKNOWN_LABEL rather than MULTIPLE_LABELS — still safe, since nothing is filled either way. It becomes its
// own case here the day the reader exports that error.
func labelResult(err error) shipmentv1.ReceiptCheckResult {
	switch {
	case err == nil:
		return shipmentv1.ReceiptCheckResult_RECEIPT_CHECK_RESULT_READ
	case errors.Is(err, san_receipt_readers.ErrUnreadable):
		return shipmentv1.ReceiptCheckResult_RECEIPT_CHECK_RESULT_UNREADABLE
	case errors.Is(err, san_receipt_readers.ErrNotShippingLabel):
		return shipmentv1.ReceiptCheckResult_RECEIPT_CHECK_RESULT_NOT_SHIPPING_LABEL
	default:
		return shipmentv1.ReceiptCheckResult_RECEIPT_CHECK_RESULT_UNKNOWN_LABEL
	}
}
