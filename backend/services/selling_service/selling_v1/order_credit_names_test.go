package selling_v1_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// THE CREDIT REFUSAL NAMES ITS CREDITOR BY NAME (over-the-limit-refuses-the-create): it names WHICH creditor, what is
// owed and the limit, because the person who hits it is customer service, who cannot look a team's number up. The name
// comes through the TeamNamer seam the return-warehouse refusal uses, with the same "team #<id>" fallback. Team 900 is
// the blocking creditor, team 2 the ordering team.

// creditNamesBlock is creditor 900 holding the seller at 52.000.000 of a 50.000.000 limit.
func creditNamesBlock() *fakeCredit {
	return &fakeCredit{
		block: &selling_v1.CreditBlock{CreditorTeamID: 900, Debt: 52_000_000, Limit: 50_000_000},
	}
}

// failingNames is a team_service that cannot be reached.
type failingNames struct{}

func (failingNames) TeamNames(context.Context, []uint64) (map[uint64]string, error) {
	return nil, errors.New("team_service unavailable")
}

func creditRefusal(t *testing.T, db *gorm.DB, names selling_v1.TeamNamer) string {
	t.Helper()

	svc := selling_v1.NewService(db, &fakePicker{}, nil, &fakeCatalog{}, creditNamesBlock(), everyoneMayWrite{}, nil, nil,
		nil, nil, names)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	cerr := wantCode(t, err, connect.CodeFailedPrecondition)

	return cerr.Message()
}

// The creditor by its name — not the ordering team's, not its number — with the debt and the limit as before.
func TestOrderCreate_CreditBlockNamesTheCreditorByItsName(t *testing.T) {
	db := san_testdb.DB(t)

	got := creditRefusal(t, db, fakeNames{2: "Toko Melati", 900: "Gudang Pusat"})

	want := "credit limit reached with Gudang Pusat: Rp 52.000.000 owed of a Rp 50.000.000 limit — settle before " +
		"ordering again"
	if got != want {
		t.Fatalf("message %q, want %q — the creditor named as customer service knows it", got, want)
	}
}

// When the creditor cannot be named — no namer wired, the lookup failed, the team unknown — the sentence still names
// it, by its id, as the return-warehouse refusal does. The refusal is never held up by its name.
func TestOrderCreate_CreditBlockNamesTheCreditorByIdWhenItCannotBeNamed(t *testing.T) {
	want := "credit limit reached with team #900: Rp 52.000.000 owed of a Rp 50.000.000 limit — settle before " +
		"ordering again"

	cases := []struct {
		name  string
		names selling_v1.TeamNamer
	}{
		{"no namer", nil},
		{"the lookup failed", failingNames{}},
		{"an unknown team", fakeNames{2: "Toko Melati"}},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			db := san_testdb.DB(t)

			got := creditRefusal(t, db, c.names)
			if got != want {
				t.Fatalf("message %q, want %q", got, want)
			}
		})
	}
}
