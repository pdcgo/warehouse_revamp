package settlement_v1_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// settlement-and-expense-ask-the-shop-first, settlement's half: a SHOP-ADDRESSED row asks the shop whether it is the
// team's before it is written, so no team opens — or writes on — another team's shop account. Another team's shop, or
// one that does not exist, answers NotFound and nothing is written. Who in the team may post is unchanged.
//
// The real ShopAccessCheck (closed shops included) is exercised end to end in
// backend/cmd/app_development/settlement_shop_scope_test.go; here the shop is a stub that knows whose shop is whose.

const (
	scopeTeamA uint64 = 2
	scopeTeamB uint64 = 3
	// Team A's and team B's own shops, and one nobody has.
	scopeShopA       uint64 = 61
	scopeShopB       uint64 = 62
	scopeShopUnknown uint64 = 69
)

// teamShops answers as ShopAccessCheck does: a shop of the asking team is answered with its primary CS, any other —
// another team's, or none at all — is NotFound.
type teamShops struct {
	owner map[uint64]uint64
	asked int
}

func newTeamShops() *teamShops {
	return &teamShops{owner: map[uint64]uint64{scopeShopA: scopeTeamA, scopeShopB: scopeTeamB}}
}

func (s *teamShops) PrimaryUser(_ context.Context, teamID, shopID, _ uint64) (uint64, error) {
	s.asked++

	if s.owner[shopID] != teamID {
		return 0, connect.NewError(connect.CodeNotFound, errors.New("shop not found"))
	}

	return shopPrimaryCS, nil
}

// handShopRow is a shop row a person posts — SettlementPost's manual source, a withdrawal-like movement.
func handShopRow(teamID, shopID uint64, uniqueID string, change float64) settlement_v1.PostInput {
	return settlement_v1.PostInput{
		TeamID:         teamID,
		ShopID:         shopID,
		UniqueID:       uniqueID,
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		Change:         change,
		OccurredOn:     "2026-11-18",
		ActorID:        uploader,
	}
}

// shopWrites counts what is on disk for a shop: its log rows and its account.
func shopWrites(t *testing.T, db *gorm.DB, shopID uint64) (rows, accounts int64) {
	t.Helper()

	err := db.
		Model(&settlement_service_models.SettlementLog{}).
		Where("shop_id = ?", shopID).
		Count(&rows).
		Error
	if err != nil {
		t.Fatalf("count rows: %v", err)
	}

	err = db.
		Model(&settlement_service_models.ShopSettlement{}).
		Where("shop_id = ?", shopID).
		Count(&accounts).
		Error
	if err != nil {
		t.Fatalf("count accounts: %v", err)
	}

	return rows, accounts
}

// THE CLAIM: team A posts the first row naming team B's shop. It used to open B's shop account under A, after which
// every row B posted to its own shop answered errWrongTeam. Now the shop is asked first: NotFound, no row and no
// account — and B's own first post then opens its account as B's.
func TestSettlementPost_AnotherTeamsShopIsNotFoundAndOpensNoAccount(t *testing.T) {
	db := san_testdb.DB(t)
	shops := newTeamShops()
	svc := settlement_v1.NewService(db, nil, nil, shops, nil, nil, nil)

	for _, source := range []settlementv1.SourceType{
		settlementv1.SourceType_SOURCE_TYPE_MANUAL,
		settlementv1.SourceType_SOURCE_TYPE_IMPORTER,
	} {
		claim := handShopRow(scopeTeamA, scopeShopB, "claim-"+source.String(), -1_000)
		claim.SourceType = source

		_, err := svc.PostEntry(context.Background(), claim)
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("%s: team A posting on team B's shop: code = %v (%v), want not_found", source, connect.CodeOf(err), err)
		}
	}

	rows, accounts := shopWrites(t, db, scopeShopB)
	if rows != 0 || accounts != 0 {
		t.Fatalf("the refused claim left %d rows and %d accounts on team B's shop, want none", rows, accounts)
	}

	own, err := svc.PostEntry(context.Background(), handShopRow(scopeTeamB, scopeShopB, "b-own-row", -2_000))
	if err != nil {
		t.Fatalf("team B's own post after the refused claim: %v", err)
	}

	if !own.Created || own.ShopState == nil || own.ShopState.TeamID != scopeTeamB {
		t.Fatalf("team B's own post: created=%v account=%+v, want a new row on team B's own account", own.Created, own.ShopState)
	}
}

// A shop that never existed reads exactly as another team's: NotFound, nothing written.
func TestSettlementPost_AnUnknownShopIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, newTeamShops(), nil, nil, nil)

	_, err := svc.PostEntry(context.Background(), handShopRow(scopeTeamA, scopeShopUnknown, "unknown-shop", -1_000))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("an unknown shop: code = %v (%v), want not_found", connect.CodeOf(err), err)
	}

	rows, accounts := shopWrites(t, db, scopeShopUnknown)
	if rows != 0 || accounts != 0 {
		t.Fatalf("an unknown shop got %d rows and %d accounts, want none", rows, accounts)
	}
}

// Team B's account is already open: team A posting on it reads as the shop does — NotFound, never the
// permission_denied that confirmed the account exists — and B's balance does not move.
func TestSettlementPost_AnotherTeamsOpenShopAccountIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, newTeamShops(), nil, nil, nil)

	_, err := svc.PostEntry(context.Background(), handShopRow(scopeTeamB, scopeShopB, "b-opens", -2_000))
	if err != nil {
		t.Fatalf("team B opens its account: %v", err)
	}

	_, err = svc.PostEntry(context.Background(), handShopRow(scopeTeamA, scopeShopB, "a-intrudes", -1_000))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("team A on team B's open account: code = %v (%v), want not_found", connect.CodeOf(err), err)
	}

	var account settlement_service_models.ShopSettlement

	err = db.Where("shop_id = ?", scopeShopB).Take(&account).Error
	if err != nil {
		t.Fatalf("team B's account: %v", err)
	}

	if account.TeamID != scopeTeamB || account.LastBalance != -2_000 {
		t.Errorf("team B's account = team %d, balance %v — want team %d, −2.000 untouched", account.TeamID, account.LastBalance, scopeTeamB)
	}
}

// The team's own shop posts as before, and a shop row posted by hand still counts for its actor — the ask is the
// scope check, not a new rule on who may post (option B was not picked).
func TestSettlementPost_TheTeamsOwnShopPosts(t *testing.T) {
	db := san_testdb.DB(t)
	shops := newTeamShops()
	svc := settlement_v1.NewService(db, nil, nil, shops, nil, nil, nil)

	got, err := svc.PostEntry(context.Background(), handShopRow(scopeTeamA, scopeShopA, "a-own", -3_000))
	if err != nil {
		t.Fatalf("team A on its own shop: %v", err)
	}

	if !got.Created || got.ShopState.TeamID != scopeTeamA || got.Entry.UserID != 0 {
		t.Errorf("created=%v team=%d user=%d — want a new row on team A's account, counted for its actor",
			got.Created, got.ShopState.TeamID, got.Entry.UserID)
	}

	if shops.asked != 1 {
		t.Errorf("the shop was asked %d times, want 1", shops.asked)
	}
}

// NOT RE-HOMED (the build's default): an account another team opened BEFORE the shop was asked stays where it is.
// Its shop's own team still meets permission_denied on it, and the team that claimed it can write nothing new there.
func TestSettlementPost_AClaimMadeBeforeTheCheckIsNotRehomed(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, newTeamShops(), nil, nil, nil)

	// The claim as the old code left it: team B's shop, its account under team A.
	err := db.Create(&settlement_service_models.ShopSettlement{ShopID: scopeShopB, TeamID: scopeTeamA}).Error
	if err != nil {
		t.Fatalf("seed the old claim: %v", err)
	}

	_, err = svc.PostEntry(context.Background(), handShopRow(scopeTeamB, scopeShopB, "b-on-claimed", -1_000))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("team B on its own claimed shop: code = %v (%v), want permission_denied — the account is not re-homed",
			connect.CodeOf(err), err)
	}

	_, err = svc.PostEntry(context.Background(), handShopRow(scopeTeamA, scopeShopB, "a-on-claimed", -1_000))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("team A on the shop it claimed: code = %v (%v), want not_found — nothing new on another team's shop",
			connect.CodeOf(err), err)
	}

	rows, _ := shopWrites(t, db, scopeShopB)
	if rows != 0 {
		t.Errorf("%d rows written on the claimed account, want none", rows)
	}
}
