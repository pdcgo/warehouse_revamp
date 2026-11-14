package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// The team sends its own part; what is stored is `<team_code>-<part>` (the-field-is-product-code-composed-on-write).
func TestProductCreate_CreatesInTeamUnderAComposedCode(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	resp, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, ProductCodePart: "SHOE-42", Name: "Widget", Description: "a widget",
	}))
	if err != nil {
		t.Fatalf("ProductCreate: %v", err)
	}

	got := resp.Msg.GetProduct()
	if got.GetId() == 0 || got.GetTeamId() != 2 || got.GetProductCode() != "T2-SHOE-42" || got.GetName() != "Widget" {
		t.Fatalf("unexpected product: %+v", got)
	}
}

// The part is trimmed — " SHOE-42 " and "SHOE-42" are one code to a person reading a sticker — and a part that is only
// space is refused, since the composed code would carry nothing of the team's.
func TestProductCreate_TrimsThePartAndRefusesABlankOne(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	resp, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, ProductCodePart: "  SHOE-42 ", Name: "Widget",
	}))
	if err != nil {
		t.Fatalf("ProductCreate: %v", err)
	}

	if code := resp.Msg.GetProduct().GetProductCode(); code != "T2-SHOE-42" {
		t.Fatalf("code = %q, want T2-SHOE-42", code)
	}

	_, err = svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, ProductCodePart: "   ", Name: "Blank",
	}))
	if codeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("blank part = %v, want InvalidArgument", codeOf(err))
	}
}

// A team team_service does not know has no code, so nothing is composed for it — refused, nothing written.
func TestProductCreate_ATeamWithNoCodeIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: noCodeTeam, ProductCodePart: "SHOE-42", Name: "Orphan",
	}))
	if codeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("no team code = %v, want FailedPrecondition", codeOf(err))
	}

	var count int64

	err = db.Table("products").Where("team_id = ?", noCodeTeam).Count(&count).Error
	if err != nil || count != 0 {
		t.Fatalf("products written for a team with no code = %d (%v), want 0", count, err)
	}
}

// Without a team-code reader nothing can be composed, so nothing is created.
func TestProductCreate_NoTeamCodeReaderRefuses(t *testing.T) {
	db := san_testdb.DB(t)
	svc := product_v1.NewService(db, history, nil, nil, nil)

	_, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, ProductCodePart: "SHOE-42", Name: "Widget",
	}))
	if codeOf(err) != connect.CodeInternal {
		t.Fatalf("no reader = %v, want Internal", codeOf(err))
	}
}

// A create carries a category and up to 5 images; the first image is denormalised as the cover.
func TestProductCreate_WithCategoryAndImages(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	resp, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, ProductCodePart: "IMG-1", Name: "Photographed", CategoryId: 7,
		Images: []*productv1.ProductImage{
			{Url: "https://cdn/a.jpg", ThumbnailUrl: "https://cdn/a_t.jpg"},
			{Url: "https://cdn/b.jpg", ThumbnailUrl: "https://cdn/b_t.jpg"},
		},
	}))
	if err != nil {
		t.Fatalf("ProductCreate: %v", err)
	}

	got := resp.Msg.GetProduct()
	if got.GetCategoryId() != 7 {
		t.Fatalf("category = %d, want 7", got.GetCategoryId())
	}
	// The cover mirrors the FIRST image.
	if got.GetDefaultImageUrl() != "https://cdn/a.jpg" || got.GetDefaultImageThumbnailUrl() != "https://cdn/a_t.jpg" {
		t.Fatalf("cover = %q / %q", got.GetDefaultImageUrl(), got.GetDefaultImageThumbnailUrl())
	}
	if len(got.GetImages()) != 2 || got.GetImages()[0].GetUrl() != "https://cdn/a.jpg" || got.GetImages()[1].GetUrl() != "https://cdn/b.jpg" {
		t.Fatalf("images = %+v", got.GetImages())
	}
}

// The composed code is unique: the same part twice in one team is the same code twice.
func TestProductCreate_DuplicateCodeRejected(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	req := func() *connect.Request[productv1.ProductCreateRequest] {
		return connect.NewRequest(&productv1.ProductCreateRequest{TeamId: 2, ProductCodePart: "DUP", Name: "First"})
	}

	_, err := svc.ProductCreate(context.Background(), req())
	if err != nil {
		t.Fatalf("first create: %v", err)
	}

	_, err = svc.ProductCreate(context.Background(), req())
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("duplicate code = %v, want AlreadyExists", connect.CodeOf(err))
	}
}

// An ARCHIVED product keeps its code (a-used-product-is-archived-never-deleted), so its part cannot be re-used: the
// unique index is over every row, not only the active ones.
func TestProductCreate_AnArchivedProductsCodeIsStillTaken(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertProduct(t, db, 2, "T2-SHOE-42", "Archived")
	setProduct(t, db, id, "archived", true)

	_, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, ProductCodePart: "SHOE-42", Name: "Again",
	}))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("archived code reused = %v, want AlreadyExists", connect.CodeOf(err))
	}
}

// Two teams typing the same part get two codes — each under its own prefix — so neither create is refused because of the
// other team's row.
func TestProductCreate_SamePartDifferentTeamOk(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 2, ProductCodePart: "SHARED", Name: "A",
	}))
	if err != nil {
		t.Fatalf("team 2 create: %v", err)
	}

	b, err := svc.ProductCreate(context.Background(), connect.NewRequest(&productv1.ProductCreateRequest{
		TeamId: 3, ProductCodePart: "SHARED", Name: "B",
	}))
	if err != nil {
		t.Fatalf("team 3 create with the same part should succeed: %v", err)
	}

	if a.Msg.GetProduct().GetProductCode() != "T2-SHARED" || b.Msg.GetProduct().GetProductCode() != "T3-SHARED" {
		t.Fatalf("codes = %q, %q, want T2-SHARED, T3-SHARED",
			a.Msg.GetProduct().GetProductCode(), b.Msg.GetProduct().GetProductCode())
	}
}
