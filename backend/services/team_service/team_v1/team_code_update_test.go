package team_v1_test

import (
	"context"
	"errors"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
	team_v1 "github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
)

// THE TEAM CODE EDIT (backlog #149, a-team-code-change-recomposes-its-product-codes). The products' side is
// product_service's (its own tests, and cmd/app_development's through the real seam); here a fake recomposer records
// what team_service asked of it, inside the edit's transaction.

// fakeRecomposer records each change it was handed and answers `answer` / `err`. It writes a row through the caller's tx
// when `mark` is set, so a test can see whether the change's writes rolled back together.
type fakeRecomposer struct {
	calls  []team_v1.TeamCodeChange
	answer team_v1.RecomposedProducts
	err    error

	// previews records each change PreviewTeamCodes was asked about; preview / previewErr are its answer.
	previews   []team_v1.TeamCodeChange
	preview    team_v1.ProductsPreview
	previewErr error
}

func (f *fakeRecomposer) RecomposeTeamCodes(_ context.Context, tx *gorm.DB, change team_v1.TeamCodeChange) (team_v1.RecomposedProducts, error) {
	if tx == nil {
		return team_v1.RecomposedProducts{}, errors.New("no transaction handed over")
	}

	f.calls = append(f.calls, change)

	return f.answer, f.err
}

func (f *fakeRecomposer) PreviewTeamCodes(_ context.Context, db *gorm.DB, change team_v1.TeamCodeChange) (team_v1.ProductsPreview, error) {
	if db == nil {
		return team_v1.ProductsPreview{}, errors.New("no db handed over")
	}

	f.previews = append(f.previews, change)

	return f.preview, f.previewErr
}

func codeService(db *gorm.DB, r team_v1.ProductCodeRecomposer) *team_v1.Service {
	return team_v1.NewService(db, nil, r)
}

// asEditor is the request context of the person changing the code: user 41, inside the team (no override).
func asEditor() context.Context {
	return san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: 41})
}

func updateCode(t *testing.T, svc *team_v1.Service, ctx context.Context, teamID uint64, code string) (*teamv1.TeamCodeUpdateResponse, error) {
	t.Helper()

	resp, err := svc.TeamCodeUpdate(ctx, connect.NewRequest(&teamv1.TeamCodeUpdateRequest{TeamId: teamID, TeamCode: code}))
	if err != nil {
		return nil, err
	}

	return resp.Msg, nil
}

func teamCodeOf(t *testing.T, db *gorm.DB, teamID uint64) string {
	t.Helper()

	var team team_service_models.Team

	err := db.Where("id = ?", teamID).Take(&team).Error
	if err != nil {
		t.Fatal(err)
	}

	return team.TeamCode
}

func formerCodes(t *testing.T, db *gorm.DB, teamID uint64) []string {
	t.Helper()

	var codes []string

	err := db.
		Model(&team_service_models.TeamFormerCode{}).
		Where("team_id = ?", teamID).
		Order("team_code").
		Pluck("team_code", &codes).
		Error
	if err != nil {
		t.Fatal(err)
	}

	return codes
}

func wantCode(t *testing.T, err error, code connect.Code) *connect.Error {
	t.Helper()

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || connectErr.Code() != code {
		t.Fatalf("err = %v, want %v", err, code)
	}

	return connectErr
}

func takenDetail(t *testing.T, err *connect.Error) *teamv1.TeamCodeTaken {
	t.Helper()

	for _, d := range err.Details() {
		msg, valueErr := d.Value()
		if valueErr != nil {
			continue
		}

		if taken, ok := msg.(*teamv1.TeamCodeTaken); ok {
			return taken
		}
	}

	t.Fatalf("%v carries no TeamCodeTaken detail", err)

	return nil
}

// A SELLING team's code changes: the team takes the new code, the old one is kept among its former codes, and the
// recomposer is handed the change — whose, from, to, who — inside the transaction. The answer carries its counts.
func TestTeamCodeUpdate_ChangesTheCodeAndHandsTheChangeOver(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &fakeRecomposer{answer: team_v1.RecomposedProducts{Recomposed: 2, Tagged: 1, LeftAlone: 1, LeftAloneCodes: []string{"BARE-1"}}}
	svc := codeService(db, rec)

	id := newTeam(t, db, "selling", "TCU-ABC")

	resp, err := updateCode(t, svc, asEditor(), id, "TCU-XYZ")
	if err != nil {
		t.Fatalf("TeamCodeUpdate: %v", err)
	}

	if !resp.GetChanged() || resp.GetTeam().GetTeamCode() != "TCU-XYZ" {
		t.Fatalf("answer changed=%v code=%q, want true TCU-XYZ", resp.GetChanged(), resp.GetTeam().GetTeamCode())
	}

	if resp.GetProductsRecomposed() != 2 || resp.GetProductsTagged() != 1 || resp.GetProductsLeftAlone() != 1 ||
		!slices.Equal(resp.GetLeftAloneCodes(), []string{"BARE-1"}) {
		t.Errorf("counts = %d / %d / %d %v, want 2 / 1 / 1 [BARE-1]", resp.GetProductsRecomposed(), resp.GetProductsTagged(),
			resp.GetProductsLeftAlone(), resp.GetLeftAloneCodes())
	}

	if got := teamCodeOf(t, db, id); got != "TCU-XYZ" {
		t.Errorf("stored code = %q, want TCU-XYZ", got)
	}

	if got := formerCodes(t, db, id); !slices.Equal(got, []string{"TCU-ABC"}) {
		t.Errorf("former codes = %v, want [TCU-ABC]", got)
	}

	want := team_v1.TeamCodeChange{TeamID: id, OldCode: "TCU-ABC", NewCode: "TCU-XYZ", ActorID: 41}
	if len(rec.calls) != 1 || rec.calls[0] != want {
		t.Errorf("recomposer calls = %+v, want one %+v", rec.calls, want)
	}
}

// Root or the Administrator changing a team they hold no role in is an OVERRIDE — handed over, so each product's history
// line carries the badge.
func TestTeamCodeUpdate_AnOverrideIsHandedOver(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &fakeRecomposer{}
	svc := codeService(db, rec)

	id := newTeam(t, db, "selling", "TCU-OVR")

	ctx := san_auth.WithCallerRole(san_auth.WithScope(asEditor(), id), role_basev1.Role_ROLE_UNSPECIFIED)
	if !san_auth.IsOverride(ctx) {
		t.Fatal("this context does not read as an override — san_auth's rule moved")
	}

	_, err := updateCode(t, svc, ctx, id, "TCU-OVR2")
	if err != nil {
		t.Fatal(err)
	}

	if len(rec.calls) != 1 || !rec.calls[0].IsOverride {
		t.Errorf("recomposer calls = %+v, want one marked an override", rec.calls)
	}
}

// The code the team has already is no change: nothing written, nothing recomposed — the form can always send it.
func TestTeamCodeUpdate_TheSameCodeIsNoChange(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &fakeRecomposer{}
	svc := codeService(db, rec)

	id := newTeam(t, db, "selling", "TCU-SAME")

	resp, err := updateCode(t, svc, asEditor(), id, "  TCU-SAME ")
	if err != nil {
		t.Fatalf("TeamCodeUpdate: %v", err)
	}

	if resp.GetChanged() || len(rec.calls) != 0 || len(formerCodes(t, db, id)) != 0 {
		t.Errorf("changed=%v, recomposer calls %d, former codes %v — want no change at all", resp.GetChanged(), len(rec.calls),
			formerCodes(t, db, id))
	}
}

// The code is trimmed of surrounding space; one of only spaces is InvalidArgument.
func TestTeamCodeUpdate_TrimsTheCode(t *testing.T) {
	db := san_testdb.DB(t)
	svc := codeService(db, &fakeRecomposer{})

	id := newTeam(t, db, "selling", "TCU-TRIM")

	resp, err := updateCode(t, svc, asEditor(), id, " TCU-TRIM2  ")
	if err != nil {
		t.Fatal(err)
	}

	if resp.GetTeam().GetTeamCode() != "TCU-TRIM2" {
		t.Errorf("code = %q, want TCU-TRIM2", resp.GetTeam().GetTeamCode())
	}

	_, err = updateCode(t, svc, asEditor(), id, "   ")
	wantCode(t, err, connect.CodeInvalidArgument)
}

// Only a SELLING team's code: no product is composed from a warehouse's or an admin team's — FailedPrecondition, nothing
// written. An unknown or deleted team is NotFound.
func TestTeamCodeUpdate_OnlyASellingTeam(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &fakeRecomposer{}
	svc := codeService(db, rec)

	for _, kind := range []string{"warehouse", "admin"} {
		id := newTeam(t, db, kind, "TCU-"+kind[:3])

		_, err := updateCode(t, svc, asEditor(), id, "TCU-NEW"+kind[:1])
		wantCode(t, err, connect.CodeFailedPrecondition)

		if got := teamCodeOf(t, db, id); got != "TCU-"+kind[:3] {
			t.Errorf("%s team's code = %q — it moved", kind, got)
		}
	}

	deleted := newTeam(t, db, "selling", "TCU-DEL")

	err := db.Model(&team_service_models.Team{}).Where("id = ?", deleted).Update("deleted", true).Error
	if err != nil {
		t.Fatal(err)
	}

	_, err = updateCode(t, svc, asEditor(), deleted, "TCU-DEL2")
	wantCode(t, err, connect.CodeNotFound)

	_, err = updateCode(t, svc, asEditor(), 987654321, "TCU-NONE")
	wantCode(t, err, connect.CodeNotFound)

	if len(rec.calls) != 0 {
		t.Errorf("recomposer called %d times", len(rec.calls))
	}
}

// A code ANOTHER team holds is refused naming it (*SL-01 sudah ada — dipakai Toko Melati*) — AlreadyExists with a
// TeamCodeTaken detail; nothing is written.
func TestTeamCodeUpdate_RefusesACodeAnotherTeamHolds(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &fakeRecomposer{}
	svc := codeService(db, rec)

	id := newTeam(t, db, "selling", "TCU-MINE")
	holder := team_service_models.Team{Type: "selling", Name: "Toko Melati", TeamCode: "TCU-HELD"}

	err := db.Create(&holder).Error
	if err != nil {
		t.Fatal(err)
	}

	_, err = updateCode(t, svc, asEditor(), id, "TCU-HELD")
	refusal := wantCode(t, err, connect.CodeAlreadyExists)

	taken := takenDetail(t, refusal)
	if taken.GetTeamName() != "Toko Melati" || taken.GetTeamCode() != "TCU-HELD" || taken.GetFormer() {
		t.Errorf("detail = %+v, want Toko Melati holding TCU-HELD now", taken)
	}

	if got := teamCodeOf(t, db, id); got != "TCU-MINE" || len(rec.calls) != 0 || len(formerCodes(t, db, id)) != 0 {
		t.Errorf("code %q, %d recomposes, former %v — want nothing written", got, len(rec.calls), formerCodes(t, db, id))
	}
}

// A code another team HELD ONCE is refused too, naming it — a team code once used is never given to another team (Q1
// "A"). The detail says it is a former code.
func TestTeamCodeUpdate_RefusesACodeAnotherTeamHeldOnce(t *testing.T) {
	db := san_testdb.DB(t)
	svc := codeService(db, &fakeRecomposer{})

	first := team_service_models.Team{Type: "selling", Name: "Toko Kenanga", TeamCode: "TCU-KNG"}

	err := db.Create(&first).Error
	if err != nil {
		t.Fatal(err)
	}

	_, err = updateCode(t, svc, asEditor(), first.ID, "TCU-KNG2")
	if err != nil {
		t.Fatal(err)
	}

	other := newTeam(t, db, "selling", "TCU-OTH")

	_, err = updateCode(t, svc, asEditor(), other, "TCU-KNG")
	refusal := wantCode(t, err, connect.CodeAlreadyExists)

	taken := takenDetail(t, refusal)
	if taken.GetTeamName() != "Toko Kenanga" || !taken.GetFormer() {
		t.Errorf("detail = %+v, want Toko Kenanga's former code", taken)
	}

	if got := teamCodeOf(t, db, other); got != "TCU-OTH" {
		t.Errorf("code = %q — it moved", got)
	}
}

// The team's OWN former code may be taken back: it is current again, and leaves the former codes; the code it moves off
// joins them.
func TestTeamCodeUpdate_TakesItsOwnFormerCodeBack(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &fakeRecomposer{}
	svc := codeService(db, rec)

	id := newTeam(t, db, "selling", "TCU-BACK")

	_, err := updateCode(t, svc, asEditor(), id, "TCU-AWAY")
	if err != nil {
		t.Fatal(err)
	}

	_, err = updateCode(t, svc, asEditor(), id, "TCU-BACK")
	if err != nil {
		t.Fatalf("taking its own former code back: %v", err)
	}

	if got := teamCodeOf(t, db, id); got != "TCU-BACK" {
		t.Errorf("code = %q, want TCU-BACK", got)
	}

	if got := formerCodes(t, db, id); !slices.Equal(got, []string{"TCU-AWAY"}) {
		t.Errorf("former codes = %v, want [TCU-AWAY]", got)
	}

	if len(rec.calls) != 2 || rec.calls[1].OldCode != "TCU-AWAY" || rec.calls[1].NewCode != "TCU-BACK" {
		t.Errorf("recomposer calls = %+v", rec.calls)
	}
}

// A recompose the products refuse (two would carry one code) refuses the WHOLE change — AlreadyExists, the product named —
// and the team keeps its code, no former code written: one transaction.
func TestTeamCodeUpdate_ARefusedRecomposeLeavesTheCode(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &fakeRecomposer{err: errors.Join(team_v1.ErrProductCodeClash, errors.New("product 7 (Q-1) would become AB-C-1"))}
	svc := codeService(db, rec)

	id := newTeam(t, db, "selling", "TCU-Q")

	_, err := updateCode(t, svc, asEditor(), id, "TCU-AB-C")
	wantCode(t, err, connect.CodeAlreadyExists)

	if got := teamCodeOf(t, db, id); got != "TCU-Q" || len(formerCodes(t, db, id)) != 0 {
		t.Errorf("code %q, former %v — want the change rolled back", got, formerCodes(t, db, id))
	}

	// Any other recompose failure rolls back too, answered Internal.
	rec.err = errors.New("the shelves cannot be read")

	_, err = updateCode(t, svc, asEditor(), id, "TCU-Q2")
	wantCode(t, err, connect.CodeInternal)

	if got := teamCodeOf(t, db, id); got != "TCU-Q" {
		t.Errorf("code %q — want the change rolled back", got)
	}
}

// With no recomposer the code cannot change: the products would be left under a code the team no longer has.
func TestTeamCodeUpdate_NoRecomposerRefuses(t *testing.T) {
	db := san_testdb.DB(t)
	svc := codeService(db, nil)

	id := newTeam(t, db, "selling", "TCU-NIL")

	_, err := updateCode(t, svc, asEditor(), id, "TCU-NIL2")
	wantCode(t, err, connect.CodeInternal)

	if got := teamCodeOf(t, db, id); got != "TCU-NIL" {
		t.Errorf("code %q — it moved", got)
	}
}

// TeamCreate refuses a code another team holds or held once, naming it — the same detail.
func TestTeamCreate_RefusesAHeldOrFormerCode(t *testing.T) {
	db := san_testdb.DB(t)
	svc := codeService(db, &fakeRecomposer{})

	melati := team_service_models.Team{Type: "selling", Name: "Toko Melati", TeamCode: "TCC-OLD"}

	err := db.Create(&melati).Error
	if err != nil {
		t.Fatal(err)
	}

	_, err = updateCode(t, svc, asEditor(), melati.ID, "TCC-NEW")
	if err != nil {
		t.Fatal(err)
	}

	for _, c := range []struct {
		code   string
		former bool
	}{{"TCC-OLD", true}, {"TCC-NEW", false}} {
		_, err = svc.TeamCreate(context.Background(), connect.NewRequest(&teamv1.TeamCreateRequest{
			Type:        teamv1.TeamType_TEAM_TYPE_SELLING,
			Name:        "Toko Baru",
			TeamCode:    c.code,
			OwnerUserId: 1,
		}))
		refusal := wantCode(t, err, connect.CodeAlreadyExists)

		taken := takenDetail(t, refusal)
		if taken.GetTeamName() != "Toko Melati" || taken.GetFormer() != c.former {
			t.Errorf("%s: detail = %+v, want Toko Melati, former %v", c.code, taken, c.former)
		}
	}
}

// WHO MAY CHANGE A TEAM CODE: the selling Owner and Admin in their own team, Root and the Administrator — the acceptance
// rows' givens (*selling:owner · selling:admin*, *root:administrator*), never CS, a warehouse or an admin team. Scoped by
// team_id, and a write.
func TestTeamCodeUpdate_Policy(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.team.v1.TeamCodeUpdateRequest")
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
		t.Errorf("roles = %v, want %v", got, want)
	}

	if md.Fields().ByName("team_id") == nil {
		t.Error("TeamCodeUpdateRequest has no team_id scope")
	}
}
