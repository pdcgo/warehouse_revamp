package product_v1_test

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// PRODUCT TAGS (backlog #147 — products-have-their-own-tag-list and its 🔄 lines, the-team-code-and-product-tags-
// prototype-is-accepted): the products' OWN list, apart from the orders' and the restocks'; one list for every team, a
// name unique within it; a custom tag made and put on by the product's writers in the team that owns it, archived or not;
// system tags, rename and delete for Root / the Administrator only; the app's `need_reprint_code` locked for everyone;
// the tags read by the owner (ProductList, ProductDetail) and every warehouse holding the product (SearchAmong,
// ProductTagsByIds) — never on ProductByIds or Discover.

const (
	ptSeller    uint64 = 71  // a selling Owner of team 12 (melati)
	ptRoot      uint64 = 901 // Root / the Administrator
	ptWarehouse uint64 = 11  // a warehouse holding some of Melati's goods
	ptElsewhere uint64 = 14  // a warehouse holding none of them
)

var (
	ptSystem = productv1.ProductTagType_PRODUCT_TAG_TYPE_SYSTEM
	ptCustom = productv1.ProductTagType_PRODUCT_TAG_TYPE_CUSTOM
)

func ptCtx(user uint64) context.Context {
	return asPerson(user, role_basev1.Role_ROLE_SELLING_OWNER)
}

// ptSeed puts a tag straight on the list, as a migration or an earlier session would have.
func ptSeed(t *testing.T, db *gorm.DB, name, kind string) uint64 {
	t.Helper()

	tag := product_service_models.ProductTag{Name: name, Type: kind}

	err := db.Create(&tag).Error
	if err != nil {
		t.Fatalf("seed tag %q: %v", name, err)
	}

	return tag.ID
}

// ptAppTag is the app's own `need_reprint_code`, as 00010 seeded it — found by its task, never its name.
func ptAppTag(t *testing.T, db *gorm.DB) product_service_models.ProductTag {
	t.Helper()

	var tag product_service_models.ProductTag

	err := db.Where("app_task = ?", product_v1.AppTaskReprintCode).Take(&tag).Error
	if err != nil {
		t.Fatalf("the seeded app tag: %v", err)
	}

	return tag
}

func ptAdd(svc *product_v1.Service, ctx context.Context, team, product, tag uint64) ([]*productv1.ProductTag, error) {
	res, err := svc.ProductTagAdd(ctx, connect.NewRequest(&productv1.ProductTagAddRequest{TeamId: team, ProductId: product, TagId: tag}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetTags(), nil
}

func ptRemove(svc *product_v1.Service, ctx context.Context, team, product, tag uint64) ([]*productv1.ProductTag, error) {
	res, err := svc.ProductTagRemove(ctx, connect.NewRequest(&productv1.ProductTagRemoveRequest{TeamId: team, ProductId: product, TagId: tag}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetTags(), nil
}

func ptSystemAdd(svc *product_v1.Service, team, product, tag uint64) ([]*productv1.ProductTag, error) {
	res, err := svc.ProductSystemTagAdd(ptCtx(ptRoot), connect.NewRequest(&productv1.ProductSystemTagAddRequest{
		TeamId: team, ProductId: product, TagId: tag,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetTags(), nil
}

func ptSystemRemove(svc *product_v1.Service, team, product, tag uint64) ([]*productv1.ProductTag, error) {
	res, err := svc.ProductSystemTagRemove(ptCtx(ptRoot), connect.NewRequest(&productv1.ProductSystemTagRemoveRequest{
		TeamId: team, ProductId: product, TagId: tag,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetTags(), nil
}

func ptNames(tags []*productv1.ProductTag) []string {
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		out = append(out, tag.GetName())
	}

	return out
}

func ptLinks(t *testing.T, db *gorm.DB, product uint64) int64 {
	t.Helper()

	var n int64

	err := db.Model(&product_service_models.ProductTagLink{}).Where("product_id = ?", product).Count(&n).Error
	if err != nil {
		t.Fatal(err)
	}

	return n
}

func ptCode(t *testing.T, err error, want connect.Code, what string) {
	t.Helper()

	if connect.CodeOf(err) != want {
		t.Fatalf("%s: %v, want %v", what, err, want)
	}
}

// ── Who may call what (the ACL is the proto's) ───────────────────────────────────────────────────────────────────

func ptPolicy(t *testing.T, message, method string) (roles []role_basev1.Role, scoped, read bool) {
	t.Helper()

	desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.product.v1." + message))
	if err != nil {
		t.Fatal(err)
	}

	md := desc.(protoreflect.MessageDescriptor)

	policy := san_auth.PolicyOf(md)
	if policy == nil {
		t.Fatalf("%s has no policy", message)
	}

	scoped = md.Fields().ByName("team_id") != nil

	rpc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.product.v1.ProductService." + method))
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := rpc.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)

	return policy.GetRoles(), scoped, opts.GetIdempotencyLevel() == descriptorpb.MethodOptions_NO_SIDE_EFFECTS
}

// WHO MAY CALL EACH TAG RPC:
//
//   - the list and the tags of known products: every role of the owning team and of a warehouse, a READ (a monitor
//     and an agent's credential see the chips and the filter too);
//   - a custom tag made, put on, taken off: the product's WRITERS — exactly ProductUpdate's roles (the selling Owner and
//     Admin, Root, the Administrator), so never CS, a warehouse or a monitor (a write);
//   - the admins' acts (a system tag made, put on, taken off; rename; delete; the counting list): Root / the
//     Administrator only — and the ones naming no product carry no team scope, so no team role could be read into them.
func TestProductTags_Policy(t *testing.T) {
	everyReader := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_SELLING_CS,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	}
	writers := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
	}
	adminsOnly := []role_basev1.Role{role_basev1.Role_ROLE_ROOT, role_basev1.Role_ROLE_ADMINISTRATOR}

	for _, c := range []struct {
		message, method string
		roles           []role_basev1.Role
		scoped, read    bool
	}{
		{"ProductTagListRequest", "ProductTagList", everyReader, true, true},
		{"ProductTagManageListRequest", "ProductTagManageList", adminsOnly, false, true},
		{"ProductTagsByIdsRequest", "ProductTagsByIds", everyReader, true, true},
		{"ProductTagCreateRequest", "ProductTagCreate", writers, true, false},
		{"ProductTagSystemCreateRequest", "ProductTagSystemCreate", adminsOnly, false, false},
		{"ProductTagRenameRequest", "ProductTagRename", adminsOnly, false, false},
		{"ProductTagDeleteRequest", "ProductTagDelete", adminsOnly, false, false},
		{"ProductTagAddRequest", "ProductTagAdd", writers, true, false},
		{"ProductTagRemoveRequest", "ProductTagRemove", writers, true, false},
		{"ProductSystemTagAddRequest", "ProductSystemTagAdd", adminsOnly, true, false},
		{"ProductSystemTagRemoveRequest", "ProductSystemTagRemove", adminsOnly, true, false},
	} {
		roles, scoped, read := ptPolicy(t, c.message, c.method)

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

	// The tag writes reach exactly the roles that write the product — "any user who may write on the product".
	updateRoles, _, _ := ptPolicy(t, "ProductUpdateRequest", "ProductUpdate")
	if !slices.Equal(updateRoles, writers) {
		t.Errorf("ProductUpdate's roles %v are not the tag writes' %v — the product's writers drifted", updateRoles, writers)
	}

	// The tags of known products and the list read what the warehouse's own list and product page read.
	listRoles, _, _ := ptPolicy(t, "ProductListRequest", "ProductList")
	if !slices.Equal(listRoles, everyReader) {
		t.Errorf("ProductList's roles %v are not the tag reads' %v", listRoles, everyReader)
	}
}

// ── The list ─────────────────────────────────────────────────────────────────────────────────────────────────────

// THE APP'S TAG IS SEEDED, LOCKED: the list starts with `need_reprint_code` — a system tag owned by the app task
// "product.code.reprint", its name as the owner wrote it — and lists the system's first, then by name, any case. The
// admins' list counts each tag's products, every team's; the plain list counts nothing. `q` narrows by part of a name.
func TestProductTagList_TheAppsTagFirstThenByName(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	app := ptAppTag(t, db)
	if app.Name != "need_reprint_code" || app.Type != "system" {
		t.Fatalf("the seeded app tag reads %q %q, want need_reprint_code, system", app.Name, app.Type)
	}

	laris := ptSeed(t, db, "laris", "custom")
	ptSeed(t, db, "Audit Admin", "system")
	ptSeed(t, db, "Promo Lebaran", "custom")

	p1 := insertProduct(t, db, melati, "PT-1", "Satu")
	p2 := insertProduct(t, db, kenanga, "PT-2", "Dua")

	for _, p := range []struct{ team, id uint64 }{{melati, p1}, {kenanga, p2}} {
		_, err := ptAdd(svc, ptCtx(ptSeller), p.team, p.id, laris)
		if err != nil {
			t.Fatalf("tag %d: %v", p.id, err)
		}
	}

	page := &commonv1.CommonPagination{Page: 1, Limit: 50}

	list, err := svc.ProductTagList(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductTagListRequest{TeamId: melati, Page: page}))
	if err != nil {
		t.Fatal(err)
	}

	got := list.Msg.GetTags()
	if len(got) < 4 {
		t.Fatalf("the list holds %v", ptNames(got))
	}

	// The app's and the admin's system tags first, by name; then the custom ones by name, any case.
	var ours []*productv1.ProductTag

	for _, tag := range got {
		if slices.Contains([]string{"need_reprint_code", "Audit Admin", "laris", "Promo Lebaran"}, tag.GetName()) {
			ours = append(ours, tag)
		}
	}

	if !slices.Equal(ptNames(ours), []string{"Audit Admin", "need_reprint_code", "laris", "Promo Lebaran"}) {
		t.Fatalf("the list's order = %v, want the system's first, then by name", ptNames(ours))
	}

	if ours[1].GetAppTask() != product_v1.AppTaskReprintCode || ours[1].GetType() != ptSystem || ours[0].GetAppTask() != "" {
		t.Fatalf("app tasks read %q / %q", ours[1].GetAppTask(), ours[0].GetAppTask())
	}

	for _, tag := range got {
		if tag.GetProductCount() != 0 {
			t.Fatalf("the plain list counts %q at %d — only the admins' list counts", tag.GetName(), tag.GetProductCount())
		}
	}

	managed, err := svc.ProductTagManageList(ptCtx(ptRoot), connect.NewRequest(&productv1.ProductTagManageListRequest{Q: "  LAR ", Page: page}))
	if err != nil {
		t.Fatal(err)
	}

	if names := ptNames(managed.Msg.GetTags()); !slices.Equal(names, []string{"laris"}) {
		t.Fatalf("q LAR = %v, want [laris]", names)
	}

	if n := managed.Msg.GetTags()[0].GetProductCount(); n != 2 {
		t.Fatalf("laris is on %d products, want 2 — every team's", n)
	}
}

// ── Making a tag ─────────────────────────────────────────────────────────────────────────────────────────────────

// ONE NAME, ONE TAG: a name already on the products' list — any case, spaces folded — answers that tag and makes no twin,
// the app's own included; an empty name is refused; a system tag is the admins' and carries no app task.
func TestProductTagCreate_OneNameIsOneTag(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	made, err := svc.ProductTagCreate(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductTagCreateRequest{
		TeamId: melati, Name: "  Promo   Lebaran ",
	}))
	if err != nil {
		t.Fatal(err)
	}

	tag := made.Msg.GetTag()
	if !made.Msg.GetCreated() || tag.GetName() != "Promo Lebaran" || tag.GetType() != ptCustom || tag.GetAppTask() != "" {
		t.Fatalf("made %+v created=%v, want a custom Promo Lebaran", tag, made.Msg.GetCreated())
	}

	var row product_service_models.ProductTag

	err = db.Where("id = ?", tag.GetId()).Take(&row).Error
	if err != nil || row.CreatedByUserID != ptSeller {
		t.Fatalf("its maker reads %d (%v), want %d", row.CreatedByUserID, err, ptSeller)
	}

	again, err := svc.ProductTagCreate(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductTagCreateRequest{
		TeamId: kenanga, Name: "PROMO lebaran",
	}))
	if err != nil || again.Msg.GetCreated() || again.Msg.GetTag().GetId() != tag.GetId() {
		t.Fatalf("the same name again = %+v, %v — want the same tag, not created", again.Msg, err)
	}

	app := ptAppTag(t, db)

	asApp, err := svc.ProductTagCreate(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductTagCreateRequest{
		TeamId: melati, Name: "NEED_REPRINT_CODE",
	}))
	if err != nil || asApp.Msg.GetCreated() || asApp.Msg.GetTag().GetId() != app.ID ||
		asApp.Msg.GetTag().GetAppTask() != product_v1.AppTaskReprintCode {
		t.Fatalf("the app tag's name typed = %+v, %v — want the app's tag answered, never a custom twin", asApp.Msg, err)
	}

	_, err = svc.ProductTagCreate(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductTagCreateRequest{TeamId: melati, Name: "   "}))
	ptCode(t, err, connect.CodeInvalidArgument, "a blank name")

	sys, err := svc.ProductTagSystemCreate(ptCtx(ptRoot), connect.NewRequest(&productv1.ProductTagSystemCreateRequest{Name: "Audit Admin"}))
	if err != nil || !sys.Msg.GetCreated() || sys.Msg.GetTag().GetType() != ptSystem || sys.Msg.GetTag().GetAppTask() != "" {
		t.Fatalf("an admin's system tag = %+v, %v", sys.Msg, err)
	}

	// A system tag's name typed as custom answers the system tag (one name, one tag, whatever its type).
	sysAgain, err := svc.ProductTagCreate(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductTagCreateRequest{TeamId: melati, Name: "audit admin"}))
	if err != nil || sysAgain.Msg.GetCreated() || sysAgain.Msg.GetTag().GetType() != ptSystem {
		t.Fatalf("a system tag's name as custom = %+v, %v", sysAgain.Msg, err)
	}
}

// ── Putting a tag on and taking it off ──────────────────────────────────────────────────────────────────────────

// THE OWNING TEAM'S WRITERS, ARCHIVED OR NOT: a custom tag goes on and comes off a product of the scoped team, live or
// archived (the order tags' "every status"); the answer is the product's tags after, the system's first then by name;
// already on / not on is no change. Another team's product is NotFound, an unknown tag NotFound, a system tag — the
// app's included — PermissionDenied (the admins' RPC moves a system tag; nobody's moves the app's).
func TestProductTagAdd_TheOwnersWriters(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	live := insertProduct(t, db, melati, "PT-LIVE", "Hidup")
	archived := insertProduct(t, db, melati, "PT-ARCH", "Arsip")
	theirs := insertProduct(t, db, kenanga, "PT-THEIRS", "Milik Kenanga")

	err := db.Model(&product_service_models.Product{}).Where("id = ?", archived).Update("archived", true).Error
	if err != nil {
		t.Fatal(err)
	}

	laris := ptSeed(t, db, "Laris", "custom")
	promo := ptSeed(t, db, "promo", "custom")
	audit := ptSeed(t, db, "Audit", "system")
	app := ptAppTag(t, db)

	ctx := ptCtx(ptSeller)

	for _, product := range []uint64{live, archived} {
		got, addErr := ptAdd(svc, ctx, melati, product, promo)
		if addErr != nil || !slices.Equal(ptNames(got), []string{"promo"}) {
			t.Fatalf("%d: add promo = %v, %v", product, ptNames(got), addErr)
		}

		got, addErr = ptAdd(svc, ctx, melati, product, laris)
		if addErr != nil || !slices.Equal(ptNames(got), []string{"Laris", "promo"}) {
			t.Fatalf("%d: add Laris = %v, %v — want by name, any case", product, ptNames(got), addErr)
		}

		_, addErr = ptAdd(svc, ctx, melati, product, laris)
		if addErr != nil || ptLinks(t, db, product) != 2 {
			t.Fatalf("%d: adding a tag already on = %v, %d links — want no change", product, addErr, ptLinks(t, db, product))
		}

		got, addErr = ptRemove(svc, ctx, melati, product, promo)
		if addErr != nil || !slices.Equal(ptNames(got), []string{"Laris"}) {
			t.Fatalf("%d: remove promo = %v, %v", product, ptNames(got), addErr)
		}

		_, addErr = ptRemove(svc, ctx, melati, product, promo)
		if addErr != nil || ptLinks(t, db, product) != 1 {
			t.Fatalf("%d: removing a tag not on = %v, %d links", product, addErr, ptLinks(t, db, product))
		}
	}

	_, err = ptAdd(svc, ctx, melati, theirs, laris)
	ptCode(t, err, connect.CodeNotFound, "another team's product")

	_, err = ptRemove(svc, ctx, melati, theirs, laris)
	ptCode(t, err, connect.CodeNotFound, "taking a tag off another team's product")

	_, err = ptAdd(svc, ctx, melati, live, 999_999_999)
	ptCode(t, err, connect.CodeNotFound, "an unknown tag")

	_, err = ptAdd(svc, ctx, melati, live, audit)
	ptCode(t, err, connect.CodePermissionDenied, "a system tag through the writers' RPC")

	_, err = ptAdd(svc, ptCtx(ptRoot), melati, live, app.ID)
	ptCode(t, err, connect.CodePermissionDenied, "the app's tag through the writers' RPC")

	if ptLinks(t, db, theirs) != 0 {
		t.Fatalf("Kenanga's product carries %d tags after the refusals", ptLinks(t, db, theirs))
	}
}

// WHO PUT IT ON is stamped: the writer's id, and whether Root or the Administrator acted from outside the team
// (an-override-is-stamped-in-every-service).
func TestProductTagAdd_StampsWhoPutItOn(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	product := insertProduct(t, db, melati, "PT-STAMP", "Stempel")
	byOwner := ptSeed(t, db, "Owner Tag", "custom")
	byRoot := ptSeed(t, db, "Root Tag", "custom")

	_, err := ptAdd(svc, scopedAs(ptSeller, melati, role_basev1.Role_ROLE_SELLING_OWNER), melati, product, byOwner)
	if err != nil {
		t.Fatal(err)
	}

	_, err = ptAdd(svc, scopedAs(ptRoot, melati, role_basev1.Role_ROLE_UNSPECIFIED), melati, product, byRoot)
	if err != nil {
		t.Fatal(err)
	}

	var links []product_service_models.ProductTagLink

	err = db.Where("product_id = ?", product).Order("tag_id").Find(&links).Error
	if err != nil || len(links) != 2 {
		t.Fatalf("links = %+v, %v", links, err)
	}

	if links[0].AddedByUserID != ptSeller || links[0].AddedByIsOverride {
		t.Fatalf("the owner's link reads %+v", links[0])
	}

	if links[1].AddedByUserID != ptRoot || !links[1].AddedByIsOverride {
		t.Fatalf("root's link from outside reads %+v, want an override", links[1])
	}
}

// AN ADMIN'S SYSTEM TAG goes on and comes off through the admins' RPCs; a custom tag there is InvalidArgument; the app's
// own is FailedPrecondition — locked for admins too.
func TestProductSystemTagAdd_TheAdminsSystemTags(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	product := insertProduct(t, db, melati, "PT-SYS", "Sistem")
	audit := ptSeed(t, db, "Audit", "system")
	laris := ptSeed(t, db, "Laris", "custom")
	app := ptAppTag(t, db)

	_, err := ptAdd(svc, ptCtx(ptSeller), melati, product, laris)
	if err != nil {
		t.Fatal(err)
	}

	got, err := ptSystemAdd(svc, melati, product, audit)
	if err != nil || !slices.Equal(ptNames(got), []string{"Audit", "Laris"}) {
		t.Fatalf("system add = %v, %v — want the system's first", ptNames(got), err)
	}

	_, err = ptSystemAdd(svc, melati, product, laris)
	ptCode(t, err, connect.CodeInvalidArgument, "a custom tag through the admins' RPC")

	_, err = ptSystemAdd(svc, melati, product, app.ID)
	ptCode(t, err, connect.CodeFailedPrecondition, "the app's tag put on by an admin")

	_, err = ptSystemRemove(svc, melati, product, app.ID)
	ptCode(t, err, connect.CodeFailedPrecondition, "the app's tag taken off by an admin")

	_, err = ptSystemAdd(svc, kenanga, product, audit)
	ptCode(t, err, connect.CodeNotFound, "naming a team that does not own the product")

	got, err = ptSystemRemove(svc, melati, product, audit)
	if err != nil || !slices.Equal(ptNames(got), []string{"Laris"}) {
		t.Fatalf("system remove = %v, %v", ptNames(got), err)
	}
}

// THE APP'S TAG, WHERE THE APP PUT IT: nobody takes it off by hand — not a writer, not an admin.
func TestProductTagRemove_TheAppsTagStaysOn(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	product := insertProduct(t, db, melati, "PT-APP", "Aplikasi")
	app := ptAppTag(t, db)

	// The app's own put-on (#149's recompose): a link written by user 0.
	err := db.Create(&product_service_models.ProductTagLink{ProductID: product, TagID: app.ID}).Error
	if err != nil {
		t.Fatal(err)
	}

	_, err = ptRemove(svc, ptCtx(ptSeller), melati, product, app.ID)
	ptCode(t, err, connect.CodePermissionDenied, "a writer taking the app's tag off")

	_, err = ptSystemRemove(svc, melati, product, app.ID)
	ptCode(t, err, connect.CodeFailedPrecondition, "an admin taking the app's tag off")

	if ptLinks(t, db, product) != 1 {
		t.Fatal("the app's tag came off by hand")
	}
}

// ── Rename and delete — the admins' ─────────────────────────────────────────────────────────────────────────────

// RENAME: a custom or an admin's system tag takes a new name — every product reads it at once; a change of case alone is
// a rename; a name another tag carries, any case, is AlreadyExists; the app's tag is FailedPrecondition; an unknown tag
// NotFound; a blank name InvalidArgument.
func TestProductTagRename_TheAdmins(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	product := insertProduct(t, db, melati, "PT-REN", "Nama")
	laris := ptSeed(t, db, "Laris", "custom")
	ptSeed(t, db, "Promo", "custom")
	app := ptAppTag(t, db)

	_, err := ptAdd(svc, ptCtx(ptSeller), melati, product, laris)
	if err != nil {
		t.Fatal(err)
	}

	rename := func(tag uint64, name string) (*productv1.ProductTag, error) {
		res, renameErr := svc.ProductTagRename(ptCtx(ptRoot), connect.NewRequest(&productv1.ProductTagRenameRequest{TagId: tag, Name: name}))
		if renameErr != nil {
			return nil, renameErr
		}

		return res.Msg.GetTag(), nil
	}

	got, err := rename(laris, "  Paling   Laris ")
	if err != nil || got.GetName() != "Paling Laris" {
		t.Fatalf("rename = %+v, %v", got, err)
	}

	got, err = rename(laris, "PALING LARIS")
	if err != nil || got.GetName() != "PALING LARIS" {
		t.Fatalf("a change of case = %+v, %v — want a rename", got, err)
	}

	_, err = rename(laris, "promo")
	ptCode(t, err, connect.CodeAlreadyExists, "another tag's name")

	_, err = rename(laris, "Need_Reprint_Code")
	ptCode(t, err, connect.CodeAlreadyExists, "the app tag's name")

	_, err = rename(app.ID, "cetak ulang")
	ptCode(t, err, connect.CodeFailedPrecondition, "renaming the app's tag")

	_, err = rename(999_999_999, "x")
	ptCode(t, err, connect.CodeNotFound, "an unknown tag")

	_, err = rename(laris, "   ")
	ptCode(t, err, connect.CodeInvalidArgument, "a blank name")

	detail, err := svc.ProductDetail(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductDetailRequest{TeamId: melati, ProductId: product}))
	if err != nil || !slices.Equal(ptNames(detail.Msg.GetProduct().GetTags()), []string{"PALING LARIS"}) {
		t.Fatalf("the product reads %v (%v) after the rename", ptNames(detail.Msg.GetProduct().GetTags()), err)
	}

	if ptAppTag(t, db).Name != "need_reprint_code" {
		t.Fatal("the app's tag was renamed")
	}
}

// DELETE: the tag leaves the list and comes off every product, every team's, in one go — the answer says how many; then
// it is NotFound. The app's tag is FailedPrecondition and stays on its products.
func TestProductTagDelete_OffEveryProduct(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	ours := insertProduct(t, db, melati, "PT-DEL-1", "Satu")
	theirs := insertProduct(t, db, kenanga, "PT-DEL-2", "Dua")
	laris := ptSeed(t, db, "Laris", "custom")
	app := ptAppTag(t, db)

	_, err := ptAdd(svc, ptCtx(ptSeller), melati, ours, laris)
	if err != nil {
		t.Fatal(err)
	}

	_, err = ptAdd(svc, ptCtx(ptSeller), kenanga, theirs, laris)
	if err != nil {
		t.Fatal(err)
	}

	err = db.Create(&product_service_models.ProductTagLink{ProductID: ours, TagID: app.ID}).Error
	if err != nil {
		t.Fatal(err)
	}

	del := func(tag uint64) (uint64, error) {
		res, delErr := svc.ProductTagDelete(ptCtx(ptRoot), connect.NewRequest(&productv1.ProductTagDeleteRequest{TagId: tag}))
		if delErr != nil {
			return 0, delErr
		}

		return res.Msg.GetProductCount(), nil
	}

	off, err := del(laris)
	if err != nil || off != 2 {
		t.Fatalf("delete = %d, %v — want it off 2 products", off, err)
	}

	if ptLinks(t, db, ours) != 1 || ptLinks(t, db, theirs) != 0 {
		t.Fatalf("links after the delete: ours %d, theirs %d — want the app's tag alone on ours", ptLinks(t, db, ours), ptLinks(t, db, theirs))
	}

	_, err = del(laris)
	ptCode(t, err, connect.CodeNotFound, "deleting it again")

	_, err = del(app.ID)
	ptCode(t, err, connect.CodeFailedPrecondition, "deleting the app's tag")

	if ptLinks(t, db, ours) != 1 {
		t.Fatal("the app's tag came off its product")
	}
}

// A PRODUCT DELETED FOR GOOD (no history) takes its tags with it — the links go, the tags stay on the list.
func TestProductDelete_TakesItsTagsWithIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	product := insertProduct(t, db, melati, "PT-GONE", "Hapus")
	laris := ptSeed(t, db, "Laris", "custom")

	_, err := ptAdd(svc, ptCtx(ptSeller), melati, product, laris)
	if err != nil {
		t.Fatal(err)
	}

	_, err = svc.ProductDelete(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductDeleteRequest{TeamId: melati, ProductId: product}))
	if err != nil {
		t.Fatalf("delete the product: %v", err)
	}

	var tags int64

	db.Model(&product_service_models.ProductTag{}).Where("id = ?", laris).Count(&tags)

	if ptLinks(t, db, product) != 0 || tags != 1 {
		t.Fatalf("after the delete: %d links, the tag listed %d times — want 0 and 1", ptLinks(t, db, product), tags)
	}
}

// ── The reads that carry tags — and the ones that never do ─────────────────────────────────────────────────────────

// ptListed is one ProductList page: the ids in order, the rows, and the total.
func ptListed(t *testing.T, svc *product_v1.Service, team uint64, filter *productv1.ProductListFilter) ([]uint64, map[uint64]*productv1.ProductRowItem, uint64) {
	t.Helper()

	res, err := svc.ProductList(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductListRequest{
		TeamId: team,
		Filter: filter,
		Sort: &productv1.ProductListFilterSort{
			SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_ASC,
			S:        &productv1.ProductListFilterSort_Product{Product: productv1.ProductRowSort_PRODUCT_ROW_SORT_NAME},
		},
		Page: &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductList: %v", err)
	}

	return res.Msg.GetIds(), listRows(res.Msg.GetItems()), res.Msg.GetPageInfo().GetTotalItems()
}

// THE OWNER'S LIST: every row carries its tags (the list's Tag column), and the Tag filter keeps the products carrying
// ANY of the picked — the total and the page narrowed alike; archived ones on their own tab, filtered the same.
func TestProductList_TagsOnRowsAndTheTagFilter(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := insertProduct(t, db, melati, "PT-A", "Apel")
	b := insertProduct(t, db, melati, "PT-B", "Beras")
	c := insertProduct(t, db, melati, "PT-C", "Cabai")
	d := insertProduct(t, db, melati, "PT-D", "Daun")
	theirs := insertProduct(t, db, kenanga, "PT-K", "Apel Kenanga")

	laris := ptSeed(t, db, "Laris", "custom")
	promo := ptSeed(t, db, "Promo", "custom")
	audit := ptSeed(t, db, "Audit", "system")
	app := ptAppTag(t, db)

	for _, on := range []struct{ team, product, tag uint64 }{
		{melati, a, laris}, {melati, a, promo}, {melati, b, promo}, {kenanga, theirs, laris},
	} {
		_, err := ptAdd(svc, ptCtx(ptSeller), on.team, on.product, on.tag)
		if err != nil {
			t.Fatal(err)
		}
	}

	_, err := ptSystemAdd(svc, melati, c, audit)
	if err != nil {
		t.Fatal(err)
	}

	err = db.Create(&product_service_models.ProductTagLink{ProductID: a, TagID: app.ID}).Error
	if err != nil {
		t.Fatal(err)
	}

	ids, rows, total := ptListed(t, svc, melati, nil)
	if !slices.Equal(ids, []uint64{a, b, c, d}) || total != 4 {
		t.Fatalf("unfiltered = %v (%d)", ids, total)
	}

	if names := ptNames(rows[a].GetTags()); !slices.Equal(names, []string{"need_reprint_code", "Laris", "Promo"}) {
		t.Fatalf("Apel's tags = %v, want the app's first, then by name", names)
	}

	if rows[a].GetTags()[0].GetAppTask() != product_v1.AppTaskReprintCode {
		t.Fatal("the row's app tag carries no app task — the screen cannot lock it")
	}

	if len(rows[d].GetTags()) != 0 {
		t.Fatalf("Daun carries %v", ptNames(rows[d].GetTags()))
	}

	ids, _, total = ptListed(t, svc, melati, &productv1.ProductListFilter{TagIds: []uint64{promo}})
	if !slices.Equal(ids, []uint64{a, b}) || total != 2 {
		t.Fatalf("Promo = %v (%d), want Apel, Beras", ids, total)
	}

	ids, _, total = ptListed(t, svc, melati, &productv1.ProductListFilter{TagIds: []uint64{laris, audit}})
	if !slices.Equal(ids, []uint64{a, c}) || total != 2 {
		t.Fatalf("Laris OR Audit = %v (%d), want Apel, Cabai — any of them, never Kenanga's", ids, total)
	}

	ids, _, total = ptListed(t, svc, melati, &productv1.ProductListFilter{TagIds: []uint64{app.ID}, Q: "ap"})
	if !slices.Equal(ids, []uint64{a}) || total != 1 {
		t.Fatalf("need_reprint_code + q = %v (%d)", ids, total)
	}

	err = db.Model(&product_service_models.Product{}).Where("id = ?", b).Update("archived", true).Error
	if err != nil {
		t.Fatal(err)
	}

	ids, rows, total = ptListed(t, svc, melati, &productv1.ProductListFilter{
		TagIds: []uint64{promo}, Status: productv1.ProductStatus_PRODUCT_STATUS_ARCHIVED,
	})
	if !slices.Equal(ids, []uint64{b}) || total != 1 || !slices.Equal(ptNames(rows[b].GetTags()), []string{"Promo"}) {
		t.Fatalf("the archived tab under Promo = %v (%d)", ids, total)
	}
}

// THE TAG FILTER WITH A STOCK FILTER: the id list a stock filter binds and the tag filter meet in the one page-and-count
// statement — the total is the narrowed set's.
func TestProductList_TheTagFilterBesideTheStockAge(t *testing.T) {
	db := san_testdb.DB(t)

	a := insertProduct(t, db, melati, "PT-SA", "Apel")
	b := insertProduct(t, db, melati, "PT-SB", "Beras")
	insertProduct(t, db, melati, "PT-SC", "Cabai")
	laris := ptSeed(t, db, "Laris", "custom")

	stock := &fakeStock{aged: []uint64{a, b}}
	svc := product_v1.NewService(db, history, teamCodes, stock, nil)

	_, err := ptAdd(svc, ptCtx(ptSeller), melati, b, laris)
	if err != nil {
		t.Fatal(err)
	}

	ids, rows, total := ptListed(t, svc, melati, &productv1.ProductListFilter{StockAgeMinDays: 30, TagIds: []uint64{laris}})
	if !slices.Equal(ids, []uint64{b}) || total != 1 || !slices.Equal(ptNames(rows[b].GetTags()), []string{"Laris"}) {
		t.Fatalf("aged AND Laris = %v (%d)", ids, total)
	}
}

// THE PRODUCT PAGE (the owner's ProductDetail) carries the product's tags; one with none carries none.
func TestProductDetail_CarriesItsTags(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	tagged := insertProduct(t, db, melati, "PT-DT", "Bertag")
	bare := insertProduct(t, db, melati, "PT-DB", "Polos")
	laris := ptSeed(t, db, "Laris", "custom")
	audit := ptSeed(t, db, "Audit", "system")

	_, err := ptAdd(svc, ptCtx(ptSeller), melati, tagged, laris)
	if err != nil {
		t.Fatal(err)
	}

	_, err = ptSystemAdd(svc, melati, tagged, audit)
	if err != nil {
		t.Fatal(err)
	}

	detail := func(id uint64) []*productv1.ProductTag {
		res, detailErr := svc.ProductDetail(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductDetailRequest{TeamId: melati, ProductId: id}))
		if detailErr != nil {
			t.Fatal(detailErr)
		}

		return res.Msg.GetProduct().GetTags()
	}

	if names := ptNames(detail(tagged)); !slices.Equal(names, []string{"Audit", "Laris"}) {
		t.Fatalf("the page reads %v", names)
	}

	if tags := detail(bare); len(tags) != 0 {
		t.Fatalf("a bare product reads %v", ptNames(tags))
	}
}

// OTHER TEAMS SEE NO TAGS (its 🔄 *who sees*): Discover's rows and ProductByIds' rows carry none for a tagged product,
// and Discover refuses the Tag filter rather than narrow by tags its caller may not see.
func TestProductTags_NeverOnDiscoverOrByIds(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	product := insertProduct(t, db, melati, "PT-DISC", "Laris Manis")
	laris := ptSeed(t, db, "Laris", "custom")

	_, err := ptAdd(svc, ptCtx(ptSeller), melati, product, laris)
	if err != nil {
		t.Fatal(err)
	}

	disc, err := svc.ProductDiscover(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId: kenanga,
		Filter: &productv1.ProductListFilter{Q: "Laris Manis"},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatal(err)
	}

	row, ok := listRows(disc.Msg.GetItems())[product]
	if !ok || len(row.GetTags()) != 0 {
		t.Fatalf("Discover's row (found %v) carries %v", ok, ptNames(row.GetTags()))
	}

	byIds, err := svc.ProductByIds(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductByIdsRequest{
		TeamId: kenanga,
		Filter: &productv1.ProductByIdsFilter{Ids: []uint64{product}},
	}))
	if err != nil {
		t.Fatal(err)
	}

	byRow, ok := byIdsRows(byIds.Msg.GetItems())[product]
	if !ok || len(byRow.GetTags()) != 0 {
		t.Fatalf("ProductByIds' row (found %v) carries %v", ok, ptNames(byRow.GetTags()))
	}

	_, err = svc.ProductDiscover(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductDiscoverRequest{
		TeamId: kenanga,
		Filter: &productv1.ProductListFilter{TagIds: []uint64{laris}},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	ptCode(t, err, connect.CodeInvalidArgument, "Discover with the Tag filter")
}

// THE TAGS OF KNOWN PRODUCTS — each side its own: the owning team reads its products' tags; a warehouse reads the tags of
// the products it has held (inventory's answer through the seam) and nothing else; another selling team reads none (its
// Discover sees none); an unknown id is absent. A seen product with no tag carries an empty set. With no seam a warehouse
// reads none.
func TestProductTagsByIds_EachSideReadsItsOwn(t *testing.T) {
	db := san_testdb.DB(t)

	held := insertProduct(t, db, melati, "PT-HELD", "Di Gudang")
	notHeld := insertProduct(t, db, melati, "PT-AWAY", "Tidak Di Gudang")
	bare := insertProduct(t, db, melati, "PT-BARE", "Polos Di Gudang")
	laris := ptSeed(t, db, "Laris", "custom")

	stock := &fakeStock{held: map[uint64][]uint64{ptWarehouse: {held, bare}}}
	svc := product_v1.NewService(db, history, teamCodes, stock, nil)

	for _, p := range []uint64{held, notHeld} {
		_, err := ptAdd(svc, ptCtx(ptSeller), melati, p, laris)
		if err != nil {
			t.Fatal(err)
		}
	}

	read := func(s *product_v1.Service, team uint64, ids ...uint64) map[uint64]*productv1.ProductTagSet {
		res, err := s.ProductTagsByIds(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductTagsByIdsRequest{TeamId: team, ProductIds: ids}))
		if err != nil {
			t.Fatalf("team %d: %v", team, err)
		}

		return res.Msg.GetItems()
	}

	all := []uint64{held, notHeld, bare, 999_999_999, held}

	owner := read(svc, melati, all...)
	if len(owner) != 3 || !slices.Equal(ptNames(owner[held].GetTags()), []string{"Laris"}) ||
		!slices.Equal(ptNames(owner[notHeld].GetTags()), []string{"Laris"}) || owner[bare] == nil || len(owner[bare].GetTags()) != 0 {
		t.Fatalf("the owner reads %v", owner)
	}

	house := read(svc, ptWarehouse, all...)
	if len(house) != 2 || !slices.Equal(ptNames(house[held].GetTags()), []string{"Laris"}) || house[bare] == nil {
		t.Fatalf("the holding warehouse reads %v — want the two products it holds, Laris on one", house)
	}

	if _, ok := house[notHeld]; ok {
		t.Fatal("the warehouse reads the tags of a product it never held")
	}

	if other := read(svc, ptElsewhere, all...); len(other) != 0 {
		t.Fatalf("a warehouse holding none reads %v", other)
	}

	if other := read(svc, kenanga, all...); len(other) != 0 {
		t.Fatalf("another selling team reads %v — Discover sees no tags", other)
	}

	if noSeam := read(newService(t, db), ptWarehouse, all...); len(noSeam) != 0 {
		t.Fatalf("with no stock seam a warehouse reads %v", noSeam)
	}
}

// THE WAREHOUSE'S LIST'S HALF (SearchAmong, among the ids inventory holds): with WithTags each row carries its tags, and
// TagIDs keeps the rows carrying any of them — the total narrowed alike; the picker asks no tags and gets none.
func TestSearchAmong_TagsAndTheTagFilter(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := insertProduct(t, db, melati, "PT-SA-1", "Kaos Apel")
	b := insertProduct(t, db, kenanga, "PT-SA-2", "Kaos Beras")
	c := insertProduct(t, db, melati, "PT-SA-3", "Kaos Cabai")
	outside := insertProduct(t, db, melati, "PT-SA-4", "Kaos Luar")

	laris := ptSeed(t, db, "Laris", "custom")
	promo := ptSeed(t, db, "Promo", "custom")

	for _, on := range []struct{ team, product, tag uint64 }{
		{melati, a, laris}, {kenanga, b, promo}, {melati, outside, laris},
	} {
		_, err := ptAdd(svc, ptCtx(ptSeller), on.team, on.product, on.tag)
		if err != nil {
			t.Fatal(err)
		}
	}

	among := []uint64{a, b, c}

	rows, total, err := svc.SearchAmong(context.Background(), product_v1.ProductSearchAmong{IDs: among, WithTags: true, Limit: 10})
	if err != nil || total != 3 || len(rows) != 3 {
		t.Fatalf("all = %d rows (%d), %v", len(rows), total, err)
	}

	if !slices.Equal(ptNames(rows[0].GetTags()), []string{"Laris"}) || !slices.Equal(ptNames(rows[1].GetTags()), []string{"Promo"}) ||
		len(rows[2].GetTags()) != 0 {
		t.Fatalf("tags = %v / %v / %v", ptNames(rows[0].GetTags()), ptNames(rows[1].GetTags()), ptNames(rows[2].GetTags()))
	}

	rows, total, err = svc.SearchAmong(context.Background(), product_v1.ProductSearchAmong{IDs: among, TagIDs: []uint64{laris, promo}, Limit: 10})
	if err != nil || total != 2 || len(rows) != 2 || rows[0].GetId() != a || rows[1].GetId() != b {
		t.Fatalf("Laris OR Promo = %d rows (%d), %v — want Apel, Beras and never the product outside the set", len(rows), total, err)
	}

	if len(rows[0].GetTags()) != 0 {
		t.Fatal("tags were read though the search did not ask for them (the picker's case)")
	}

	rows, total, err = svc.SearchAmong(context.Background(), product_v1.ProductSearchAmong{
		IDs: among, TagIDs: []uint64{laris}, Q: "beras", WithTags: true, Limit: 10,
	})
	if err != nil || total != 0 || len(rows) != 0 {
		t.Fatalf("Laris + q beras = %d rows (%d), %v — want none", len(rows), total, err)
	}
}
