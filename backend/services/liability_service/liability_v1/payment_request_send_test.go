package liability_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

const (
	bekasi uint64 = 11 // a warehouse, owed
	tokoA  uint64 = 12 // a selling team, owing
)

func askToPay(svc *liability_v1.Service, creditor, debtor uint64) (*liabilityv1.LiabilityPaymentRequest, error) {
	res, err := svc.LiabilityPaymentRequestSend(context.Background(), connect.NewRequest(&liabilityv1.LiabilityPaymentRequestSendRequest{
		TeamId: creditor, DebtorTeamId: debtor,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetRequest(), nil
}

// requestOn is the open request the position read carries for one counterparty, as `team` sees it.
func requestOn(t *testing.T, svc *liability_v1.Service, team, counterparty uint64) *liabilityv1.LiabilityPaymentRequest {
	t.Helper()

	for _, p := range positionRows(positions(t, svc, team, false)) {
		if p.GetCounterpartyId() == counterparty {
			return p.GetPaymentRequest()
		}
	}

	t.Fatalf("no position for %d on %d's balance", counterparty, team)

	return nil
}

// THE DECISION'S EXAMPLE (a-creditor-may-request-payment): Gudang Bekasi is owed Rp 700.000 by Toko A and asks — the
// request carries the moment's figure, BOTH sides see it on the pair, and it moves NOTHING: the balance is unchanged.
func TestPaymentRequest_IsANoticeThatMovesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	debtTo(t, svc, db, tokoA, bekasi, 700_000, 1)

	got, err := askToPay(svc, bekasi, tokoA)
	if err != nil {
		t.Fatalf("ask: %v", err)
	}

	if got.GetAmount() != 700_000 || got.GetCreditorTeamId() != bekasi || got.GetDebtorTeamId() != tokoA {
		t.Fatalf("request = %+v, want Bekasi asking Toko A for 700.000", got)
	}

	if r := requestOn(t, svc, tokoA, bekasi); r.GetAmount() != 700_000 {
		t.Fatalf("Toko A's balance shows %+v, want the request for 700.000", r)
	}

	if r := requestOn(t, svc, bekasi, tokoA); r.GetAmount() != 700_000 {
		t.Fatalf("Bekasi's balance shows %+v, want its own request", r)
	}

	if o := owed(t, db, tokoA, bekasi); o != 700_000 {
		t.Fatalf("Toko A owes %d after the request, want 700.000 — a request posts nothing", o)
	}
}

// Sending again REPLACES the request with the moment's figure; recording a payment ANSWERS it.
func TestPaymentRequest_IsReplacedAndClearedByAPayment(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	debtTo(t, svc, db, tokoA, bekasi, 700_000, 1)

	_, err := askToPay(svc, bekasi, tokoA)
	if err != nil {
		t.Fatalf("first ask: %v", err)
	}

	debtTo(t, svc, db, tokoA, bekasi, 100_000, 2)

	again, err := askToPay(svc, bekasi, tokoA)
	if err != nil || again.GetAmount() != 800_000 {
		t.Fatalf("second ask = %+v (%v), want the moment's 800.000", again, err)
	}

	recordPayment(t, svc, tokoA, bekasi, 800_000)

	if r := requestOn(t, svc, tokoA, bekasi); r != nil {
		t.Fatalf("the request is still open after Toko A paid: %+v", r)
	}
}

// Nothing owed, nothing to ask for: a square pair, the wrong way round, or oneself.
func TestPaymentRequest_RefusesWhenNothingIsOwed(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	debtTo(t, svc, db, tokoA, bekasi, 700_000, 1)

	for name, c := range map[string]struct {
		creditor, debtor uint64
		want             connect.Code
	}{
		"the debtor asking the creditor": {tokoA, bekasi, connect.CodeFailedPrecondition},
		"a pair with no balance":         {bekasi, 99, connect.CodeFailedPrecondition},
		"oneself":                        {bekasi, bekasi, connect.CodeInvalidArgument},
	} {
		_, err := askToPay(svc, c.creditor, c.debtor)
		if connect.CodeOf(err) != c.want {
			t.Fatalf("%s: %v, want %v", name, err, c.want)
		}
	}
}
