package team_v1_test

import (
	"errors"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
	team_v1 "github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
)

// THE TEAM CODE PREVIEW (backlog #150) — what TeamCodeUpdate WOULD do, read when the confirm opens. Here team_service's
// side against the fake recomposer (team_code_update_test.go): the refusals, the same code, the hand-over and the
// warehouses' names. The products' figures through the real seam: cmd/app_development/product_code_preview_test.go.

func previewCode(t *testing.T, svc *team_v1.Service, teamID uint64, code string) (*teamv1.TeamCodePreviewResponse, error) {
	t.Helper()

	resp, err := svc.TeamCodePreview(asEditor(), connect.NewRequest(&teamv1.TeamCodePreviewRequest{TeamId: teamID, TeamCode: code}))
	if err != nil {
		return nil, err
	}

	return resp.Msg, nil
}

func namedTeam(t *testing.T, db *gorm.DB, teamType, name, code string) uint64 {
	t.Helper()

	team := team_service_models.Team{Type: teamType, Name: name, TeamCode: code}

	err := db.Create(&team).Error
	if err != nil {
		t.Fatal(err)
	}

	return team.ID
}

// A new code: CHANGES, with the recomposer's figures — handed the team, its code now and the new one (trimmed) — and the
// warehouses holding the products NAMED from team_service's own teams, sorted by name. Nothing is written.
func TestTeamCodePreview_ChangesWithTheFiguresAndTheWarehousesNamed(t *testing.T) {
	db := san_testdb.DB(t)

	pusat := namedTeam(t, db, "warehouse", "Gudang Pusat", "TCP-WH1")
	cabang := namedTeam(t, db, "warehouse", "Gudang Cabang", "TCP-WH2")

	rec := &fakeRecomposer{preview: team_v1.ProductsPreview{
		Products:     46,
		ExampleOld:   "TCP-ABC-001",
		ExampleNew:   "TCP-XYZ-001",
		WarehouseIDs: []uint64{pusat, cabang},
	}}
	svc := codeService(db, rec)

	id := namedTeam(t, db, "selling", "Toko Anggrek", "TCP-ABC")

	got, err := previewCode(t, svc, id, "  TCP-XYZ ")
	if err != nil {
		t.Fatalf("TeamCodePreview: %v", err)
	}

	if got.GetVerdict() != teamv1.TeamCodePreviewVerdict_TEAM_CODE_PREVIEW_VERDICT_CHANGES {
		t.Fatalf("verdict = %v, want CHANGES", got.GetVerdict())
	}

	if got.GetProducts() != 46 || got.GetExampleOldCode() != "TCP-ABC-001" || got.GetExampleNewCode() != "TCP-XYZ-001" {
		t.Errorf("figures = %d %q → %q, want 46 TCP-ABC-001 → TCP-XYZ-001", got.GetProducts(), got.GetExampleOldCode(),
			got.GetExampleNewCode())
	}

	if want := []string{"Gudang Cabang", "Gudang Pusat"}; !slices.Equal(got.GetWarehouseNames(), want) {
		t.Errorf("warehouses = %v, want %v", got.GetWarehouseNames(), want)
	}

	if got.GetHolderTeamName() != "" {
		t.Errorf("holder = %q on a change", got.GetHolderTeamName())
	}

	want := team_v1.TeamCodeChange{TeamID: id, OldCode: "TCP-ABC", NewCode: "TCP-XYZ"}
	if len(rec.previews) != 1 || rec.previews[0] != want {
		t.Errorf("previews = %+v, want one %+v", rec.previews, want)
	}

	if len(rec.calls) != 0 {
		t.Errorf("the recompose itself ran %d times — a preview writes nothing", len(rec.calls))
	}

	if code := teamCodeOf(t, db, id); code != "TCP-ABC" {
		t.Errorf("stored code = %q — the preview moved it", code)
	}

	if former := formerCodes(t, db, id); len(former) != 0 {
		t.Errorf("former codes = %v — the preview wrote one", former)
	}
}

// No product would move, or none sits on a shelf: CHANGES with no warehouse named (an empty list, never an error).
func TestTeamCodePreview_NoWarehouseIsNoName(t *testing.T) {
	db := san_testdb.DB(t)
	svc := codeService(db, &fakeRecomposer{preview: team_v1.ProductsPreview{Products: 3, ExampleOld: "TCP-NW-1", ExampleNew: "TCP-NW2-1"}})

	id := namedTeam(t, db, "selling", "Toko Kosong", "TCP-NW")

	got, err := previewCode(t, svc, id, "TCP-NW2")
	if err != nil {
		t.Fatal(err)
	}

	if got.GetVerdict() != teamv1.TeamCodePreviewVerdict_TEAM_CODE_PREVIEW_VERDICT_CHANGES || got.GetProducts() != 3 ||
		len(got.GetWarehouseNames()) != 0 {
		t.Errorf("answer = %v / %d / %v, want CHANGES, 3, no warehouse", got.GetVerdict(), got.GetProducts(), got.GetWarehouseNames())
	}
}

// The team's own code: SAME — the write would change nothing — and the products are never asked.
func TestTeamCodePreview_TheTeamsOwnCodeIsSame(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &fakeRecomposer{}
	svc := codeService(db, rec)

	id := namedTeam(t, db, "selling", "Toko Sama", "TCP-SAME")

	got, err := previewCode(t, svc, id, " TCP-SAME ")
	if err != nil {
		t.Fatal(err)
	}

	if got.GetVerdict() != teamv1.TeamCodePreviewVerdict_TEAM_CODE_PREVIEW_VERDICT_SAME || got.GetProducts() != 0 {
		t.Errorf("answer = %v / %d, want SAME and no figures", got.GetVerdict(), got.GetProducts())
	}

	if len(rec.previews) != 0 {
		t.Errorf("the products were asked %d times", len(rec.previews))
	}
}

// A code ANOTHER team holds now: TAKEN, naming it — as the write's TeamCodeTaken detail would — and no figures.
func TestTeamCodePreview_ACodeAnotherTeamHoldsIsTaken(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &fakeRecomposer{preview: team_v1.ProductsPreview{Products: 9}}
	svc := codeService(db, rec)

	namedTeam(t, db, "selling", "Toko Melati", "TCP-SL1")
	id := namedTeam(t, db, "selling", "Toko Anggrek", "TCP-SL3")

	got, err := previewCode(t, svc, id, "TCP-SL1")
	if err != nil {
		t.Fatal(err)
	}

	if got.GetVerdict() != teamv1.TeamCodePreviewVerdict_TEAM_CODE_PREVIEW_VERDICT_TAKEN || got.GetHolderTeamName() != "Toko Melati" {
		t.Errorf("answer = %v %q, want TAKEN Toko Melati", got.GetVerdict(), got.GetHolderTeamName())
	}

	if got.GetProducts() != 0 || len(rec.previews) != 0 {
		t.Errorf("figures %d, products asked %d times — a refusal carries none", got.GetProducts(), len(rec.previews))
	}

	// The write agrees: refused AlreadyExists, naming the same team.
	_, err = updateCode(t, svc, asEditor(), id, "TCP-SL1")
	if taken := takenDetail(t, wantCode(t, err, connect.CodeAlreadyExists)); taken.GetTeamName() != "Toko Melati" || taken.GetFormer() {
		t.Errorf("the write's detail = %+v, want Toko Melati, not former", taken)
	}
}

// A code another team HELD once: FORMER, naming it (a former code is never given to another team); the team's OWN former
// code is no refusal — it may take it back.
func TestTeamCodePreview_AFormerCodeIsRefusedUnlessItIsTheTeamsOwn(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &fakeRecomposer{}
	svc := codeService(db, rec)

	kenanga := namedTeam(t, db, "selling", "Toko Kenanga", "TCP-KNG")

	_, err := updateCode(t, svc, asEditor(), kenanga, "TCP-SL2")
	if err != nil {
		t.Fatal(err)
	}

	other := namedTeam(t, db, "selling", "Toko Anggrek", "TCP-SL3")

	got, err := previewCode(t, svc, other, "TCP-KNG")
	if err != nil {
		t.Fatal(err)
	}

	if got.GetVerdict() != teamv1.TeamCodePreviewVerdict_TEAM_CODE_PREVIEW_VERDICT_FORMER || got.GetHolderTeamName() != "Toko Kenanga" {
		t.Errorf("another team's former code = %v %q, want FORMER Toko Kenanga", got.GetVerdict(), got.GetHolderTeamName())
	}

	own, err := previewCode(t, svc, kenanga, "TCP-KNG")
	if err != nil {
		t.Fatal(err)
	}

	if own.GetVerdict() != teamv1.TeamCodePreviewVerdict_TEAM_CODE_PREVIEW_VERDICT_CHANGES || own.GetHolderTeamName() != "" {
		t.Errorf("its own former code = %v %q, want CHANGES", own.GetVerdict(), own.GetHolderTeamName())
	}
}

// The write's other answers: a warehouse's or an admin team's code FailedPrecondition, an unknown or deleted team
// NotFound, a blank code InvalidArgument, no recomposer Internal — and the products asked for none of them.
func TestTeamCodePreview_TheWritesRefusals(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &fakeRecomposer{}
	svc := codeService(db, rec)

	for _, kind := range []string{"warehouse", "admin"} {
		id := newTeam(t, db, kind, "TCP-"+kind[:3])

		_, err := previewCode(t, svc, id, "TCP-NEW"+kind[:1])
		wantCode(t, err, connect.CodeFailedPrecondition)
	}

	deleted := newTeam(t, db, "selling", "TCP-DEL")

	err := db.Model(&team_service_models.Team{}).Where("id = ?", deleted).Update("deleted", true).Error
	if err != nil {
		t.Fatal(err)
	}

	_, err = previewCode(t, svc, deleted, "TCP-DEL2")
	wantCode(t, err, connect.CodeNotFound)

	_, err = previewCode(t, svc, 987654321, "TCP-NONE")
	wantCode(t, err, connect.CodeNotFound)

	selling := newTeam(t, db, "selling", "TCP-BLANK")

	_, err = previewCode(t, svc, selling, "   ")
	wantCode(t, err, connect.CodeInvalidArgument)

	_, err = previewCode(t, codeService(db, nil), selling, "TCP-NOREC")
	wantCode(t, err, connect.CodeInternal)

	if len(rec.previews) != 0 {
		t.Errorf("the products were asked %d times", len(rec.previews))
	}
}

// The products' side failing is Internal, never a figure of 0.
func TestTeamCodePreview_AFailedProductReadIsAnError(t *testing.T) {
	db := san_testdb.DB(t)
	svc := codeService(db, &fakeRecomposer{previewErr: errors.New("the shelves cannot be read")})

	id := newTeam(t, db, "selling", "TCP-ERR")

	_, err := previewCode(t, svc, id, "TCP-ERR2")
	wantCode(t, err, connect.CodeInternal)
}

// WHO MAY ASK: TeamCodeUpdate's roles and scope — whoever may change the code may see what follows — and it is marked a
// READ (NO_SIDE_EFFECTS: no row, no event, no file), so a monitor's and an agent's credential pass it as a read.
func TestTeamCodePreview_Policy(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.team.v1.TeamCodePreviewRequest")
	if err != nil {
		t.Fatal(err)
	}

	md := desc.(protoreflect.MessageDescriptor)

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
	}

	if got := san_auth.PolicyOf(md).GetRoles(); !slices.Equal(got, want) {
		t.Errorf("roles = %v, want %v (TeamCodeUpdate's)", got, want)
	}

	scope := md.Fields().ByName("team_id")
	if scope == nil {
		t.Fatal("TeamCodePreviewRequest has no team_id scope")
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.team.v1.TeamService.TeamCodePreview")
	if err != nil {
		t.Fatal(err)
	}

	options, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if options.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Error("TeamCodePreview is not marked NO_SIDE_EFFECTS — a read the confirm opens")
	}
}
