package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// byIdsImages flattens a by-ids response to the IMAGES slice per product id — nil where the slice is absent.
func byIdsImages(items map[uint64]*productv1.ProductByIdsResponseList) map[uint64][]*productv1.ProductImage {
	out := map[uint64][]*productv1.ProductImage{}

	for id, list := range items {
		for _, it := range list.GetItems() {
			slice := it.GetImages()
			if slice == nil {
				continue
			}

			gallery, ok := slice.GetMapData()[id]
			if ok {
				out[id] = gallery.GetItems()
				if out[id] == nil {
					out[id] = []*productv1.ProductImage{}
				}
			}
		}
	}

	return out
}

// insertGallery seeds a product's images in the order given as `positions` says — written out of order on purpose, so
// a read that does not sort by position fails.
func insertGallery(t *testing.T, db *gorm.DB, productID uint64, positions ...int) {
	t.Helper()

	for _, position := range positions {
		err := db.Create(&product_service_models.ProductImage{
			ProductID:    productID,
			URL:          imageURL(productID, position),
			ThumbnailURL: imageURL(productID, position) + "?thumb",
			Position:     position,
		}).Error
		if err != nil {
			t.Fatalf("insert image %d of product %d: %v", position, productID, err)
		}
	}
}

func imageURL(productID uint64, position int) string {
	return "https://img.example/" + string(rune('a'+productID%26)) + "/" + string(rune('0'+position)) + ".png"
}

func imagesRequest(teamID uint64, ids ...uint64) *connect.Request[productv1.ProductByIdsRequest] {
	return connect.NewRequest(&productv1.ProductByIdsRequest{
		TeamId: teamID,
		Filter: &productv1.ProductByIdsFilter{Ids: ids},
		DataRequest: []productv1.ProductByIdsDataType{
			productv1.ProductByIdsDataType_PRODUCT_BY_IDS_DATA_TYPE_PRODUCT,
			productv1.ProductByIdsDataType_PRODUCT_BY_IDS_DATA_TYPE_IMAGES,
		},
	})
}

// THE DISCOVER DETAIL SHOWS ANOTHER TEAM'S WHOLE GALLERY (the-discover-detail-shows-no-markup: "the pictures are the
// product page's gallery"). A selling team asks by id for a product of ANOTHER team and gets every picture, in the
// gallery's order, the cover first — the order ProductDetail answers the owner. A product with no picture answers an
// empty gallery. The PRODUCT slice beside it is unchanged.
func TestProductByIds_ImagesReadAnotherTeamsGallery(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	theirs := insertProduct(t, db, 3, "B-1", "Beta")
	bare := insertProduct(t, db, 3, "B-2", "Gamma")
	insertGallery(t, db, theirs, 2, 0, 1)

	resp, err := svc.ProductByIds(asPerson(41, role_basev1.Role_ROLE_SELLING_OWNER), imagesRequest(2, theirs, bare))
	if err != nil {
		t.Fatalf("ProductByIds with IMAGES: %v", err)
	}

	galleries := byIdsImages(resp.Msg.GetItems())

	got := galleries[theirs]
	if len(got) != 3 {
		t.Fatalf("another team's gallery = %d pictures, want 3: %+v", len(got), got)
	}

	for i, image := range got {
		if image.GetUrl() != imageURL(theirs, i) || image.GetThumbnailUrl() != imageURL(theirs, i)+"?thumb" {
			t.Fatalf("picture %d = %q / %q, want position %d's (cover first, in gallery order)",
				i, image.GetUrl(), image.GetThumbnailUrl(), i)
		}
	}

	none, ok := galleries[bare]
	if !ok || len(none) != 0 {
		t.Fatalf("a product with no picture = %v (present %v), want an empty gallery", none, ok)
	}

	// The row beside it, as before — the gallery adds a slice, it changes nothing in the row.
	if row := byIdsRows(resp.Msg.GetItems())[theirs]; row.GetTeamId() != 3 || row.GetName() != "Beta" {
		t.Fatalf("PRODUCT slice = %+v, want Beta of team 3", row)
	}
}

// THE OWNER'S OWN READ IS UNCHANGED: a by-ids call that does not ask for IMAGES carries no gallery — every existing
// caller (a rack, the order form's lines) reads exactly what it read before, with no images query behind it.
func TestProductByIds_NoImagesUnlessAsked(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	product := insertProduct(t, db, 3, "B-1", "Beta")
	insertGallery(t, db, product, 0, 1)

	imageReads := countImageReads(t, db)

	resp, err := svc.ProductByIds(asPerson(41, role_basev1.Role_ROLE_WAREHOUSE_STAFF), connect.NewRequest(&productv1.ProductByIdsRequest{
		TeamId: 11,
		Filter: &productv1.ProductByIdsFilter{Ids: []uint64{product}},
	}))
	if err != nil {
		t.Fatalf("ProductByIds without IMAGES, as a warehouse: %v", err)
	}

	if galleries := byIdsImages(resp.Msg.GetItems()); len(galleries) != 0 {
		t.Fatalf("an IMAGES slice nobody asked for: %+v", galleries)
	}

	if row := byIdsRows(resp.Msg.GetItems())[product]; row.GetName() != "Beta" {
		t.Fatalf("the warehouse's by-ids row = %+v, want Beta", row)
	}

	if *imageReads != 0 {
		t.Fatalf("product_images read %d time(s) for a call that did not ask for IMAGES, want 0", *imageReads)
	}
}

// countImageReads counts the queries on product_images from here to the end of the test — a GORM query callback,
// removed again when the test ends (the package's tests never run in parallel).
func countImageReads(t *testing.T, db *gorm.DB) *int {
	t.Helper()

	n := 0
	name := "count_image_reads_" + t.Name()

	err := db.Callback().Query().After("gorm:query").Register(name, func(d *gorm.DB) {
		if d.Statement.Table == "product_images" {
			n++
		}
	})
	if err != nil {
		t.Fatalf("register the query counter: %v", err)
	}

	t.Cleanup(func() {
		_ = db.Callback().Query().Remove(name)
	})

	return &n
}

// A WAREHOUSE MAY NOT READ THE GALLERY: the IMAGES slice is Discover's, and Discover serves no warehouse
// (ProductDiscover's policy). A warehouse role asking for it is refused outright — every warehouse role — while Root
// (no role in the team: the root-team bypass) and every selling role read it.
func TestProductByIds_ImagesAreRefusedToAWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	product := insertProduct(t, db, 3, "B-1", "Beta")
	insertGallery(t, db, product, 0)

	for _, role := range []role_basev1.Role{
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	} {
		_, err := svc.ProductByIds(asPerson(41, role), imagesRequest(11, product))
		if codeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("%s asking for the gallery: %v, want PermissionDenied", role, err)
		}
	}

	for _, role := range []role_basev1.Role{
		role_basev1.Role_ROLE_UNSPECIFIED,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_SELLING_CS,
	} {
		resp, err := svc.ProductByIds(asPerson(41, role), imagesRequest(2, product))
		if err != nil {
			t.Fatalf("%s asking for the gallery: %v, want it read", role, err)
		}

		if got := byIdsImages(resp.Msg.GetItems())[product]; len(got) != 1 {
			t.Fatalf("%s read %d pictures, want 1", role, len(got))
		}
	}

	// A context the interceptor never touched (an in-process caller) holds no role — read, as Root's is.
	_, err := svc.ProductByIds(context.Background(), imagesRequest(2, product))
	if err != nil {
		t.Fatalf("an in-process caller asking for the gallery: %v", err)
	}
}
