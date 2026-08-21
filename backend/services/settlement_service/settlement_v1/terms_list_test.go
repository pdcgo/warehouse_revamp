package settlement_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

func termsList(
	t *testing.T,
	svc *settlement_v1.Service,
	teamID uint64,
) *settlementv1.SettlementTermsListResponse {
	t.Helper()

	res, err := svc.SettlementTermsList(context.Background(),
		connect.NewRequest(&settlementv1.SettlementTermsListRequest{
			TeamId: teamID,
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
		}))
	if err != nil {
		t.Fatalf("SettlementTermsList(%d): %v", teamID, err)
	}

	return res.Msg
}

// termsRows digs the TERMS slice out of the response, keyed by counterparty_id.
func termsRows(msg *settlementv1.SettlementTermsListResponse) map[uint64]*settlementv1.SettlementTerms {
	for _, item := range msg.GetItems() {
		if terms, ok := item.GetD().(*settlementv1.SettlementTermsListResponseItem_Terms); ok {
			return terms.Terms.GetMapData()
		}
	}

	return nil
}

// THE LIST IS KEYED BY COUNTERPARTY, not by the row's surrogate id. The screen's question is "what do
// I charge THIS team", so the caller must be able to look the answer up by the only id it has.
func TestTermsList_IsKeyedByCounterparty(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	putTerms(t, svc, warehouse, selling, 12000, 2000, rupiah(50_000_000))

	rows := termsRows(termsList(t, svc, warehouse))

	row, ok := rows[selling]
	if !ok {
		t.Fatalf("no row keyed by counterparty %d, got keys %v", selling, rows)
	}

	if row.GetHandlingFee() != 12000 {
		t.Fatalf("handling_fee = %d, want 12000", row.GetHandlingFee())
	}
}

// THE DEFAULT ROW LEADS. `counterparty_id = 0` is the rate applying to every team without an
// override, so it is the first thing anybody needs to read — and it must not be mistaken for a
// missing value or sorted into the middle of the overrides.
func TestTermsList_DefaultRowComesFirst(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	putTerms(t, svc, warehouse, selling, 12000, 2000, nil)
	putTerms(t, svc, warehouse, 0, 9000, 1000, nil)

	ids := termsList(t, svc, warehouse).GetIds()

	if len(ids) != 2 {
		t.Fatalf("%d rows, want 2", len(ids))
	}

	if ids[0] != 0 {
		t.Fatalf("first id = %d, want 0 (the default row leads)", ids[0])
	}
}

// ⚠ UNLIMITED MUST SURVIVE THE ROUND TRIP AS ABSENT. If the mapper flattened NULL to 0, this screen
// would show "no credit at all" for every team that has never been limited — and a manager reading it
// would freeze nobody while believing everybody was frozen.
func TestTermsList_UnlimitedStaysAbsent(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	putTerms(t, svc, warehouse, selling, 12000, 2000, nil)
	putTerms(t, svc, warehouse, productOwner, 0, 0, rupiah(0))

	rows := termsRows(termsList(t, svc, warehouse))

	if rows[selling].CreditLimit != nil {
		t.Fatalf("unlimited read back as %d, want ABSENT", rows[selling].GetCreditLimit())
	}

	if rows[productOwner].CreditLimit == nil {
		t.Fatal("a limit of 0 read back as ABSENT — that is unlimited, the opposite of frozen")
	}
}

// THE SCOPE IS THE CREDITOR'S OWN BOOKS. `team_id` is the team that WROTE these rows; a debtor asking
// what it is charged is asking about somebody else's configuration and gets its own empty list.
func TestTermsList_ReadsOnlyYourOwnTerms(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	putTerms(t, svc, warehouse, selling, 12000, 2000, nil)

	msg := termsList(t, svc, selling)

	if len(msg.GetIds()) != 0 {
		t.Fatalf("the debtor read %d of the creditor's rows, want 0", len(msg.GetIds()))
	}
}
