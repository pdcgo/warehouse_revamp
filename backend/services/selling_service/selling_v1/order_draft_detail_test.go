package selling_v1_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

func draftDetail(
	t *testing.T,
	svc *selling_v1.Service,
	userID, teamID, draftID uint64,
) (*sellingv1.OrderDraft, error) {
	t.Helper()

	res, err := svc.OrderDraftDetail(asUser(userID),
		connect.NewRequest(&sellingv1.OrderDraftDetailRequest{TeamId: teamID, DraftId: draftID}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetDraft(), nil
}

// The lines are the point of the detail — nothing else returns them, and the order form shows the scraped text above
// its products (the-draft-opens-in-the-order-form). No mapping comes back: a draft stores none.
func TestOrderDraftDetail_ReturnsTheLinesWithTheirScrapedText(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 7, "SHP-100")

	draft, err := draftDetail(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("OrderDraftDetail: %v", err)
	}

	if len(draft.GetItems()) != 2 {
		t.Fatalf("items = %d, want 2", len(draft.GetItems()))
	}

	first := draft.GetItems()[0]

	// The evidence of what was ordered, verbatim.
	if first.GetExternalName() != "Kaos Polos Hitam L" || first.GetQuantity() != 2 {
		t.Fatalf("line 1 = %q × %d, want the scraped Kaos Polos Hitam L × 2", first.GetExternalName(), first.GetQuantity())
	}

	if draft.GetItemCount() != 2 {
		t.Fatalf("item_count = %d, want 2 — the detail must agree with the list", draft.GetItemCount())
	}

	// The buyer and the address from the draft's one address row.
	if draft.GetCustomerName() != "Budi" || draft.GetAddress().GetProvinsiName() != "Jawa Barat" {
		t.Fatalf("buyer %q in %q — want Budi in Jawa Barat", draft.GetCustomerName(), draft.GetAddress().GetProvinsiName())
	}
}

// A colleague's draft reads as NOT FOUND, not as a permission error. The caller holds a perfectly
// good role in this team; the draft is simply not theirs, and "exists but is not yours" would leak
// that a given external ref has already been scraped.
func TestOrderDraftDetail_AColleaguesDraftIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 9, "SHP-200")

	_, err := draftDetail(t, svc, 7, 2, draftID)
	if err == nil {
		t.Fatal("read another person's draft — a draft is personal")
	}

	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}

// The team scope is checked in the query itself, so naming the right draft id under the wrong team
// cannot reach it.
func TestOrderDraftDetail_AnotherTeamCannotReachItById(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 7, "SHP-100")

	_, err := draftDetail(t, svc, 7, 3, draftID)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}

func TestOrderDraftDetail_RefusesWithoutAnIdentity(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 7, "SHP-100")

	_, err := svc.OrderDraftDetail(context.Background(),
		connect.NewRequest(&sellingv1.OrderDraftDetailRequest{TeamId: 2, DraftId: draftID}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated — a personal read needs to know who is asking",
			connect.CodeOf(err))
	}
}

// fakeRegions answers RegionMatcher with `match` (nil = no unique match) or `err`, and records what it was asked.
type fakeRegions struct {
	match *sellingv1.OrderAddress
	err   error
	asked [][4]string
}

func (f *fakeRegions) MatchRegion(
	_ context.Context,
	provinsi, kabupaten, kecamatan, desa string,
) (*sellingv1.OrderAddress, error) {
	f.asked = append(f.asked, [4]string{provinsi, kabupaten, kecamatan, desa})

	return f.match, f.err
}

func newServiceWithRegions(t *testing.T, db *gorm.DB, regions selling_v1.RegionMatcher) *selling_v1.Service {
	t.Helper()

	return selling_v1.NewService(db, &fakePicker{}, nil, &fakeCatalog{}, &fakeCredit{}, everyoneMayWrite{}, nil, nil, nil,
		regions)
}

// pushAddressed is a scrape that read all four region levels — "Kab. Bogor", as a marketplace writes it.
func pushAddressed(t *testing.T, svc *selling_v1.Service) uint64 {
	t.Helper()

	msg := scrape()
	msg.Address = &sellingv1.OrderAddress{
		ProvinsiName: "Jawa Barat", KabupatenName: "Kab. Bogor", KecamatanName: "Cibinong", DesaName: "Pakansari",
		KodePos: "16915", AddressLine: "Jl. Raya 1",
	}

	return push(t, svc, 7, msg).GetDraft().GetId()
}

// PRE-FILLED WHEN CERTAIN (the-cs-edits-the-whole-address-before-create): the draft's four names, asked of the region
// list as the draft holds them, match one place — `region_match` carries it, codes and all, while `address` stays the
// draft's own text for the form to show beside the dropdowns.
func TestOrderDraftDetail_PrefillsTheAddressWhenTheNamesMatchOnePlace(t *testing.T) {
	db := san_testdb.DB(t)
	regions := &fakeRegions{match: &sellingv1.OrderAddress{
		ProvinsiCode: "32", ProvinsiName: "Jawa Barat", KabupatenCode: "32.01", KabupatenName: "Kabupaten Bogor",
		KecamatanCode: "32.01.01", KecamatanName: "Cibinong", DesaCode: "32.01.01.1001", DesaName: "Pakansari",
		KodePos: "16915",
	}}
	svc := newServiceWithRegions(t, db, regions)

	draftID := pushAddressed(t, svc)

	draft, err := draftDetail(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("OrderDraftDetail: %v", err)
	}

	if len(regions.asked) != 1 || regions.asked[0] != [4]string{"Jawa Barat", "Kab. Bogor", "Cibinong", "Pakansari"} {
		t.Fatalf("the matcher was asked %v — want the draft's four names once", regions.asked)
	}

	match := draft.GetRegionMatch()
	if match.GetDesaCode() != "32.01.01.1001" || match.GetKabupatenName() != "Kabupaten Bogor" {
		t.Fatalf("region_match = %+v — want the one place", match)
	}

	if draft.GetAddress().GetKabupatenName() != "Kab. Bogor" || draft.GetAddress().GetAddressLine() != "Jl. Raya 1" {
		t.Fatalf("address = %+v — the draft's own text must stay as it was read", draft.GetAddress())
	}
}

// Else empty: no unique match, a failed lookup (logged, never a failed read), and a blank level (never asked — a match
// on fewer levels names an area, not a place) all leave `region_match` unset.
func TestOrderDraftDetail_NoPrefillWithoutAUniqueMatch(t *testing.T) {
	db := san_testdb.DB(t)

	none := &fakeRegions{}
	svc := newServiceWithRegions(t, db, none)

	draft, err := draftDetail(t, svc, 7, 2, pushAddressed(t, svc))
	if err != nil {
		t.Fatalf("OrderDraftDetail: %v", err)
	}

	if draft.GetRegionMatch() != nil || len(none.asked) != 1 {
		t.Fatalf("no match: region_match = %+v after %d asks — want unset", draft.GetRegionMatch(), len(none.asked))
	}

	failing := &fakeRegions{err: errors.New("region list down")}
	svc = newServiceWithRegions(t, db, failing)

	draft, err = draftDetail(t, svc, 7, 2, pushRef(t, svc, 7, "SHP-FAIL"))
	if err != nil {
		t.Fatalf("a failed pre-fill failed the read: %v", err)
	}

	if draft.GetRegionMatch() != nil {
		t.Fatalf("a failed lookup pre-filled %+v", draft.GetRegionMatch())
	}

	// scrape() reads the provinsi alone — three levels blank.
	if len(failing.asked) != 0 {
		t.Fatalf("a draft with blank levels was asked about: %v", failing.asked)
	}

	db.Model(&selling_service_models.OrderDraftAddress{}).
		Where("order_draft_id = ?", draft.GetId()).
		Updates(map[string]any{"kabupaten_name": "Kab. Bogor", "kecamatan_name": "Cibinong", "desa_name": "Pakansari"})

	draft, err = draftDetail(t, svc, 7, 2, draft.GetId())
	if err != nil || draft.GetRegionMatch() != nil || len(failing.asked) != 1 {
		t.Fatalf("failing lookup over four names: err %v, match %+v, asks %d", err, draft.GetRegionMatch(),
			len(failing.asked))
	}
}
