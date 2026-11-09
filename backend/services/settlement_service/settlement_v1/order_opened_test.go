package settlement_v1_test

import (
	"context"
	"errors"
	"testing"
	"time"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// a-missing-account-is-found-by-its-opened-at — settlement tells the order its account OPENED, through the
// OrderOpenedMarker seam, after the first `initial_total` commits; never on any other row, and never fatally.

type stamp struct {
	order uint64
	at    time.Time
}

// fakeOpened is the order service's SettlementOpened: it records every stamp, or fails each one.
type fakeOpened struct {
	stamps []stamp
	err    error
}

func (f *fakeOpened) SettlementOpened(_ context.Context, orderID uint64, openedAt time.Time) error {
	f.stamps = append(f.stamps, stamp{order: orderID, at: openedAt})

	return f.err
}

// THE PLACEMENT STAMPS THE ORDER, at the moment its opening row was written; a redelivery stamps the SAME moment again
// (the order side keeps the first), and the cancel stamps nothing.
func TestOrderOpened_ThePlacementStampsTheOpeningRowsMoment(t *testing.T) {
	db := san_testdb.DB(t)
	opened := &fakeOpened{}
	svc := settlement_v1.NewService(db, nil, nil, nil, opened, nil, nil)

	deliver(t, svc, placedEvent(sale))
	deliver(t, svc, placedEvent(sale)) // redelivered

	rows := orderRows(t, db, "initial_total")
	if len(rows) != 1 {
		t.Fatalf("%d initial_total rows, want 1", len(rows))
	}

	if len(opened.stamps) != 2 {
		t.Fatalf("stamps = %v, want the opening and its redelivery", opened.stamps)
	}

	for _, s := range opened.stamps {
		if s.order != order || !s.at.Equal(rows[0].CreatedAt) {
			t.Fatalf("stamp %+v, want order %d at the row's %v", s, order, rows[0].CreatedAt)
		}
	}

	deliver(t, svc, cancelledEvent(placedAt.Add(time.Hour)))

	if len(opened.stamps) != 2 {
		t.Fatalf("the cancel stamped the order: %v", opened.stamps)
	}
}

// AN OPENING BY HAND STAMPS IT TOO — the repair on the order page (a-missing-account-is-fixed-by-hand) is what clears
// the order from the "not opened" list. Any other row on the order (a fund) stamps nothing.
func TestOrderOpened_AnOpeningByHandStampsAndOtherRowsDoNot(t *testing.T) {
	db := san_testdb.DB(t)
	opened := &fakeOpened{}
	svc := settlement_v1.NewService(db, nil, nil, nil, opened, nil, nil)

	_, err := post(t, svc, settlement_v1.PostInput{
		UniqueID:       "fund-before-any-sale",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         10_000,
	})
	if err != nil {
		t.Fatalf("fund: %v", err)
	}

	if len(opened.stamps) != 0 {
		t.Fatalf("a fund stamped the order: %v", opened.stamps)
	}

	byHand := initialTotal("order-5001-by-hand")
	byHand.SourceType = settlementv1.SourceType_SOURCE_TYPE_MANUAL

	_, err = post(t, svc, byHand)
	if err != nil {
		t.Fatalf("initial_total by hand: %v", err)
	}

	if len(opened.stamps) != 1 || opened.stamps[0].order != order {
		t.Fatalf("stamps = %v, want the order stamped once by the hand opening", opened.stamps)
	}
}

// A FAILED STAMP IS NEVER THE POST'S FAILURE: the opening is committed and the event acknowledged — the order simply
// keeps reading "not opened", the safe side, until the same post is retried.
func TestOrderOpened_AFailedStampLeavesTheOpeningCommitted(t *testing.T) {
	db := san_testdb.DB(t)
	opened := &fakeOpened{err: errors.New("the order service is down")}
	svc := settlement_v1.NewService(db, nil, nil, nil, opened, nil, nil)

	deliver(t, svc, placedEvent(sale)) // deliver fails the test on any error

	if rows := orderRows(t, db, "initial_total"); len(rows) != 1 {
		t.Fatalf("%d initial_total rows, want the opening committed", len(rows))
	}

	if len(opened.stamps) != 1 {
		t.Fatalf("stamps = %v, want the one attempt", opened.stamps)
	}
}
