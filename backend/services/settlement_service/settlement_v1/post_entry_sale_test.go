package settlement_v1_test

import (
	"context"
	"errors"
	"strconv"
	"testing"

	"connectrpc.com/connect"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// captureEvents records every event the service publishes, and still validates each one.
type captureEvents struct {
	sent []*eventsv1.Event
}

func (c *captureEvents) send(ctx context.Context, identity *role_basev1.Identity, event *eventsv1.Event) error {
	c.sent = append(c.sent, event)

	return event_source.EmptySender(ctx, identity, event)
}

func cancelInput(uniqueID string) settlement_v1.CancelInput {
	return settlement_v1.CancelInput{
		TeamID:     team,
		ShopID:     shop,
		OrderID:    order,
		UniqueID:   uniqueID,
		OccurredOn: "2026-08-29",
	}
}

// ⚠ A SECOND LIVE SALE ADDS RATHER THAN REPLACES, so the account refuses it — the form hiding the
// option is a convenience, and manual posting is the repair path (#a-missing-account-is-fixed-by-hand).
func TestSettlementPost_RefusesASecondLiveSale(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil)

	_, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("first sale: %v", err)
	}

	_, err = post(t, svc, initialTotal("order-5001-initial-again"))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("second live sale: got %v, want FailedPrecondition", err)
	}
}

// Reverse-then-repost is how a wrong sale figure is corrected, and the reversal is what takes the live
// sale down — so the guard must let the repost through once it has.
func TestSettlementPost_ReverseThenRepostCorrectsTheSale(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil)

	wrong, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("sale: %v", err)
	}

	_, err = post(t, svc, settlement_v1.PostInput{
		UniqueID:       "reverse-initial",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         sale,
		ReversesID:     wrong.Entry.ID,
	})
	if err != nil {
		t.Fatalf("reversal: %v", err)
	}

	fixed, err := post(t, svc, settlement_v1.PostInput{
		UniqueID:       "repost-initial",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         -110_000,
	})
	if err != nil {
		t.Fatalf("repost after reversal: %v", err)
	}

	if fixed.State.InitialTotal != 110_000 {
		t.Fatalf("live sale = %d, want 110000", fixed.State.InitialTotal)
	}
}

// ⚠ THE CANCEL UNDOES THE LIVE SALE, NOT THE ORDER'S ORIGINAL FIGURE. After a person corrected 120.000
// to 110.000, cancelling by the order's number would leave a live sale of −10.000.
func TestCancelSale_TakesTheAmountFromTheLiveSale(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil)

	wrong, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("sale: %v", err)
	}

	_, err = post(t, svc, settlement_v1.PostInput{
		UniqueID:       "reverse-initial",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         sale,
		ReversesID:     wrong.Entry.ID,
	})
	if err != nil {
		t.Fatalf("reversal: %v", err)
	}

	_, err = post(t, svc, settlement_v1.PostInput{
		UniqueID:       "repost-initial",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         -110_000,
	})
	if err != nil {
		t.Fatalf("repost: %v", err)
	}

	cancelled, err := svc.CancelSale(context.Background(), cancelInput("order-5001-cancel"))
	if err != nil {
		t.Fatalf("CancelSale: %v", err)
	}

	if cancelled.Entry.Change != 110_000 {
		t.Fatalf("cancel change = %d, want +110000 — the LIVE sale", cancelled.Entry.Change)
	}

	if cancelled.State.InitialTotal != 0 || cancelled.State.LastBalance != 0 {
		t.Fatalf("after cancel: live sale %d, balance %d — want 0 and 0",
			cancelled.State.InitialTotal, cancelled.State.LastBalance)
	}

	if cancelled.Entry.SourceType != "order" {
		t.Fatalf("cancel source = %q, want order", cancelled.Entry.SourceType)
	}
}

// A cancel with nothing live to undo is a normal answer, and it must leave NO account behind — an
// empty account would read as a settlement nobody performed.
func TestCancelSale_WithNoLiveSaleOpensNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil)

	_, err := svc.CancelSale(context.Background(), cancelInput("order-5001-cancel"))
	if !errors.Is(err, settlement_v1.ErrNothingToCancel) {
		t.Fatalf("cancel of nothing: got %v, want ErrNothingToCancel", err)
	}

	_, err = svc.OrderSettlementDetail(context.Background(), connect.NewRequest(&settlementv1.OrderSettlementDetailRequest{
		TeamId:  team,
		OrderId: order,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("account after a refused cancel: got %v, want NotFound", err)
	}
}

// ⚠ THE DANGEROUS RETRY. A cancel retried after it landed must return the row it wrote — not be
// refused because the sale is now zero, and never credit the account a second time.
func TestCancelSale_RetryIsAbsorbed(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil)

	_, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("sale: %v", err)
	}

	first, err := svc.CancelSale(context.Background(), cancelInput("order-5001-cancel"))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	again, err := svc.CancelSale(context.Background(), cancelInput("order-5001-cancel"))
	if err != nil {
		t.Fatalf("retried cancel: %v", err)
	}

	if again.Created || again.Entry.ID != first.Entry.ID {
		t.Fatalf("retry wrote a new row (created=%v, id %d vs %d)", again.Created, again.Entry.ID, first.Entry.ID)
	}

	if again.State.LastBalance != 0 {
		t.Fatalf("balance after retry = %d, want 0", again.State.LastBalance)
	}
}

// SET ONCE, by the post that opens the account. A later post naming someone else must not re-attribute
// the order's sales — and an account opened unattributed stays unattributed, or a replay would disagree
// with the live fold that already ran.
func TestSettlementPost_TheCreatorIsStampedOnlyByTheOpeningPost(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil)

	opening := initialTotal("order-5001-initial")
	opening.CreatedByUserID = 7

	_, err := post(t, svc, opening)
	if err != nil {
		t.Fatalf("sale: %v", err)
	}

	later, err := post(t, svc, settlement_v1.PostInput{
		UniqueID:        "fund-1",
		SettlementType:  settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
		SourceType:      settlementv1.SourceType_SOURCE_TYPE_EXPORTER,
		Change:          arrived,
		CreatedByUserID: 9,
	})
	if err != nil {
		t.Fatalf("fund: %v", err)
	}

	if later.State.CreatedByUserID != 7 {
		t.Fatalf("creator = %d after a later post named 9, want 7", later.State.CreatedByUserID)
	}
}

// The published event IS the row, whole, plus the order's creator — and its posted_on is the day the
// DATABASE stored, because that is the day the fold buckets on.
func TestSettlementPost_PublishesTheCommittedRow(t *testing.T) {
	db := san_testdb.DB(t)
	capture := &captureEvents{}
	svc := settlement_v1.NewService(db, capture.send, nil)

	opening := initialTotal("order-5001-initial")
	opening.CreatedByUserID = 7

	result, err := post(t, svc, opening)
	if err != nil {
		t.Fatalf("sale: %v", err)
	}

	if len(capture.sent) != 1 {
		t.Fatalf("published %d events, want 1", len(capture.sent))
	}

	event := capture.sent[0]
	posted := event.GetSettlementLogPosted()

	if event.GetEventId() != "settlement-log:"+itoa(result.Entry.ID) {
		t.Fatalf("event_id = %q — must be derived from the row", event.GetEventId())
	}

	if posted.GetChange() != -sale || posted.GetOrderCreatedByUserId() != 7 || posted.GetOrderId() != order {
		t.Fatalf("event body does not carry the row: %+v", posted)
	}

	var stored string

	err = db.Raw("SELECT to_char(posted_on, 'YYYY-MM-DD') FROM settlement_logs WHERE id = ?", result.Entry.ID).
		Scan(&stored).
		Error
	if err != nil {
		t.Fatalf("read posted_on: %v", err)
	}

	if posted.GetPostedOn() != stored {
		t.Fatalf("event posted_on = %q, stored %q — two calendars for one row", posted.GetPostedOn(), stored)
	}

	// A retried post republishes the SAME id — the repair for a publish that failed the first time.
	_, err = post(t, svc, opening)
	if err != nil {
		t.Fatalf("retry: %v", err)
	}

	if len(capture.sent) != 2 || capture.sent[1].GetEventId() != event.GetEventId() {
		t.Fatalf("a retry must republish the same event_id")
	}
}

func itoa(v uint64) string {
	return strconv.FormatUint(v, 10)
}
