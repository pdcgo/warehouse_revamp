package selling_v1_test

import (
	"context"
	"slices"
	"strconv"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// ORDER TAGS (backlog #100 — orders-have-their-own-tag-list and its 🔄 lines, the-order-tags-prototype-is-accepted): the
// orders' OWN list, apart from the restocks'; one list for every team, a name unique within it; a custom tag made and
// put on by either side of the order (its selling team, the warehouse that ships it), every role but a monitor, in every
// status; system tags, rename and delete for Root / the Administrator only; another team's order is NotFound.

const (
	otSeller      uint64 = 21  // a member of the selling team 2
	otWarehouse   uint64 = 31  // a member of the shipping warehouse (testWarehouse)
	otRoot        uint64 = 901 // Root / the Administrator
	otOtherSeller uint64 = 3   // a selling team that placed none of these orders
	otOtherHouse  uint64 = 905 // a warehouse that ships none of them
)

var (
	otSystem = sellingv1.OrderTagType_ORDER_TAG_TYPE_SYSTEM
	otCustom = sellingv1.OrderTagType_ORDER_TAG_TYPE_CUSTOM
)

func otCtx(user uint64) context.Context {
	return san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: user})
}

func otCreate(svc *selling_v1.Service, user, team uint64, name string) (*sellingv1.OrderTagCreateResponse, error) {
	res, err := svc.OrderTagCreate(otCtx(user), connect.NewRequest(&sellingv1.OrderTagCreateRequest{TeamId: team, Name: name}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

func otSystemCreate(svc *selling_v1.Service, name string) (*sellingv1.OrderTagSystemCreateResponse, error) {
	res, err := svc.OrderTagSystemCreate(otCtx(otRoot), connect.NewRequest(&sellingv1.OrderTagSystemCreateRequest{Name: name}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

func otAdd(svc *selling_v1.Service, user, team, orderID, tagID uint64) ([]*sellingv1.OrderTag, error) {
	res, err := svc.OrderTagAdd(otCtx(user), connect.NewRequest(&sellingv1.OrderTagAddRequest{
		TeamId: team, OrderId: orderID, TagId: tagID,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetTags(), nil
}

func otRemove(svc *selling_v1.Service, user, team, orderID, tagID uint64) ([]*sellingv1.OrderTag, error) {
	res, err := svc.OrderTagRemove(otCtx(user), connect.NewRequest(&sellingv1.OrderTagRemoveRequest{
		TeamId: team, OrderId: orderID, TagId: tagID,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetTags(), nil
}

// otSeed writes an order tag of `kind` ("system" / "custom") straight into the table and returns its id.
func otSeed(t *testing.T, db *gorm.DB, name, kind string) uint64 {
	t.Helper()

	tag := selling_service_models.OrderTag{Name: name, Type: kind}

	err := db.Create(&tag).Error
	if err != nil {
		t.Fatalf("seed order tag %q: %v", name, err)
	}

	return tag.ID
}

// otOn puts a tag on an order straight in the table.
func otOn(t *testing.T, db *gorm.DB, orderID, tagID uint64) {
	t.Helper()

	err := db.Create(&selling_service_models.OrderTagLink{OrderID: orderID, TagID: tagID}).Error
	if err != nil {
		t.Fatalf("tag %d on order %d: %v", tagID, orderID, err)
	}
}

// otNamesCalled counts the order tags named `name`, any case — more than one is a twin.
func otNamesCalled(t *testing.T, db *gorm.DB, name string) int64 {
	t.Helper()

	var n int64

	err := db.
		Model(&selling_service_models.OrderTag{}).
		Where("lower(name) = lower(?)", name).
		Count(&n).
		Error
	if err != nil {
		t.Fatal(err)
	}

	return n
}

// otLinks is how many tags the order carries, read from the table.
func otLinks(t *testing.T, db *gorm.DB, orderID uint64) int64 {
	t.Helper()

	var n int64

	err := db.
		Model(&selling_service_models.OrderTagLink{}).
		Where("order_id = ?", orderID).
		Count(&n).
		Error
	if err != nil {
		t.Fatal(err)
	}

	return n
}

func otNames(tags []*sellingv1.OrderTag) []string {
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		out = append(out, tag.GetName())
	}

	return out
}

// otSetStatus puts an order straight into `status` — tagging reads no status, so every one is reached directly.
func otSetStatus(t *testing.T, db *gorm.DB, orderID uint64, status string) {
	t.Helper()

	err := db.Exec(`UPDATE orders SET status = ? WHERE id = ?`, status, orderID).Error
	if err != nil {
		t.Fatalf("order %d to %s: %v", orderID, status, err)
	}
}

// otDetailTags is the order's tags as `team` reads them on its order page.
func otDetailTags(t *testing.T, svc *selling_v1.Service, team, orderID uint64) []string {
	t.Helper()

	res, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{TeamId: team, OrderId: orderID}))
	if err != nil {
		t.Fatalf("OrderDetail(team %d, order %d): %v", team, orderID, err)
	}

	return otNames(res.Msg.GetOrder().GetTags())
}

// ── Making a tag ─────────────────────────────────────────────────────────────────────────────────────────────────

// A NEW NAME IS A NEW CUSTOM TAG, kept trimmed with its spaces folded and its case as typed, with who made it. The same
// name again — another case, other spaces, from the WAREHOUSE (one list for every team) — answers that tag: created false,
// the same id, no twin.
func TestOrderTagCreate_OneNameIsOneTag(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	made, err := otCreate(svc, otSeller, 2, "  Kirim   Pagi ")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if !made.GetCreated() || made.GetTag().GetName() != "Kirim Pagi" || made.GetTag().GetType() != otCustom || made.GetTag().GetId() == 0 {
		t.Fatalf("made = %v, want a new custom tag named \"Kirim Pagi\"", made)
	}

	var row selling_service_models.OrderTag

	err = db.First(&row, made.GetTag().GetId()).Error
	if err != nil {
		t.Fatal(err)
	}

	if row.CreatedByUserID != otSeller || row.CreatedByIsOverride {
		t.Fatalf("the tag reads made by %d (override %v), want %d", row.CreatedByUserID, row.CreatedByIsOverride, otSeller)
	}

	for _, again := range []struct {
		user, team uint64
		name       string
	}{
		{otSeller, 2, "kirim pagi"},
		{otSeller, 2, "KIRIM\tPAGI"},
		{otWarehouse, testWarehouse, " kIrIm  pagi"},
		{otSeller, otOtherSeller, "Kirim Pagi"},
	} {
		got, err := otCreate(svc, again.user, again.team, again.name)
		if err != nil {
			t.Fatalf("create %q: %v", again.name, err)
		}

		if got.GetCreated() || got.GetTag().GetId() != made.GetTag().GetId() || got.GetTag().GetName() != "Kirim Pagi" {
			t.Fatalf("create %q by team %d = %v, want the existing tag %d, not created", again.name, again.team, got, made.GetTag().GetId())
		}
	}

	if n := otNamesCalled(t, db, "Kirim Pagi"); n != 1 {
		t.Fatalf("%d order tags named \"Kirim Pagi\", want 1 — a twin was made", n)
	}
}

// THE ORDERS' LIST IS ITS OWN (orders-have-their-own-tag-list): a name the RESTOCKS' list carries — the app's *Barang
// kurang*, seeded by inventory 00055 — is free here: making it makes a new CUSTOM order tag, and the orders' list never
// shows a restock tag.
func TestOrderTagCreate_ARestockTagsNameIsFree(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	var restockTags int64

	err := db.Raw(`SELECT count(*) FROM tags WHERE lower(name) IN ('barang kurang', 'barang rusak')`).Scan(&restockTags).Error
	if err != nil || restockTags != 2 {
		t.Fatalf("the restocks' list carries %d of its problem tags (%v), want 2 — the fixture moved", restockTags, err)
	}

	made, err := otCreate(svc, otSeller, 2, "Barang kurang")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if !made.GetCreated() || made.GetTag().GetType() != otCustom {
		t.Fatalf("create \"Barang kurang\" = %v, want a NEW custom order tag — the restocks' list is another list", made)
	}

	list, err := svc.OrderTagList(otCtx(otSeller), connect.NewRequest(&sellingv1.OrderTagListRequest{
		TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 200},
	}))
	if err != nil {
		t.Fatal(err)
	}

	if names := otNames(list.Msg.GetTags()); slices.Contains(names, "Barang rusak") || !slices.Contains(names, "Barang kurang") {
		t.Fatalf("the orders' list = %v — want its own \"Barang kurang\" and never the restocks' \"Barang rusak\"", names)
	}
}

// A NAME OF ONLY SPACES is no name: InvalidArgument, nothing written.
func TestOrderTagCreate_SpacesAreNoName(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	var before, after int64

	db.Model(&selling_service_models.OrderTag{}).Count(&before)

	for _, name := range []string{"   ", "\t \n"} {
		_, err := otCreate(svc, otSeller, 2, name)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("create %q: err = %v, want InvalidArgument", name, err)
		}

		_, err = otSystemCreate(svc, name)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("system create %q: err = %v, want InvalidArgument", name, err)
		}
	}

	db.Model(&selling_service_models.OrderTag{}).Count(&after)

	if after != before {
		t.Fatalf("%d tags written for no name", after-before)
	}
}

// AN ADMIN'S SYSTEM TAG: a new name makes a SYSTEM tag; a taken name — custom or system, any case — answers that tag,
// its type unchanged. A team's custom create of a system tag's name answers the system tag, never a custom twin.
func TestOrderTagSystemCreate_MakesASystemTagOrAnswersTheTakenName(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	made, err := otSystemCreate(svc, " Audit  Admin ")
	if err != nil {
		t.Fatalf("system create: %v", err)
	}

	if !made.GetCreated() || made.GetTag().GetName() != "Audit Admin" || made.GetTag().GetType() != otSystem {
		t.Fatalf("made = %v, want a new system tag \"Audit Admin\"", made)
	}

	vip := otSeed(t, db, "VIP", "custom")

	got, err := otSystemCreate(svc, "vip")
	if err != nil || got.GetCreated() || got.GetTag().GetId() != vip || got.GetTag().GetType() != otCustom {
		t.Fatalf("system create \"vip\" = %v, %v — want the custom tag %d unchanged", got, err, vip)
	}

	team, err := otCreate(svc, otSeller, 2, "AUDIT ADMIN")
	if err != nil || team.GetCreated() || team.GetTag().GetId() != made.GetTag().GetId() || team.GetTag().GetType() != otSystem {
		t.Fatalf("a team's create of the system tag's name = %v, %v — want the system tag %d", team, err, made.GetTag().GetId())
	}
}

// ROOT FROM OUTSIDE THE TEAM is stamped as the override on the tag it makes and on the link it puts on
// (an-override-is-stamped-in-every-service); Root as a member is not.
func TestOrderTags_AnOverrideIsStamped(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko Melati", "MEL-OT", "shopee")

	for i, c := range []struct {
		role     role_basev1.Role
		name     string
		override bool
	}{
		{rootOutside, "Dari Luar", true},
		{role_basev1.Role_ROLE_ROOT, "Sebagai Anggota", false},
	} {
		ctx := asScoped(otRoot, 2, c.role)

		res, err := svc.OrderTagCreate(ctx, connect.NewRequest(&sellingv1.OrderTagCreateRequest{TeamId: 2, Name: c.name}))
		if err != nil {
			t.Fatalf("create as %v: %v", c.role, err)
		}

		var row selling_service_models.OrderTag

		err = db.First(&row, res.Msg.GetTag().GetId()).Error
		if err != nil {
			t.Fatal(err)
		}

		if row.CreatedByUserID != otRoot || row.CreatedByIsOverride != c.override {
			t.Fatalf("case %d: made by %d (override %v), want %d (%v)", i, row.CreatedByUserID, row.CreatedByIsOverride, otRoot, c.override)
		}

		order := placeOrder(t, svc, 2, shop)

		_, err = svc.OrderTagAdd(ctx, connect.NewRequest(&sellingv1.OrderTagAddRequest{TeamId: 2, OrderId: order, TagId: row.ID}))
		if err != nil {
			t.Fatalf("add as %v: %v", c.role, err)
		}

		var link selling_service_models.OrderTagLink

		err = db.Where("order_id = ? AND tag_id = ?", order, row.ID).Take(&link).Error
		if err != nil {
			t.Fatal(err)
		}

		if link.AddedByUserID != otRoot || link.AddedByIsOverride != c.override {
			t.Fatalf("case %d: put on by %d (override %v), want %d (%v)", i, link.AddedByUserID, link.AddedByIsOverride, otRoot, c.override)
		}
	}
}

// ── Who may call what — the proto's ACL ─────────────────────────────────────────────────────────────────────────

// otPolicy is a request message's policy, whether it has a team scope and whether its RPC is marked a read.
func otPolicy(t *testing.T, message, method string) (roles []role_basev1.Role, scoped, read bool) {
	t.Helper()

	desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.selling.v1." + message))
	if err != nil {
		t.Fatal(err)
	}

	md := desc.(protoreflect.MessageDescriptor)

	policy := san_auth.PolicyOf(md)
	if policy == nil {
		t.Fatalf("%s has no policy", message)
	}

	scoped = md.Fields().ByName("team_id") != nil

	rpc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.selling.v1.OrderService." + method))
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := rpc.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)

	return policy.GetRoles(), scoped, opts.GetIdempotencyLevel() == descriptorpb.MethodOptions_NO_SIDE_EFFECTS
}

// WHO MAY CALL EACH TAG RPC (the ACL is the proto's):
//
//   - the list: every role on either side, a READ (the admin team's monitor sees the chips and the filter too);
//   - a custom tag made, put on, taken off: every role that writes on an order, both sides — a WRITE, so a monitor never
//     reaches it (only a NO_SIDE_EFFECTS RPC lets a monitor in);
//   - the admins' acts (a system tag made, put on, taken off; rename; delete; the counting list): Root / the
//     Administrator only — and the ones naming no order carry no team scope, so no team role could be read into them.
func TestOrderTags_Policy(t *testing.T) {
	everyTaggingRole := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_SELLING_CS,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	}
	adminsOnly := []role_basev1.Role{role_basev1.Role_ROLE_ROOT, role_basev1.Role_ROLE_ADMINISTRATOR}

	for _, c := range []struct {
		message, method string
		roles           []role_basev1.Role
		scoped, read    bool
	}{
		{"OrderTagListRequest", "OrderTagList", everyTaggingRole, true, true},
		{"OrderTagManageListRequest", "OrderTagManageList", adminsOnly, false, true},
		{"OrderTagCreateRequest", "OrderTagCreate", everyTaggingRole, true, false},
		{"OrderTagSystemCreateRequest", "OrderTagSystemCreate", adminsOnly, false, false},
		{"OrderTagRenameRequest", "OrderTagRename", adminsOnly, false, false},
		{"OrderTagDeleteRequest", "OrderTagDelete", adminsOnly, false, false},
		{"OrderTagAddRequest", "OrderTagAdd", everyTaggingRole, true, false},
		{"OrderTagRemoveRequest", "OrderTagRemove", everyTaggingRole, true, false},
		{"OrderSystemTagAddRequest", "OrderSystemTagAdd", adminsOnly, true, false},
		{"OrderSystemTagRemoveRequest", "OrderSystemTagRemove", adminsOnly, true, false},
	} {
		roles, scoped, read := otPolicy(t, c.message, c.method)

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

	// The tag writes reach exactly the roles that write a note on the order — "every role that may write on the order".
	noteRoles, _, _ := otPolicy(t, "OrderNoteCreateRequest", "OrderNoteCreate")
	if !slices.Equal(noteRoles, everyTaggingRole) {
		t.Errorf("OrderNoteCreate's roles %v are not the tag writes' %v — the two sides' writers drifted", noteRoles, everyTaggingRole)
	}
}

// ── Putting a tag on and taking it off ───────────────────────────────────────────────────────────────────────────

var everyOrderStatus = []string{
	"pending", "processed", "picked", "shipping", "shipped", "completed", "problem", "lost", "return", "return_completed",
	"cancel",
}

// BOTH SIDES, EVERY STATUS: the selling team and the warehouse that ships the order each put a custom tag on and take
// it off, in each of the eleven statuses; the answer is the order's tags after, and both sides read the same set on
// their order page. Already on / not on is no change.
func TestOrderTagAdd_BothSidesInEveryStatus(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko Melati", "MEL-OT", "shopee")

	vip := otSeed(t, db, "VIP", "custom")
	ulang := otSeed(t, db, "Kemasan Ulang", "custom")

	for _, status := range everyOrderStatus {
		order := placeOrder(t, svc, 2, shop)
		otSetStatus(t, db, order, status)

		got, err := otAdd(svc, otSeller, 2, order, vip)
		if err != nil || !slices.Equal(otNames(got), []string{"VIP"}) {
			t.Fatalf("%s: the seller's add = %v, %v — want [VIP]", status, otNames(got), err)
		}

		got, err = otAdd(svc, otWarehouse, testWarehouse, order, ulang)
		if err != nil || !slices.Equal(otNames(got), []string{"Kemasan Ulang", "VIP"}) {
			t.Fatalf("%s: the warehouse's add = %v, %v — want [Kemasan Ulang VIP]", status, otNames(got), err)
		}

		// Already on: no change, no error, no second row.
		_, err = otAdd(svc, otSeller, 2, order, ulang)
		if err != nil || otLinks(t, db, order) != 2 {
			t.Fatalf("%s: adding a tag already on = %v, %d links — want no change", status, err, otLinks(t, db, order))
		}

		for _, team := range []uint64{2, testWarehouse} {
			if names := otDetailTags(t, svc, team, order); !slices.Equal(names, []string{"Kemasan Ulang", "VIP"}) {
				t.Fatalf("%s: team %d reads %v on its order page — want the one set [Kemasan Ulang VIP]", status, team, names)
			}
		}

		// Either side takes off what the other put on (one set).
		got, err = otRemove(svc, otWarehouse, testWarehouse, order, vip)
		if err != nil || !slices.Equal(otNames(got), []string{"Kemasan Ulang"}) {
			t.Fatalf("%s: the warehouse's remove of the seller's tag = %v, %v", status, otNames(got), err)
		}

		got, err = otRemove(svc, otSeller, 2, order, ulang)
		if err != nil || len(got) != 0 {
			t.Fatalf("%s: the seller's remove of the warehouse's tag = %v, %v", status, otNames(got), err)
		}

		// Not on: no change.
		_, err = otRemove(svc, otSeller, 2, order, ulang)
		if err != nil || otLinks(t, db, order) != 0 {
			t.Fatalf("%s: removing a tag not on = %v, %d links", status, err, otLinks(t, db, order))
		}
	}
}

// ANOTHER TEAM'S ORDER IS NotFound — another seller, a warehouse that does not ship it, the root team (neither side), and
// the selling team's RETURN warehouse when it is not the one shipping it (it reads the order in return, orderReaders'
// third arm, but is not a side of it) — for the team's and the admins' RPCs alike. Nothing is written.
func TestOrderTagAdd_AnotherTeamsOrderIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko Melati", "MEL-OT", "shopee")

	order := placeOrder(t, svc, 2, shop)
	vip := otSeed(t, db, "VIP", "custom")
	audit := otSeed(t, db, "Audit Admin", "system")

	err := db.Exec(`UPDATE team_return_configurations SET warehouse_id = ? WHERE team_id = 2`, otOtherHouse+1).Error
	if err != nil {
		t.Fatal(err)
	}

	otSetStatus(t, db, order, "return")

	if names := otDetailTags(t, svc, otOtherHouse+1, order); len(names) != 0 {
		t.Fatalf("the return warehouse reads tags %v, want none yet", names)
	}

	for _, team := range []uint64{otOtherSeller, otOtherHouse, san_auth.RootTeamID, otOtherHouse + 1} {
		_, err = otAdd(svc, otSeller, team, order, vip)
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("team %d's add: err = %v, want NotFound", team, err)
		}

		_, err = otRemove(svc, otSeller, team, order, vip)
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("team %d's remove: err = %v, want NotFound", team, err)
		}

		_, err = svc.OrderSystemTagAdd(otCtx(otRoot), connect.NewRequest(&sellingv1.OrderSystemTagAddRequest{
			TeamId: team, OrderId: order, TagId: audit,
		}))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("an admin's system tag add naming team %d: err = %v, want NotFound", team, err)
		}
	}

	if n := otLinks(t, db, order); n != 0 {
		t.Fatalf("%d tags written onto another team's order", n)
	}

	// An unknown order and an unknown tag read NotFound too.
	_, err = otAdd(svc, otSeller, 2, order+1_000_000, vip)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("an unknown order: err = %v, want NotFound", err)
	}

	_, err = otAdd(svc, otSeller, 2, order, vip+1_000_000)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("an unknown tag: err = %v, want NotFound", err)
	}
}

// A SYSTEM TAG IS THE ADMINS': the team's add / remove refuses it (PermissionDenied), whoever calls — the seller, the
// warehouse, or root through the team's RPC; the admins' RPCs put it on and take it off from either side, in any status,
// and refuse a custom tag (InvalidArgument). A user's remove never takes a system tag off.
func TestOrderSystemTag_IsTheAdmins(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko Melati", "MEL-OT", "shopee")

	order := placeOrder(t, svc, 2, shop)
	otSetStatus(t, db, order, "completed")

	audit := otSeed(t, db, "Audit Admin", "system")
	vip := otSeed(t, db, "VIP", "custom")

	for _, c := range []struct{ user, team uint64 }{{otSeller, 2}, {otWarehouse, testWarehouse}, {otRoot, 2}} {
		_, err := otAdd(svc, c.user, c.team, order, audit)
		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("user %d's add of a system tag: err = %v, want PermissionDenied", c.user, err)
		}
	}

	for _, team := range []uint64{2, testWarehouse} {
		res, err := svc.OrderSystemTagAdd(otCtx(otRoot), connect.NewRequest(&sellingv1.OrderSystemTagAddRequest{
			TeamId: team, OrderId: order, TagId: audit,
		}))
		if err != nil || !slices.Equal(otNames(res.Msg.GetTags()), []string{"Audit Admin"}) {
			t.Fatalf("the admin's system tag on from team %d: %v", team, err)
		}

		_, err = otRemove(svc, otSeller, 2, order, audit)
		if connect.CodeOf(err) != connect.CodePermissionDenied || otLinks(t, db, order) != 1 {
			t.Fatalf("a user's remove of a system tag: err = %v, %d links — want PermissionDenied, the tag kept", err, otLinks(t, db, order))
		}

		_, err = svc.OrderSystemTagRemove(otCtx(otRoot), connect.NewRequest(&sellingv1.OrderSystemTagRemoveRequest{
			TeamId: team, OrderId: order, TagId: audit,
		}))
		if err != nil || otLinks(t, db, order) != 0 {
			t.Fatalf("the admin's system tag off from team %d: %v, %d links", team, err, otLinks(t, db, order))
		}
	}

	_, err := svc.OrderSystemTagAdd(otCtx(otRoot), connect.NewRequest(&sellingv1.OrderSystemTagAddRequest{
		TeamId: 2, OrderId: order, TagId: vip,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("the admins' RPC with a custom tag: err = %v, want InvalidArgument", err)
	}

	// System first, then by name, on every read.
	otOn(t, db, order, vip)
	otOn(t, db, order, audit)

	if names := otDetailTags(t, svc, 2, order); !slices.Equal(names, []string{"Audit Admin", "VIP"}) {
		t.Fatalf("the order's tags read %v, want the system's first: [Audit Admin VIP]", names)
	}
}

// ── The admins' list, rename and delete ──────────────────────────────────────────────────────────────────────────

// RENAME, the admins': a custom or a system tag; every order carrying it reads the new name at once. A name ANOTHER tag
// carries, any case, is AlreadyExists; a change of case alone renames; an unknown tag is NotFound.
func TestOrderTagRename(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko Melati", "MEL-OT", "shopee")

	order := placeOrder(t, svc, 2, shop)
	vip := otSeed(t, db, "VIP", "custom")
	audit := otSeed(t, db, "Audit Admin", "system")
	otOn(t, db, order, vip)

	rename := func(tagID uint64, name string) (*sellingv1.OrderTag, error) {
		res, err := svc.OrderTagRename(otCtx(otRoot), connect.NewRequest(&sellingv1.OrderTagRenameRequest{TagId: tagID, Name: name}))
		if err != nil {
			return nil, err
		}

		return res.Msg.GetTag(), nil
	}

	got, err := rename(vip, "  VIP   Gold ")
	if err != nil || got.GetName() != "VIP Gold" || got.GetType() != otCustom {
		t.Fatalf("rename = %v, %v — want \"VIP Gold\"", got, err)
	}

	if names := otDetailTags(t, svc, testWarehouse, order); !slices.Equal(names, []string{"VIP Gold"}) {
		t.Fatalf("the order reads %v after the rename", names)
	}

	_, err = rename(vip, "audit ADMIN")
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("rename to another tag's name: err = %v, want AlreadyExists", err)
	}

	got, err = rename(audit, "AUDIT admin")
	if err != nil || got.GetName() != "AUDIT admin" || got.GetType() != otSystem {
		t.Fatalf("a change of case alone = %v, %v — want it renamed, still system", got, err)
	}

	_, err = rename(vip+1_000_000, "Apa Saja")
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("an unknown tag: err = %v, want NotFound", err)
	}

	_, err = rename(vip, "   ")
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a name of spaces: err = %v, want InvalidArgument", err)
	}
}

// DELETE, the admins': the tag leaves the list AND comes off every order that carries it — every team's — and says how
// many; the admins' list counted them before. A second delete is NotFound.
func TestOrderTagDelete_ComesOffEveryOrder(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	melati := insertShop(t, db, 2, "Toko Melati", "MEL-OT", "shopee")
	kenanga := insertShop(t, db, otOtherSeller, "Toko Kenanga", "KEN-OT", "shopee")

	a := placeOrder(t, svc, 2, melati)
	b := placeOrder(t, svc, otOtherSeller, kenanga)
	c := placeOrder(t, svc, 2, melati)

	ulang := otSeed(t, db, "Kemasan Ulang", "custom")
	vip := otSeed(t, db, "VIP", "custom")
	otOn(t, db, a, ulang)
	otOn(t, db, b, ulang)
	otOn(t, db, c, vip)

	manage, err := svc.OrderTagManageList(otCtx(otRoot), connect.NewRequest(&sellingv1.OrderTagManageListRequest{
		Page: &commonv1.CommonPagination{Page: 1, Limit: 200},
	}))
	if err != nil {
		t.Fatal(err)
	}

	counts := map[uint64]uint64{}
	for _, tag := range manage.Msg.GetTags() {
		counts[tag.GetId()] = tag.GetOrderCount()
	}

	if counts[ulang] != 2 || counts[vip] != 1 {
		t.Fatalf("Kelola tag counts %v, want Kemasan Ulang 2 (two teams' orders) and VIP 1", counts)
	}

	res, err := svc.OrderTagDelete(otCtx(otRoot), connect.NewRequest(&sellingv1.OrderTagDeleteRequest{TagId: ulang}))
	if err != nil || res.Msg.GetOrderCount() != 2 {
		t.Fatalf("delete = %v, %v — want it off 2 orders", res, err)
	}

	if otLinks(t, db, a) != 0 || otLinks(t, db, b) != 0 || otLinks(t, db, c) != 1 || otNamesCalled(t, db, "Kemasan Ulang") != 0 {
		t.Fatalf("after the delete: a %d, b %d, c %d links; %d tags named — want 0, 0, 1 and none",
			otLinks(t, db, a), otLinks(t, db, b), otLinks(t, db, c), otNamesCalled(t, db, "Kemasan Ulang"))
	}

	_, err = svc.OrderTagDelete(otCtx(otRoot), connect.NewRequest(&sellingv1.OrderTagDeleteRequest{TagId: ulang}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("a second delete: err = %v, want NotFound", err)
	}
}

// THE ORDERS' LIST: every team's tags, the system's first then by name (any case), paged, narrowed by `q` (any case,
// spaces folded, a typed % is text).
func TestOrderTagList_EveryTeamsSystemFirstPagedAndSearched(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	otSeed(t, db, "pre-order", "custom")
	otSeed(t, db, "VIP", "custom")
	otSeed(t, db, "Audit Admin", "system")
	otSeed(t, db, "Bonus Stiker", "custom")
	otSeed(t, db, "Promo 50%", "custom")

	list := func(team uint64, q string, page, limit uint32) *sellingv1.OrderTagListResponse {
		res, err := svc.OrderTagList(otCtx(otSeller), connect.NewRequest(&sellingv1.OrderTagListRequest{
			TeamId: team, Q: q, Page: &commonv1.CommonPagination{Page: page, Limit: limit},
		}))
		if err != nil {
			t.Fatal(err)
		}

		return res.Msg
	}

	want := []string{"Audit Admin", "Bonus Stiker", "pre-order", "Promo 50%", "VIP"}

	for _, team := range []uint64{2, testWarehouse, otOtherSeller} {
		if got := otNames(list(team, "", 1, 200).GetTags()); !slices.Equal(got, want) {
			t.Fatalf("team %d reads %v, want %v", team, got, want)
		}
	}

	page2 := list(2, "", 2, 2)
	if got := otNames(page2.GetTags()); !slices.Equal(got, []string{"pre-order", "Promo 50%"}) ||
		page2.GetPageInfo().GetTotalItems() != 5 || page2.GetPageInfo().GetTotalPage() != 3 {
		t.Fatalf("page 2 of 2 = %v (%v)", got, page2.GetPageInfo())
	}

	for q, w := range map[string][]string{
		"  BONUS   stik ": {"Bonus Stiker"},
		"o":               {"Bonus Stiker", "pre-order", "Promo 50%"},
		"%":               {"Promo 50%"},
		"zzz":             {},
	} {
		if got := otNames(list(2, q, 1, 200).GetTags()); !slices.Equal(got, w) {
			t.Fatalf("q %q reads %v, want %v", q, got, w)
		}
	}
}

// ── The filter: one scope for the rows, the tab counts, the Statistik and Ekspor ──────────────────────────────────

// otFixture: two selling teams (2 and 3) shipping from testWarehouse, team 2 also from warehouse 902; tags on some.
type otFixture struct {
	vip, ulang, audit, unused uint64
	tagsOn                    map[uint64][]uint64 // order → its tag ids
	orders                    map[uint64]uint64   // order → its selling team
	wh                        map[uint64]uint64   // order → its warehouse
}

func seedOrderTagFixture(t *testing.T, db *gorm.DB, svc *selling_v1.Service) otFixture {
	t.Helper()

	melati := insertShop(t, db, 2, "Toko Melati", "MEL-OT", "shopee")
	kenanga := insertShop(t, db, otOtherSeller, "Toko Kenanga", "KEN-OT", "shopee")

	f := otFixture{
		vip:    otSeed(t, db, "VIP", "custom"),
		ulang:  otSeed(t, db, "Kemasan Ulang", "custom"),
		audit:  otSeed(t, db, "Audit Admin", "system"),
		unused: otSeed(t, db, "Pre-order", "custom"),
		tagsOn: map[uint64][]uint64{},
		orders: map[uint64]uint64{},
		wh:     map[uint64]uint64{},
	}

	statuses := []string{"pending", "processed", "picked", "shipping", "completed", "cancel", "return"}

	for i := range 21 {
		team, shop := uint64(2), melati
		if i%3 == 2 {
			team, shop = otOtherSeller, kenanga
		}

		order := placeOrder(t, svc, team, shop)
		f.orders[order] = team
		f.wh[order] = testWarehouse

		if team == 2 && i%4 == 1 {
			err := db.Exec(`UPDATE orders SET warehouse_id = 902 WHERE id = ?`, order).Error
			if err != nil {
				t.Fatal(err)
			}

			f.wh[order] = 902
		}

		otSetStatus(t, db, order, statuses[i%len(statuses)])

		var on []uint64

		if i%2 == 0 {
			on = append(on, f.vip)
		}

		if i%3 == 0 {
			on = append(on, f.ulang) // with VIP on every sixth: an order carrying two of the picked
		}

		if i%5 == 4 {
			on = append(on, f.audit)
		}

		for _, tag := range on {
			otOn(t, db, order, tag)
		}

		f.tagsOn[order] = on
	}

	return f
}

// otReads is whether `team` reads the order — its seller, its warehouse, or the root team.
func (f otFixture) otReads(team, order uint64) bool {
	return team == san_auth.RootTeamID || f.orders[order] == team || f.wh[order] == team
}

// otWant is the orders `team` reads that carry ANY of `tags`, by id.
func (f otFixture) otWant(team uint64, tags []uint64) []uint64 {
	var out []uint64

	for order, on := range f.tagsOn {
		if !f.otReads(team, order) {
			continue
		}

		if slices.ContainsFunc(on, func(id uint64) bool { return slices.Contains(tags, id) }) {
			out = append(out, order)
		}
	}

	slices.Sort(out)

	return out
}

// THE ANY-OF FILTER AGREES ON EVERY SURFACE (the-order-tags-prototype-is-accepted: the filter narrows inside the list's
// one scope): for each reader (the root team, both sellers, both warehouses) and each pick (one tag, two tags, a tag on
// no order, a tag with the status tab, a tag with a search), the list's rows over every page are exactly the readable
// orders carrying ANY of the picked — an order carrying two of them listed once — its total says so, the stat's census
// per status counts the same rows, and the export's file holds the same ids with each one's tags in its Tags column.
func TestOrderTagFilter_TheRowsTheTabCountsTheStatAndTheExportAgree(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	f := seedOrderTagFixture(t, db, svc)

	readers := []uint64{san_auth.RootTeamID, 2, otOtherSeller, testWarehouse, 902}
	picks := [][]uint64{{f.vip}, {f.vip, f.ulang}, {f.audit, f.ulang}, {f.unused}, {f.vip, f.ulang, f.audit, f.unused}}

	checked := 0

	for _, team := range readers {
		for _, tags := range picks {
			want := f.otWant(team, tags)

			filter := &sellingv1.OrderListFilter{TagIds: tags}
			got := listEveryPage(t, svc, team, filter, nil)

			ids := slices.Clone(got.ids)
			slices.Sort(ids)

			if !slices.Equal(ids, want) || got.total != uint64(len(want)) {
				t.Fatalf("team %d, tags %v: the list reads %v (total %d), want %v", team, tags, ids, got.total, want)
			}

			// The tab counts: the stat's census under the same filter, per status, totals the rows.
			stat, err := svc.OrderStat(context.Background(), connect.NewRequest(&sellingv1.OrderStatRequest{
				TeamId: team, Filter: statFilterOf(filter),
			}))
			if err != nil {
				t.Fatal(err)
			}

			var census int64
			for _, row := range stat.Msg.GetByStatus() {
				census += row.GetCount()

				tab := listEveryPage(t, svc, team, &sellingv1.OrderListFilter{TagIds: tags, Status: row.GetStatus()}, nil)
				if int64(tab.total) != row.GetCount() {
					t.Fatalf("team %d, tags %v: the %v tab counts %d, its rows %d", team, tags, row.GetStatus(), row.GetCount(), tab.total)
				}
			}

			if census != int64(len(want)) {
				t.Fatalf("team %d, tags %v: the census counts %d, the rows %d", team, tags, census, len(want))
			}

			checked += len(want)
		}
	}

	if checked < 40 {
		t.Fatalf("only %d rows were checked — the fixture no longer exercises the filter", checked)
	}

	// THE FILE: Ekspor under the filter holds exactly the rows, each with its tags (the system's first) in Tags.
	for _, c := range []struct {
		team uint64
		view sellingv1.OrderExportView
	}{
		{2, sellingv1.OrderExportView_ORDER_EXPORT_VIEW_SELLER},
		{testWarehouse, sellingv1.OrderExportView_ORDER_EXPORT_VIEW_WAREHOUSE},
		{san_auth.RootTeamID, sellingv1.OrderExportView_ORDER_EXPORT_VIEW_SELLER},
	} {
		tags := []uint64{f.vip, f.audit}
		run := export(t, db, &fakeExports{}, &sellingv1.OrderExportRequest{
			TeamId: c.team, Filter: &sellingv1.OrderListFilter{TagIds: tags}, View: c.view,
		})

		header := run.rows[0]
		idCol, tagCol := slices.Index(header, "Order ID"), slices.Index(header, "Tags")
		statusCol := slices.Index(header, "Status")

		if tagCol != statusCol+1 {
			t.Fatalf("view %v: the header %v — want Tags right after Status", c.view, header)
		}

		var ids []uint64

		for _, row := range run.rows[1:] {
			id := parseID(t, row[idCol])
			ids = append(ids, id)

			names, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{TeamId: c.team, OrderId: id}))
			if err != nil {
				t.Fatal(err)
			}

			want := joinNames(otNames(names.Msg.GetOrder().GetTags()))
			if cell(row, tagCol) != want {
				t.Fatalf("view %v, order %d: the Tags cell %q, want %q", c.view, id, cell(row, tagCol), want)
			}
		}

		slices.Sort(ids)

		if want := f.otWant(c.team, tags); !slices.Equal(ids, want) {
			t.Fatalf("view %v: the file holds %v, want the list's %v", c.view, ids, want)
		}
	}

	// The rows carry their tags, the system's first — the list's chips.
	page, err := svc.OrderList(context.Background(), connect.NewRequest(&sellingv1.OrderListRequest{
		TeamId: testWarehouse, Filter: &sellingv1.OrderListFilter{TagIds: []uint64{f.audit}},
		Page: &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatal(err)
	}

	for _, row := range orderRows(page.Msg) {
		if names := otNames(row.GetTags()); len(names) == 0 || names[0] != "Audit Admin" {
			t.Fatalf("order %d's row carries %v, want the system tag first", row.GetId(), names)
		}
	}

	// No pick reads every order, untagged ones included.
	if all := listEveryPage(t, svc, 2, &sellingv1.OrderListFilter{}, nil); all.total < 14 {
		t.Fatalf("team 2 reads %d orders unfiltered, want all of its own", all.total)
	}
}

func joinNames(names []string) string {
	out := ""
	for i, name := range names {
		if i > 0 {
			out += ", "
		}

		out += name
	}

	return out
}

func parseID(t *testing.T, text string) uint64 {
	t.Helper()

	id, err := strconv.ParseUint(text, 10, 64)
	if err != nil {
		t.Fatalf("an order id cell %q: %v", text, err)
	}

	return id
}

func cell(row []string, i int) string {
	if i < len(row) {
		return row[i]
	}

	return ""
}
