package main

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/region_service/region_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/region_service/region_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// plantRegion writes one region row; parents first (parent_code is a real self-FK).
func plantRegion(t *testing.T, db *gorm.DB, code, parent string, level int, name, kodePos string) {
	t.Helper()

	row := region_service_models.Region{Code: code, Level: level, Name: name}
	if parent != "" {
		row.ParentCode = &parent
	}

	if kodePos != "" {
		row.KodePos = &kodePos
	}

	err := db.Create(&row).Error
	if err != nil {
		t.Fatalf("plant region %s: %v", code, err)
	}
}

// THE DRAFT ADDRESS IS PRE-FILLED THROUGH THE REAL WIRING (the-cs-edits-the-whole-address-before-create): a draft
// pushed with the marketplace's "KAB. BOGOR" opens with region_service's one matching place as `region_match`, codes
// and the region list's spelling; the twin Bogor a prefix-less scrape could mean opens with none. The only place the
// selling read and the region matcher meet a database together.
func TestDraftRegionMatcher_PrefillsADraftsAddressFromTheRegionList(t *testing.T) {
	db := san_testdb.DB(t)

	plantRegion(t, db, "98", "", 1, "Jawa Barat Uji", "")
	plantRegion(t, db, "98.01", "98", 2, "Kabupaten Bogor", "")
	plantRegion(t, db, "98.01.01", "98.01", 3, "Bogor Barat", "")
	plantRegion(t, db, "98.01.01.1001", "98.01.01", 4, "Menteng", "16111")
	plantRegion(t, db, "98.71", "98", 2, "Kota Bogor", "")
	plantRegion(t, db, "98.71.01", "98.71", 3, "Bogor Barat", "")
	plantRegion(t, db, "98.71.01.1001", "98.71.01", 4, "Menteng", "16112")

	drafts := selling_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, nil,
		NewDraftRegionMatcher(region_v1.NewService(db)), nil)
	ctx := san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: 7})

	pushed := func(ref, kabupaten string) *sellingv1.OrderDraft {
		t.Helper()

		res, err := drafts.OrderDraftPush(ctx, connect.NewRequest(&sellingv1.OrderDraftPushRequest{
			TeamId: 2, Source: "scraper-app", ExternalId: ref, CustomerName: "Budi",
			Address: &sellingv1.OrderAddress{
				ProvinsiName: "JAWA BARAT UJI", KabupatenName: kabupaten, KecamatanName: "Bogor Barat",
				DesaName: "Menteng", AddressLine: "Jl. Raya 1",
			},
		}))
		if err != nil {
			t.Fatalf("OrderDraftPush %s: %v", ref, err)
		}

		detail, err := drafts.OrderDraftDetail(ctx, connect.NewRequest(&sellingv1.OrderDraftDetailRequest{
			TeamId: 2, DraftId: res.Msg.GetDraft().GetId(),
		}))
		if err != nil {
			t.Fatalf("OrderDraftDetail %s: %v", ref, err)
		}

		return detail.Msg.GetDraft()
	}

	certain := pushed("SHP-KAB", "KAB. BOGOR")

	match := certain.GetRegionMatch()
	if match.GetKabupatenCode() != "98.01" || match.GetDesaCode() != "98.01.01.1001" ||
		match.GetKabupatenName() != "Kabupaten Bogor" || match.GetKodePos() != "16111" {
		t.Fatalf("region_match = %+v — want Menteng of Kabupaten Bogor", match)
	}

	if certain.GetAddress().GetKabupatenName() != "KAB. BOGOR" {
		t.Fatalf("the draft's text became %q — it must stay as the app read it", certain.GetAddress().GetKabupatenName())
	}

	if unsure := pushed("SHP-ANY", "Bogor"); unsure.GetRegionMatch() != nil {
		t.Fatalf("a Bogor that fits two places was pre-filled with %+v", unsure.GetRegionMatch())
	}
}
