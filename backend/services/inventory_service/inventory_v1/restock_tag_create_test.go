package inventory_v1_test

import (
	"errors"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// MAKING A TAG (custom-tags-are-shared-system-tags-are-the-admins-and-the-apps): ONE app-wide list, a name unique across
// it. A custom tag is anyone's who may tag; a system tag the admins' (its own request, policy [ROOT, ADMINISTRATOR]). A
// name already taken — any case, spaces folded — answers THAT tag and never makes a twin.

const (
	tgSeller    uint64 = 21 // a selling team's member
	tgWarehouse uint64 = 31 // a warehouse member
	tgRoot      uint64 = 901
)

func tgCreate(svc *inventory_v1.Service, user, team uint64, name string) (*inventoryv1.RestockTagCreateResponse, error) {
	res, err := svc.RestockTagCreate(ctxUser(user), connect.NewRequest(&inventoryv1.RestockTagCreateRequest{
		TeamId: team, Name: name,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

func tgSystemCreate(svc *inventory_v1.Service, name string) (*inventoryv1.RestockTagSystemCreateResponse, error) {
	res, err := svc.RestockTagSystemCreate(ctxUser(tgRoot), connect.NewRequest(&inventoryv1.RestockTagSystemCreateRequest{
		Name: name,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// tagsNamed counts the tags whose name equals `name` case-insensitively — more than one is a twin.
func tagsNamed(t *testing.T, db *gorm.DB, name string) int64 {
	t.Helper()

	var n int64

	err := db.
		Model(&inventory_service_models.Tag{}).
		Where("lower(name) = lower(?)", name).
		Count(&n).
		Error
	if err != nil {
		t.Fatalf("count tags: %v", err)
	}

	return n
}

// A NEW NAME IS A NEW CUSTOM TAG, kept trimmed with its spaces folded and its case as typed, with who made it. The same
// name again — another case, other spaces, ANOTHER TEAM (one list for every team) — answers that tag: created false, the
// same id, no twin.
func TestRestockTagCreate_OneNameIsOneTag(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	made, err := tgCreate(svc, tgSeller, arrSellingTeam, "  Lebaran   2026 ")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if !made.GetCreated() || made.GetTag().GetName() != "Lebaran 2026" || made.GetTag().GetType() != tagCustom ||
		made.GetTag().GetAppTask() != "" || made.GetTag().GetId() == 0 {
		t.Fatalf("made = %v, want a new custom tag named \"Lebaran 2026\"", made)
	}

	var row inventory_service_models.Tag

	err = db.First(&row, made.GetTag().GetId()).Error
	if err != nil {
		t.Fatal(err)
	}

	if row.CreatedByUserID != tgSeller || row.CreatedByIsOverride {
		t.Fatalf("the tag reads made by %d (override %v), want %d", row.CreatedByUserID, row.CreatedByIsOverride, tgSeller)
	}

	for _, again := range []struct {
		user, team uint64
		name       string
	}{
		{tgSeller, arrSellingTeam, "lebaran 2026"},
		{tgSeller, arrSellingTeam, "LEBARAN\t2026"},
		{tgWarehouse, arrWarehouse, " lEbArAn  2026"},
	} {
		got, err := tgCreate(svc, again.user, again.team, again.name)
		if err != nil {
			t.Fatalf("create %q: %v", again.name, err)
		}

		if got.GetCreated() || got.GetTag().GetId() != made.GetTag().GetId() || got.GetTag().GetName() != "Lebaran 2026" {
			t.Fatalf("create %q by team %d = %v, want the existing tag %d, not created", again.name, again.team, got, made.GetTag().GetId())
		}
	}

	if n := tagsNamed(t, db, "Lebaran 2026"); n != 1 {
		t.Fatalf("%d tags named \"Lebaran 2026\", want 1 — a twin was made", n)
	}
}

// A NAME THE APP'S OR AN ADMIN'S SYSTEM TAG CARRIES answers that system tag — a team's user does not make a custom twin
// of *Barang kurang*, and gets no system tag made either.
func TestRestockTagCreate_ASystemNameAnswersTheSystemTag(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	kurang := appTagID(t, db, taskMissing)
	audit := seedTag(t, db, "Audit Gudang", "system")

	for name, want := range map[string]uint64{"barang KURANG": kurang, "audit gudang": audit} {
		got, err := tgCreate(svc, tgSeller, arrSellingTeam, name)
		if err != nil {
			t.Fatalf("create %q: %v", name, err)
		}

		if got.GetCreated() || got.GetTag().GetId() != want || got.GetTag().GetType() != tagSystem {
			t.Fatalf("create %q = %v, want the system tag %d", name, got, want)
		}
	}

	if got, _ := tgCreate(svc, tgSeller, arrSellingTeam, "barang kurang"); got.GetTag().GetAppTask() != taskMissing {
		t.Fatalf("the app's tag reads app task %q, want %q", got.GetTag().GetAppTask(), taskMissing)
	}
}

// A NAME OF ONLY SPACES is no name: InvalidArgument, nothing written. (An empty string is refused by the validation the
// interceptor runs before the handler.)
func TestRestockTagCreate_SpacesAreNoName(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	var before int64
	db.Model(&inventory_service_models.Tag{}).Count(&before)

	for _, name := range []string{"   ", "\t \n"} {
		_, err := tgCreate(svc, tgSeller, arrSellingTeam, name)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("create %q: err = %v, want InvalidArgument", name, err)
		}

		_, err = tgSystemCreate(svc, name)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("system create %q: err = %v, want InvalidArgument", name, err)
		}
	}

	var after int64
	db.Model(&inventory_service_models.Tag{}).Count(&after)

	if after != before {
		t.Fatalf("%d tags written for no name", after-before)
	}
}

// AN ADMIN'S SYSTEM TAG: a new name makes a SYSTEM tag with no app task; a taken name — custom or system, any case —
// answers that tag, its type unchanged.
func TestRestockTagSystemCreate_MakesASystemTagOrAnswersTheTakenName(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	made, err := tgSystemCreate(svc, " Audit  Gudang ")
	if err != nil {
		t.Fatalf("system create: %v", err)
	}

	if !made.GetCreated() || made.GetTag().GetName() != "Audit Gudang" || made.GetTag().GetType() != tagSystem ||
		made.GetTag().GetAppTask() != "" {
		t.Fatalf("made = %v, want a new system tag \"Audit Gudang\" with no app task", made)
	}

	prioritas := seedTag(t, db, "Prioritas", "custom")

	got, err := tgSystemCreate(svc, "PRIORITAS")
	if err != nil {
		t.Fatalf("system create a custom tag's name: %v", err)
	}

	if got.GetCreated() || got.GetTag().GetId() != prioritas || got.GetTag().GetType() != tagCustom {
		t.Fatalf("system create \"PRIORITAS\" = %v, want the custom tag %d unchanged", got, prioritas)
	}

	again, err := tgSystemCreate(svc, "audit gudang")
	if err != nil || again.GetCreated() || again.GetTag().GetId() != made.GetTag().GetId() {
		t.Fatalf("system create again = %v, %v — want the same tag", again, err)
	}
}

// ROOT FROM OUTSIDE THE TEAM is stamped as the override on the tag it makes (an-override-is-stamped-in-every-service);
// Root as a member is not.
func TestRestockTagCreate_AnOverrideIsStamped(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	for _, c := range []struct {
		role     role_basev1.Role
		name     string
		override bool
	}{
		{role_basev1.Role_ROLE_UNSPECIFIED, "Dari Luar", true},
		{role_basev1.Role_ROLE_ROOT, "Sebagai Anggota", false},
	} {
		res, err := svc.RestockTagCreate(ctxAs(tgRoot, arrSellingTeam, c.role), connect.NewRequest(&inventoryv1.RestockTagCreateRequest{
			TeamId: arrSellingTeam, Name: c.name,
		}))
		if err != nil {
			t.Fatalf("create as %v: %v", c.role, err)
		}

		var row inventory_service_models.Tag

		err = db.First(&row, res.Msg.GetTag().GetId()).Error
		if err != nil {
			t.Fatal(err)
		}

		if row.CreatedByUserID != tgRoot || row.CreatedByIsOverride != c.override {
			t.Fatalf("as %v: made by %d (override %v), want %d (%v)", c.role, row.CreatedByUserID, row.CreatedByIsOverride, tgRoot, c.override)
		}
	}
}

// requestPolicy is a request message's policy, its scope field and whether its RPC is marked a read.
func requestPolicy(t *testing.T, message, method string) (roles []role_basev1.Role, scoped, read bool) {
	t.Helper()

	desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.inventory.v1." + message))
	if err != nil {
		t.Fatal(err)
	}

	md := desc.(protoreflect.MessageDescriptor)

	policy := san_auth.PolicyOf(md)
	if policy == nil {
		t.Fatalf("%s has no policy", message)
	}

	team := md.Fields().ByName("team_id")
	scoped = team != nil

	rpc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.inventory.v1.RestockRequestService." + method))
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := rpc.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)

	return policy.GetRoles(), scoped, opts.GetIdempotencyLevel() == descriptorpb.MethodOptions_NO_SIDE_EFFECTS
}

var (
	everyTaggingRole = []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_SELLING_CS,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	}
	adminsOnly = []role_basev1.Role{role_basev1.Role_ROLE_ROOT, role_basev1.Role_ROLE_ADMINISTRATOR}
)

// WHO MAY CALL EACH TAG RPC — the ACL is the proto's (CLAUDE.md, the roling system):
//
//   - the list: every role on either side, a READ (so the admin team's monitor sees the chips and the filter too);
//   - a custom tag made, put on, taken off: every role on either side — a WRITE, so a monitor never reaches it;
//   - the admins' acts (a system tag made, put on, taken off; rename; delete; the counting list): Root / the Administrator
//     only — and the ones naming no restock carry no team scope, so no team role could ever be read into them.
func TestRestockTags_Policy(t *testing.T) {
	for _, c := range []struct {
		message, method string
		roles           []role_basev1.Role
		scoped, read    bool
	}{
		{"RestockTagListRequest", "RestockTagList", everyTaggingRole, true, true},
		{"RestockTagManageListRequest", "RestockTagManageList", adminsOnly, false, true},
		{"RestockTagCreateRequest", "RestockTagCreate", everyTaggingRole, true, false},
		{"RestockTagSystemCreateRequest", "RestockTagSystemCreate", adminsOnly, false, false},
		{"RestockTagRenameRequest", "RestockTagRename", adminsOnly, false, false},
		{"RestockTagDeleteRequest", "RestockTagDelete", adminsOnly, false, false},
		{"RestockRequestTagAddRequest", "RestockRequestTagAdd", everyTaggingRole, true, false},
		{"RestockRequestTagRemoveRequest", "RestockRequestTagRemove", everyTaggingRole, true, false},
		{"RestockRequestSystemTagAddRequest", "RestockRequestSystemTagAdd", adminsOnly, true, false},
		{"RestockRequestSystemTagRemoveRequest", "RestockRequestSystemTagRemove", adminsOnly, true, false},
	} {
		roles, scoped, read := requestPolicy(t, c.message, c.method)

		if !slices.Equal(roles, c.roles) {
			t.Errorf("%s roles = %v, want %v", c.message, roles, c.roles)
		}

		if scoped != c.scoped {
			t.Errorf("%s has a team scope: %v, want %v", c.message, scoped, c.scoped)
		}

		if read != c.read {
			t.Errorf("%s is marked a read: %v, want %v", c.message, read, c.read)
		}
	}
}

// errIs reports whether a Connect error carries `code` — a helper for the table tests.
func errIs(err error, code connect.Code) bool {
	var ce *connect.Error
	if !errors.As(err, &ce) {
		return false
	}

	return ce.Code() == code
}
