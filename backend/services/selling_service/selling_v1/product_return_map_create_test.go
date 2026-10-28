package selling_v1_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// The return map's cast, the same in every test: team 2 sells team 9's products 501 and 502, and owns 601 and 602.
// Team 3 owns 701. 900 belongs to nobody — the catalogue does not know it.
const (
	mapTeam         uint64 = 2
	borrowedA       uint64 = 501
	borrowedB       uint64 = 502
	ourProduct      uint64 = 601
	ourOtherProduct uint64 = 602
)

// returnMapCatalog is the catalogue the cast lives in.
func returnMapCatalog() *fakeCatalog {
	return &fakeCatalog{
		missing: map[uint64]bool{900: true},
		owners: map[uint64]uint64{
			borrowedA: 9, borrowedB: 9,
			ourProduct: mapTeam, ourOtherProduct: mapTeam,
			701: 3,
		},
	}
}

func newReturnMapService(t *testing.T, db *gorm.DB) *selling_v1.Service {
	t.Helper()

	return newServiceWithCatalog(t, db, returnMapCatalog())
}

func createReturnMap(
	svc *selling_v1.Service,
	teamID, sharedID, ownID uint64,
) (*sellingv1.ProductReturnMapCreateResponse, error) {
	res, err := svc.ProductReturnMapCreate(context.Background(), connect.NewRequest(&sellingv1.ProductReturnMapCreateRequest{
		TeamId: teamID, SharedProductId: sharedID, OwnProductId: ownID,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// mapForReturns writes a pair that must succeed — the seed for the tests about something else.
func mapForReturns(t *testing.T, svc *selling_v1.Service, teamID, sharedID, ownID uint64) {
	t.Helper()

	_, err := createReturnMap(svc, teamID, sharedID, ownID)
	if err != nil {
		t.Fatalf("map %d → %d for team %d: %v", sharedID, ownID, teamID, err)
	}
}

func returnMapRows(t *testing.T, db *gorm.DB, teamID uint64) []selling_service_models.ProductReturnMap {
	t.Helper()

	var rows []selling_service_models.ProductReturnMap

	err := db.Where("team_id = ?", teamID).Order("shared_product_id").Find(&rows).Error
	if err != nil {
		t.Fatalf("read the maps of team %d: %v", teamID, err)
	}

	return rows
}

func wantCode(t *testing.T, err error, code connect.Code) *connect.Error {
	t.Helper()

	var cerr *connect.Error
	if !errors.As(err, &cerr) || cerr.Code() != code {
		t.Fatalf("err = %v, want %s", err, code)
	}

	return cerr
}

// The first map of a borrowed product writes the pair and says so.
func TestProductReturnMapCreate_WritesThePair(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newReturnMapService(t, db)

	got, err := createReturnMap(svc, mapTeam, borrowedA, ourProduct)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if !got.GetCreated() {
		t.Fatal("created = false on the first map of the product")
	}

	pair := got.GetMap()
	if pair.GetTeamId() != mapTeam || pair.GetSharedProductId() != borrowedA || pair.GetOwnProductId() != ourProduct {
		t.Fatalf("pair = %+v, want team %d: %d → %d", pair, mapTeam, borrowedA, ourProduct)
	}

	if pair.GetCreatedAtUnix() <= 0 {
		t.Fatalf("created_at_unix = %d, want the moment it was written", pair.GetCreatedAtUnix())
	}

	rows := returnMapRows(t, db, mapTeam)
	if len(rows) != 1 || rows[0].OwnProductID != ourProduct {
		t.Fatalf("rows = %+v, want the one pair", rows)
	}

	// Written once: updated_at only ever mirrors created_at (a-return-map-is-written-once).
	if !rows[0].UpdatedAt.Equal(rows[0].CreatedAt) {
		t.Fatalf("updated_at %v ≠ created_at %v", rows[0].UpdatedAt, rows[0].CreatedAt)
	}
}

// ⚠ A STANDING PAIR IS NEVER OVERWRITTEN (a-return-map-is-written-once). A second map of the same borrowed product,
// to a DIFFERENT own product, is not refused and does not re-point the row: it hands back the pair that stands, with
// created = false — which is what the card shows when somebody mapped it first.
func TestProductReturnMapCreate_AStandingPairIsReturnedNotOverwritten(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newReturnMapService(t, db)

	mapForReturns(t, svc, mapTeam, borrowedA, ourProduct)
	before := returnMapRows(t, db, mapTeam)

	got, err := createReturnMap(svc, mapTeam, borrowedA, ourOtherProduct)
	if err != nil {
		t.Fatalf("second create: %v", err)
	}

	if got.GetCreated() {
		t.Fatal("created = true — the second map of a product wrote a pair")
	}

	if got.GetMap().GetOwnProductId() != ourProduct {
		t.Fatalf("own product = %d, want the standing %d — not the second pick %d",
			got.GetMap().GetOwnProductId(), ourProduct, ourOtherProduct)
	}

	after := returnMapRows(t, db, mapTeam)
	if len(after) != 1 {
		t.Fatalf("%d rows, want 1 — the map is unique on its source", len(after))
	}

	if after[0].OwnProductID != ourProduct || !after[0].UpdatedAt.Equal(before[0].UpdatedAt) {
		t.Fatalf("row = %+v, want it untouched (%+v)", after[0], before[0])
	}
}

// The same borrowed product is mapped by each team on its own — a map is the TEAM's answer
// (the-map-is-unique-on-its-source keys it on the team as well as the product).
func TestProductReturnMapCreate_AnotherTeamMapsTheSameProductItsOwnWay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newReturnMapService(t, db)

	mapForReturns(t, svc, mapTeam, borrowedA, ourProduct)

	got, err := createReturnMap(svc, 3, borrowedA, 701)
	if err != nil {
		t.Fatalf("team 3's create: %v", err)
	}

	if !got.GetCreated() || got.GetMap().GetOwnProductId() != 701 {
		t.Fatalf("team 3 got %+v (created %v), want its own new pair → 701", got.GetMap(), got.GetCreated())
	}
}

// ⚠ AN OWN PRODUCT IS NEVER MAPPED (an-own-line-never-touches-the-map). A row pointing team 2's own product at
// another of its own would occupy the only slot a real map of it could have.
func TestProductReturnMapCreate_RefusesTheTeamsOwnProductAsTheBorrowedOne(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newReturnMapService(t, db)

	_, err := createReturnMap(svc, mapTeam, ourOtherProduct, ourProduct)

	cerr := wantCode(t, err, connect.CodeFailedPrecondition)
	if !strings.Contains(cerr.Message(), "SKU602") || !strings.Contains(cerr.Message(), "own product") {
		t.Fatalf("message %q should name SKU602 as this team's own product", cerr.Message())
	}

	if rows := returnMapRows(t, db, mapTeam); len(rows) != 0 {
		t.Fatalf("a refused map wrote %d rows", len(rows))
	}
}

// ⚠ A RETURN NEVER COMES BACK AS ANOTHER TEAM'S GOODS (a-return-never-clones-a-product): "our" product must be ours.
func TestProductReturnMapCreate_RefusesAnotherTeamsProductAsOurs(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newReturnMapService(t, db)

	_, err := createReturnMap(svc, mapTeam, borrowedA, 701)

	cerr := wantCode(t, err, connect.CodeFailedPrecondition)
	if !strings.Contains(cerr.Message(), "SKU701") || !strings.Contains(cerr.Message(), "not one of this team's products") {
		t.Fatalf("message %q should name SKU701 as not this team's", cerr.Message())
	}

	if rows := returnMapRows(t, db, mapTeam); len(rows) != 0 {
		t.Fatalf("a refused map wrote %d rows", len(rows))
	}
}

// A borrowed product nobody owns — the catalogue does not know it — is not mapped: nothing would ever read the row.
func TestProductReturnMapCreate_RefusesAProductThatDoesNotExist(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newReturnMapService(t, db)

	_, err := createReturnMap(svc, mapTeam, 900, ourProduct)

	wantCode(t, err, connect.CodeNotFound)

	if rows := returnMapRows(t, db, mapTeam); len(rows) != 0 {
		t.Fatalf("a refused map wrote %d rows", len(rows))
	}
}

// A failed owners lookup writes nothing — a pair written unchecked could never be taken back.
func TestProductReturnMapCreate_AFailedLookupWritesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithCatalog(t, db, &fakeCatalog{err: errors.New("product_service is down")})

	_, err := createReturnMap(svc, mapTeam, borrowedA, ourProduct)

	wantCode(t, err, connect.CodeUnavailable)

	if rows := returnMapRows(t, db, mapTeam); len(rows) != 0 {
		t.Fatalf("a map written with no owners lookup: %d rows", len(rows))
	}
}
