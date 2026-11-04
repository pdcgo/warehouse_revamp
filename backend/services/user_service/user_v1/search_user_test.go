package user_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

func search(t *testing.T, ctx context.Context, db *gorm.DB, teamID uint64, q string) *userv1.SearchUserResponse {
	t.Helper()

	res, err := newService(t, db).SearchUser(ctx, connect.NewRequest(&userv1.SearchUserRequest{
		Q: q, Limit: 10, TeamId: teamID,
	}))
	if err != nil {
		t.Fatalf("SearchUser(%q): %v", q, err)
	}

	return res.Msg
}

func foundNames(res *userv1.SearchUserResponse) []string {
	out := []string{}
	for _, u := range res.GetUsers() {
		out = append(out, u.GetUsername())
	}

	return out
}

func setPhone(t *testing.T, db *gorm.DB, userID uint64, phone string) {
	t.Helper()

	err := db.Model(&user_service_models.User{}).Where("id = ?", userID).Update("phone_number", phone).Error
	if err != nil {
		t.Fatalf("set phone: %v", err)
	}
}

// Root and the Administrator keep the broad search: any part of a name or username.
func TestSearchUser_RootMatchesAnyPart(t *testing.T) {
	db := san_testdb.DB(t)

	insertUser(t, db, "charlie", "pw12345678")
	insertUser(t, db, "diana", "pw12345678")

	for name, ctx := range map[string]context.Context{"root": asRoot(t, db), "administrator": asAdministrator(t, db)} {
		got := foundNames(search(t, ctx, db, whTeam, "char"))
		if len(got) != 1 || got[0] != "charlie" {
			t.Fatalf("%s searching 'char' found %v, want charlie only", name, got)
		}
	}
}

func TestSearchUser_RespectsLimit(t *testing.T) {
	db := san_testdb.DB(t)

	for _, n := range []string{"teama", "teamb", "teamc"} {
		insertUser(t, db, n, "pw12345678")
	}

	res, err := newService(t, db).SearchUser(asRoot(t, db), connect.NewRequest(&userv1.SearchUserRequest{
		Q:     "team",
		Limit: 2,
	}))
	if err != nil {
		t.Fatalf("SearchUser: %v", err)
	}

	if len(res.Msg.GetUsers()) != 2 {
		t.Fatalf("limit 2 returned %d users", len(res.Msg.GetUsers()))
	}
}

// managers-search-by-exact-username-phone-or-email: an Owner or an Admin finds a person by their WHOLE
// username, email or phone — never by a fragment, so never a browse of other teams' people.
func TestSearchUser_AManagerFindsOnlyTheWholeHandle(t *testing.T) {
	db := san_testdb.DB(t)

	ani := insertUser(t, db, "anilestari", "pw12345678")
	setPhone(t, db, ani, "+6281234567890") // stored in its one form (a-phone-is-saved-in-international-form)
	insertUser(t, db, "anirahma", "pw12345678")

	managers := map[string]role_basev1.Role{
		"whowner": role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		"whadmin": role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
	}

	for username, role := range managers {
		ctx, _ := asMember(t, db, username, whTeam, role)

		found := map[string]bool{
			"anilestari":         true,
			"ANILESTARI":         true, // a username is case-blind, as at login
			"anilestari@x.local": true,
			"AniLestari@X.local": true,
			"0812-3456-7890":     true,
			"0812 3456 7890":     true,
			"+62 812 3456 7890":  true, // one number however it is written (Q20d)
			"6281234567890":      true,
			"ani":                false, // a fragment of two usernames
			"3456":               false, // a fragment of a phone
			"anilestari@x":       false,
			"812-3456-7890":      false, // no country, no trunk prefix: not the same digits
		}

		for q, want := range found {
			got := foundNames(search(t, ctx, db, whTeam, q))

			if want && (len(got) != 1 || got[0] != "anilestari") {
				t.Fatalf("%s searching %q found %v, want anilestari", role, q, got)
			}

			if !want && len(got) != 0 {
				t.Fatalf("%s searching %q found %v, want nobody — that is a browse", role, q, got)
			}
		}
	}
}

// a-suspended-user-is-never-picked: for everyone, broad or exact.
func TestSearchUser_LeavesOutSuspended(t *testing.T) {
	db := san_testdb.DB(t)

	citra := insertUser(t, db, "citra", "pw12345678")

	err := db.Model(&user_service_models.User{}).Where("id = ?", citra).Update("is_suspended", true).Error
	if err != nil {
		t.Fatalf("suspend: %v", err)
	}

	owner, _ := asMember(t, db, "owner", whTeam, role_basev1.Role_ROLE_WAREHOUSE_OWNER)

	for name, ctx := range map[string]context.Context{"root": asRoot(t, db), "owner": owner} {
		if got := foundNames(search(t, ctx, db, whTeam, "citra")); len(got) != 0 {
			t.Fatalf("%s found the suspended %v", name, got)
		}
	}
}

// a-result-shows-the-phones-last-four-digits and an-existing-member-gets-change-role: what the popup shows on
// each result.
func TestSearchUser_SaysTheLastFourAndWhoIsAlreadyIn(t *testing.T) {
	db := san_testdb.DB(t)

	ani := insertUser(t, db, "anilestari", "pw12345678")
	setPhone(t, db, ani, "+6281234567890")
	eko := insertUser(t, db, "ekoprasetyo", "pw12345678")
	setPhone(t, db, eko, "0811") // an unreadable number from before 00008, left as it was
	grantRole(t, db, whTeam, eko, role_basev1.Role_ROLE_WAREHOUSE_STAFF)
	grantRole(t, db, sellTeam, ani, role_basev1.Role_ROLE_SELLING_CS)

	ctx := asRoot(t, db)

	res := search(t, ctx, db, whTeam, "a") // both, by the broad search
	if len(res.GetUsers()) < 2 {
		t.Fatalf("found %v, want ani and eko", foundNames(res))
	}

	byName := map[string]*userv1.PublicUser{}
	for _, u := range res.GetUsers() {
		byName[u.GetUsername()] = u
	}

	if got := byName["anilestari"].GetPhoneLast4(); got != "7890" {
		t.Fatalf("ani's last four = %q, want 7890", got)
	}

	// Four digits are the whole number, so none of it is shown.
	if got := byName["ekoprasetyo"].GetPhoneLast4(); got != "" {
		t.Fatalf("a four-digit phone showed %q, want nothing", got)
	}

	// Eko is Staff here; Ani is a member of ANOTHER team, which is no answer about this one.
	roles := res.GetRolesInTeam()
	if roles[eko] != role_basev1.Role_ROLE_WAREHOUSE_STAFF {
		t.Fatalf("eko's role here = %v, want Staff", roles[eko])
	}

	if _, held := roles[ani]; held {
		t.Fatalf("ani reads as already in the team, as %v — she is in another team", roles[ani])
	}

	// A name lookup carries no phone digits: only the search tells namesakes apart.
	picked, err := newService(t, db).UserByIDs(ctx, connect.NewRequest(&userv1.UserByIDsRequest{
		Filter:      &userv1.UserByIdsFilter{Ids: []uint64{ani}},
		DataRequest: []userv1.UserByIdsDataType{userv1.UserByIdsDataType_USER_BY_IDS_DATA_TYPE_PUBLIC_USER},
	}))
	if err != nil {
		t.Fatalf("UserByIDs: %v", err)
	}

	for _, list := range picked.Msg.GetItems() {
		for _, item := range list.GetItems() {
			for _, u := range item.GetPublicUser().GetMapData() {
				if u.GetPhoneLast4() != "" {
					t.Fatalf("UserByIDs leaked phone digits %q", u.GetPhoneLast4())
				}
			}
		}
	}
}

// Create Team's Owner picker searches at team 0, the root team: the new team does not exist yet.
func TestSearchUser_AtTeamZero(t *testing.T) {
	db := san_testdb.DB(t)

	dewi := insertUser(t, db, "dewi", "pw12345678")
	grantRole(t, db, whTeam, dewi, role_basev1.Role_ROLE_WAREHOUSE_OWNER)

	res := search(t, asAdministrator(t, db), db, 0, "dew")
	if got := foundNames(res); len(got) != 1 || got[0] != "dewi" {
		t.Fatalf("found %v, want dewi", got)
	}

	if len(res.GetRolesInTeam()) != 0 {
		t.Fatalf("team 0 reported roles %v, want none", res.GetRolesInTeam())
	}
}

// Root's search keeps the exact arms: a phone refused at Create ("add that person instead") finds that person.
func TestSearchUser_RootFindsByPhoneToo(t *testing.T) {
	db := san_testdb.DB(t)

	ani := insertUser(t, db, "anilestari", "pw12345678")
	setPhone(t, db, ani, "+6281234567890")

	got := foundNames(search(t, asRoot(t, db), db, whTeam, "0812 3456 7890"))
	if len(got) != 1 || got[0] != "anilestari" {
		t.Fatalf("Root searching the phone found %v, want anilestari", got)
	}
}

// only-member-managers-open-the-search, through MONITORING: the interceptor lets the admin team read a team it is not in
// through any marked read, without reading that read's roles. The search's policy leaves the admin team's Admin out
// (the-admin-team-admin-alone-does-not-manage-members), so that Admin, monitoring a selling team, is refused here — it
// would otherwise probe any account by exact handle and read its phone ending. The admin team's Owner is in the policy.
func TestSearchUser_AMonitorIsHeldToThePolicy(t *testing.T) {
	db := san_testdb.DB(t)

	target := insertUser(t, db, "probed", "pw12345678")
	setPhone(t, db, target, "+6281299990000")

	adminAdmin, _ := asMember(t, db, "admadmin", adminTeam, role_basev1.Role_ROLE_ADMIN_ADMINISTRATOR)
	adminOwner, _ := asMember(t, db, "admowner", adminTeam, role_basev1.Role_ROLE_ADMIN_OWNER)

	// The mark the interceptor's step 8b leaves on a monitor's call.
	_, err := newService(t, db).SearchUser(san_auth.WithMonitor(adminAdmin), connect.NewRequest(&userv1.SearchUserRequest{
		Q: "probed", Limit: 10, TeamId: sellTeam,
	}))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("the admin team's Admin monitoring: code = %v, want PermissionDenied", connect.CodeOf(err))
	}

	got := foundNames(search(t, san_auth.WithMonitor(adminOwner), db, sellTeam, "probed"))
	if len(got) != 1 || got[0] != "probed" {
		t.Fatalf("the admin team's Owner monitoring found %v, want probed — its role is in the policy", got)
	}
}

// The guard reads the policy, so the policy is pinned: the admin team's Owner is in it, its Admin is not.
func TestSearchUser_PolicyLeavesTheAdminTeamAdminOut(t *testing.T) {
	descriptor, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.user.v1.SearchUserRequest")
	if err != nil {
		t.Fatalf("find descriptor: %v", err)
	}

	policy := san_auth.PolicyOf(descriptor.(protoreflect.MessageDescriptor))

	has := map[role_basev1.Role]bool{}
	for _, role := range policy.GetRoles() {
		has[role] = true
	}

	if !has[role_basev1.Role_ROLE_ADMIN_OWNER] || has[role_basev1.Role_ROLE_ADMIN_ADMINISTRATOR] {
		t.Fatalf("SearchUser roles = %v, want ADMIN_OWNER in and ADMIN_ADMINISTRATOR out", policy.GetRoles())
	}
}
