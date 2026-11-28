package inventory_v1_test

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE WAREHOUSE'S PRODUCTS LIST CARRIES PRODUCT TAGS (backlog #147 — products-have-their-own-tag-list, its 🔄 *who
// sees*: every warehouse holding a product sees its tags; the-team-code-and-product-tags-prototype-is-accepted: the Tag
// column and the Tag filter, ANY of). Inventory hands the held ids, the picked tags and "with tags" to product_service
// (ProductReader.Search), which narrows and names them in one statement; the rows carry the tags it answered. The picker
// over the same set asks for neither. product_service's half is played by wslTagCatalogue; the real one is
// product_v1.SearchAmong (product_tags_test.go), wired at the composition root (product_tags_seam_test.go).

const (
	wtLaris uint64 = 9101
	wtPromo uint64 = 9102
)

// wslTagCatalogue is wslCatalogue with product tags: it records every search asked, keeps only the ids carrying ANY of
// the picked tags, and fills the matches' tags when asked.
type wslTagCatalogue struct {
	wslCatalogue
	tags  map[uint64][]*productv1.ProductTag
	asked *[]inventory_v1.ProductSearch
}

func (c wslTagCatalogue) Search(ctx context.Context, team uint64, search inventory_v1.ProductSearch) (inventory_v1.ProductSearchPage, error) {
	*c.asked = append(*c.asked, search)

	narrowed := search
	if len(search.TagIDs) > 0 {
		narrowed.ProductIDs = nil

		for _, id := range search.ProductIDs {
			for _, tag := range c.tags[id] {
				if slices.Contains(search.TagIDs, tag.GetId()) {
					narrowed.ProductIDs = append(narrowed.ProductIDs, id)

					break
				}
			}
		}
	}

	page, err := c.wslCatalogue.Search(ctx, team, narrowed)
	if err != nil {
		return page, err
	}

	if search.WithTags {
		for i := range page.Products {
			page.Products[i].Tags = c.tags[page.Products[i].ID]
		}
	}

	return page, nil
}

func wtTagged(t *testing.T) (*inventory_v1.Service, *[]inventory_v1.ProductSearch) {
	t.Helper()

	asked := &[]inventory_v1.ProductSearch{}
	laris := &productv1.ProductTag{Id: wtLaris, Name: "Laris", Type: productv1.ProductTagType_PRODUCT_TAG_TYPE_CUSTOM}
	promo := &productv1.ProductTag{Id: wtPromo, Name: "Promo", Type: productv1.ProductTagType_PRODUCT_TAG_TYPE_CUSTOM}

	catalogue := wslTagCatalogue{
		wslCatalogue: wslProducts(),
		tags: map[uint64][]*productv1.ProductTag{
			wslKaosMelati: {laris},
			wslKaosSinar:  {laris, promo},
			wslKaosUngu:   {promo}, // stocked nowhere
		},
		asked: asked,
	}

	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, catalogue, nil, nil, nil, nil)

	rak := newRack(t, svc, otWarehouse, "rak-tag")

	otRestock(t, svc, otMelati, wslKaosMelati, 2, 20000, []*inventoryv1.RestockPlacement{{PlacementId: rak, Quantity: 2}})
	otRestock(t, svc, otSinar, wslKaosSinar, 3, 30000, []*inventoryv1.RestockPlacement{{PlacementId: rak, Quantity: 3}})
	otRestock(t, svc, otSinar, wslKaosPolos, 1, 10000, []*inventoryv1.RestockPlacement{{PlacementId: rak, Quantity: 1}})

	return svc, asked
}

func wtList(
	t *testing.T,
	svc *inventory_v1.Service,
	tagIDs []uint64,
	types ...inventoryv1.WarehouseStockListDataType,
) *inventoryv1.WarehouseStockListResponse {
	t.Helper()

	res, err := svc.WarehouseStockList(ctxAs(41, otWarehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF), connect.NewRequest(
		&inventoryv1.WarehouseStockListRequest{
			WarehouseId: otWarehouse,
			Filter:      &inventoryv1.WarehouseStockListFilter{TagIds: tagIDs},
			DataRequest: types,
			Page:        &commonv1.CommonPagination{Page: 1, Limit: 20},
		},
	))
	if err != nil {
		t.Fatalf("WarehouseStockList: %v", err)
	}

	return res.Msg
}

func wtRows(res *inventoryv1.WarehouseStockListResponse) map[uint64]*inventoryv1.WarehouseProductSearchItem {
	for _, item := range res.GetItems() {
		if p := item.GetProduct(); p != nil {
			return p.GetMapData()
		}
	}

	return nil
}

func wtNames(tags []*productv1.ProductTag) []string {
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		out = append(out, tag.GetName())
	}

	return out
}

// Each row carries its product tags; the Tag filter is handed over with the held ids and narrows the page and its total;
// a product carrying the tag but held nowhere here (Kaos Ungu) never shows.
func TestWarehouseStockList_CarriesTagsAndTheTagFilter(t *testing.T) {
	svc, asked := wtTagged(t)

	res := wtList(t, svc, nil)
	rows := wtRows(res)

	if !slices.Equal(res.GetIds(), []uint64{wslKaosPolos, wslKaosMelati, wslKaosSinar}) {
		t.Fatalf("ids = %v", res.GetIds())
	}

	if !slices.Equal(wtNames(rows[wslKaosSinar].GetTags()), []string{"Laris", "Promo"}) ||
		!slices.Equal(wtNames(rows[wslKaosMelati].GetTags()), []string{"Laris"}) || len(rows[wslKaosPolos].GetTags()) != 0 {
		t.Fatalf("tags = %v / %v / %v", wtNames(rows[wslKaosSinar].GetTags()), wtNames(rows[wslKaosMelati].GetTags()),
			wtNames(rows[wslKaosPolos].GetTags()))
	}

	if last := (*asked)[len(*asked)-1]; !last.WithTags || len(last.TagIDs) != 0 {
		t.Fatalf("the unfiltered list asked %+v — want tags, no filter", last)
	}

	res = wtList(t, svc, []uint64{wtPromo})
	if !slices.Equal(res.GetIds(), []uint64{wslKaosSinar}) || res.GetPageInfo().GetTotalItems() != 1 {
		t.Fatalf("Promo = %v (%d), want Sinar's Kaos Temuan alone — never the Kaos Ungu held nowhere here",
			res.GetIds(), res.GetPageInfo().GetTotalItems())
	}

	if last := (*asked)[len(*asked)-1]; !slices.Equal(last.TagIDs, []uint64{wtPromo}) {
		t.Fatalf("the filter handed over %v, want [Promo]", last.TagIDs)
	}

	res = wtList(t, svc, []uint64{wtLaris, wtPromo})
	if !slices.Equal(res.GetIds(), []uint64{wslKaosMelati, wslKaosSinar}) || res.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("Laris OR Promo = %v (%d)", res.GetIds(), res.GetPageInfo().GetTotalItems())
	}
}

// Tags are read only for the slice that draws them: a STOCK-only answer asks none; the picker over the same set asks
// neither tags nor a filter.
func TestWarehouseStockList_TagsOnlyForTheProductSlice(t *testing.T) {
	svc, asked := wtTagged(t)

	wtList(t, svc, nil, inventoryv1.WarehouseStockListDataType_WAREHOUSE_STOCK_LIST_DATA_TYPE_STOCK)

	if last := (*asked)[len(*asked)-1]; last.WithTags {
		t.Fatal("a STOCK-only list asked for tags")
	}

	wtList(t, svc, nil, inventoryv1.WarehouseStockListDataType_WAREHOUSE_STOCK_LIST_DATA_TYPE_PRODUCT)

	if last := (*asked)[len(*asked)-1]; !last.WithTags {
		t.Fatal("the PRODUCT slice asked no tags")
	}

	picked, err := svc.WarehouseProductSearch(ctxAs(41, otWarehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF), connect.NewRequest(
		&inventoryv1.WarehouseProductSearchRequest{
			WarehouseId: otWarehouse,
			Filter:      &inventoryv1.WarehouseProductSearchFilter{Q: "kaos"},
			Page:        &commonv1.CommonPagination{Page: 1, Limit: 10},
		},
	))
	if err != nil {
		t.Fatal(err)
	}

	if last := (*asked)[len(*asked)-1]; last.WithTags || len(last.TagIDs) != 0 {
		t.Fatalf("the picker asked %+v — want no tags, no filter", last)
	}

	for _, item := range picked.Msg.GetItems() {
		for _, p := range item.GetProduct().GetMapData() {
			if len(p.GetTags()) != 0 {
				t.Fatalf("the picker's %d carries tags", p.GetId())
			}
		}
	}
}
