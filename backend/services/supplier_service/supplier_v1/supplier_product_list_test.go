package supplier_v1_test

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// THE PRODUK TAB (SupplierProductList): a supplier's links, searched, narrowed by team and store, paged newest restock
// first, each row named by product_service and filled by inventory — one call each per page.

// productCatalog is the ProductCatalog fake: products by id, a search over their names and SKUs, and what was asked.
type productCatalog struct {
	cards map[uint64]supplier_v1.ProductCard
	err   error

	cardCalls  [][]uint64
	matchCalls [][]uint64
}

func (f *productCatalog) ProductCards(_ context.Context, ids []uint64) (map[uint64]supplier_v1.ProductCard, error) {
	if f.err != nil {
		return nil, f.err
	}

	f.cardCalls = append(f.cardCalls, slices.Clone(ids))

	out := map[uint64]supplier_v1.ProductCard{}
	for _, id := range ids {
		if card, ok := f.cards[id]; ok {
			out[id] = card
		}
	}

	return out, nil
}

func (f *productCatalog) ProductIDsMatching(_ context.Context, among []uint64, q string) ([]uint64, error) {
	if f.err != nil {
		return nil, f.err
	}

	f.matchCalls = append(f.matchCalls, slices.Clone(among))

	var out []uint64

	needle := strings.ToLower(q)
	for _, id := range among {
		card := f.cards[id]
		if strings.Contains(strings.ToLower(card.Name), needle) || strings.Contains(strings.ToLower(card.Code), needle) {
			out = append(out, id)
		}
	}

	return out, nil
}

// productGoods is the GoodsReader fake that also answers ProductGoods — the figures per (store, product), every
// warehouse's or (figuresAt) one warehouse's — and each ask with the warehouse it named.
type productGoods struct {
	fakeGoods

	figures   map[supplier_v1.StoreProduct]supplier_v1.StoreGoods
	figuresAt map[uint64]map[supplier_v1.StoreProduct]supplier_v1.StoreGoods
	asked     [][]supplier_v1.StoreProduct
	askedAt   []uint64
}

func (g *productGoods) StoreProductGoods(
	_ context.Context,
	_, warehouseID uint64,
	pairs []supplier_v1.StoreProduct,
) (map[supplier_v1.StoreProduct]supplier_v1.StoreGoods, error) {
	if g.err != nil {
		return nil, g.err
	}

	g.asked = append(g.asked, slices.Clone(pairs))
	g.askedAt = append(g.askedAt, warehouseID)

	figures := g.figures
	if warehouseID > 0 {
		figures = g.figuresAt[warehouseID]
	}

	out := map[supplier_v1.StoreProduct]supplier_v1.StoreGoods{}
	for _, pair := range pairs {
		if f, ok := figures[pair]; ok {
			out[pair] = f
		}
	}

	return out, nil
}

// productTab is one test's service and its two fakes.
type productTab struct {
	db      *gorm.DB
	svc     *supplier_v1.Service
	catalog *productCatalog
	goods   *productGoods
}

func newProductTab(t *testing.T) productTab {
	t.Helper()

	db := san_testdb.DB(t)
	tab := productTab{
		db:      db,
		catalog: &productCatalog{cards: map[uint64]supplier_v1.ProductCard{}},
		goods:   &productGoods{figures: map[supplier_v1.StoreProduct]supplier_v1.StoreGoods{}},
	}
	tab.svc = supplier_v1.NewService(db, nil, nil, tab.goods, nil, tab.catalog)

	return tab
}

// spBase is a fixed instant the links are dated from — the whole test is one transaction, so NOW() never moves.
var spBase = time.Date(2026, 10, 8, 3, 0, 0, 0, time.UTC)

// insertLink seeds a link directly — what the RestockAccepted fold leaves. store 0 = no store; days are before spBase.
func insertLink(t *testing.T, db *gorm.DB, supplierID, store, product, team uint64, firstDaysAgo, lastDaysAgo int) supplier_service_models.SupplierChannelProduct {
	t.Helper()

	link := supplier_service_models.SupplierChannelProduct{
		TeamID: team, SupplierID: supplierID, ProductID: product,
		FirstRestockedAt: spBase.AddDate(0, 0, -firstDaysAgo),
		LastRestockedAt:  spBase.AddDate(0, 0, -lastDaysAgo),
		LastRestockID:    product,
	}
	if store > 0 {
		link.ChannelID = &store
	}

	err := db.Create(&link).Error
	if err != nil {
		t.Fatalf("insert link: %v", err)
	}

	return link
}

func (tab productTab) list(t *testing.T, caller uint64, filter *supplierv1.SupplierProductListFilter, n, limit uint32) ([]*supplierv1.SupplierProduct, uint64) {
	t.Helper()

	rows, total, err := tab.ask(caller, filter, n, limit)
	if err != nil {
		t.Fatalf("SupplierProductList: %v", err)
	}

	return rows, total
}

func (tab productTab) ask(caller uint64, filter *supplierv1.SupplierProductListFilter, n, limit uint32) ([]*supplierv1.SupplierProduct, uint64, error) {
	resp, err := tab.svc.SupplierProductList(context.Background(), connect.NewRequest(&supplierv1.SupplierProductListRequest{
		TeamId: caller, Filter: filter, Page: page(n, limit),
	}))
	if err != nil {
		return nil, 0, err
	}

	var byID map[uint64]*supplierv1.SupplierProduct
	for _, item := range resp.Msg.GetItems() {
		if m := item.GetProduct(); m != nil {
			byID = m.GetMapData()
		}
	}

	rows := make([]*supplierv1.SupplierProduct, 0, len(resp.Msg.GetIds()))
	for _, id := range resp.Msg.GetIds() {
		rows = append(rows, byID[id])
	}

	return rows, resp.Msg.GetPageInfo().GetTotalItems(), nil
}

func linkIDs(rows []*supplierv1.SupplierProduct) []uint64 {
	out := make([]uint64, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.GetId())
	}

	return out
}

// A ROW SAYS WHOSE, WHERE AND WHEN (a-supplier-product-row-says-whose-where-and-when) — the product as product_service
// names it, the team whose product it is, the store with its type (none for a line naming the supplier alone, a-line-with-
// no-store-links-under-the-supplier), the first and the last restock, and the store × product's Terjual and Siap; a
// product none of whose goods arrived carries no figures (the tab's dash), an unresolved one its id with empty facts.
func TestSupplierProductList_ARowSaysWhoseWhereAndWhen(t *testing.T) {
	tab := newProductTab(t)

	sumber := insertSupplier(t, tab.db, sellingA, "PT Sumber Makmur")
	shopee := insertChannel(t, tab.db, sumber.ID, "shopee", "Sumber Makmur Official")

	tab.catalog.cards[801] = supplier_v1.ProductCard{Name: "Kain Katun Jepang", Code: "KTN-JP-01", ThumbnailURL: "https://img.example/ktn.jpg"}
	tab.catalog.cards[802] = supplier_v1.ProductCard{Name: "Benang Polyester", Code: "BNG-PL-40"}

	lastOrder := spBase.AddDate(0, 0, -1).Unix()
	tab.goods.figures[supplier_v1.StoreProduct{StoreID: shopee.ID, ProductID: 801}] = supplier_v1.StoreGoods{
		Sold: 412, Orders: 37, LastOrderUnix: lastOrder, Ready: 37,
	}

	bought := insertLink(t, tab.db, sumber.ID, shopee.ID, 801, sellingA, 30, 2)
	stall := insertLink(t, tab.db, sumber.ID, 0, 802, sellingB, 9, 9)
	gone := insertLink(t, tab.db, sumber.ID, shopee.ID, 899, sellingB, 40, 40) // its product no longer resolves

	rows, total := tab.list(t, sellingA, &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID}, 1, 10)
	if total != 3 || !slices.Equal(linkIDs(rows), []uint64{bought.ID, stall.ID, gone.ID}) {
		t.Fatalf("rows %v of %d, want the three links newest restock first", linkIDs(rows), total)
	}

	row := rows[0]
	if row.GetProductId() != 801 || row.GetTeamId() != sellingA || row.GetProductName() != "Kain Katun Jepang" ||
		row.GetProductCode() != "KTN-JP-01" || row.GetProductThumbnailUrl() != "https://img.example/ktn.jpg" {
		t.Fatalf("the product = %+v", row)
	}

	if row.GetChannelId() != shopee.ID || row.GetChannelName() != "Sumber Makmur Official" ||
		row.GetChannelType() != marketplacev1.Marketplace_MARKETPLACE_SHOPEE {
		t.Fatalf("the store = %d %q %v", row.GetChannelId(), row.GetChannelName(), row.GetChannelType())
	}

	if row.GetFirstRestockedUnix() != spBase.AddDate(0, 0, -30).Unix() || row.GetLastRestockedUnix() != spBase.AddDate(0, 0, -2).Unix() {
		t.Fatalf("restocked first %d, last %d", row.GetFirstRestockedUnix(), row.GetLastRestockedUnix())
	}

	f := row.GetFigures()
	if f.GetSoldUnits() != 412 || f.GetOrders() != 37 || f.GetLastOrderUnix() != lastOrder || f.GetReadyUnits() != 37 {
		t.Fatalf("figures = %+v", f)
	}

	// No store: its cell reads "—" — no id, no name; its goods never arrived, so no figures either.
	if rows[1].GetChannelId() != 0 || rows[1].GetChannelName() != "" || rows[1].GetFigures() != nil || rows[1].GetTeamId() != sellingB {
		t.Fatalf("the store-less row = %+v", rows[1])
	}

	if rows[2].GetProductId() != 899 || rows[2].GetProductName() != "" {
		t.Fatalf("an unresolved product keeps its id with empty facts: %+v", rows[2])
	}
}

// Newest restock first (a-link-remembers-its-last-restock), a tie broken by the newest link; paged with the count of the
// whole set — a page past the end still counts it.
func TestSupplierProductList_NewestRestockFirstAndPaged(t *testing.T) {
	tab := newProductTab(t)

	sumber := insertSupplier(t, tab.db, sellingA, "PT Sumber Makmur")
	store := insertChannel(t, tab.db, sumber.ID, "tokopedia", "Sumber Store")

	type seeded struct {
		id      uint64
		daysAgo int
	}

	var links []seeded

	for i := range 25 {
		// Two links share each day: the newer link goes first.
		link := insertLink(t, tab.db, sumber.ID, store.ID, uint64(900+i), sellingA, 60, i/2)
		links = append(links, seeded{id: link.ID, daysAgo: i / 2})
	}

	slices.SortFunc(links, func(a, b seeded) int {
		if a.daysAgo != b.daysAgo {
			return a.daysAgo - b.daysAgo // the most recent restock first
		}

		if a.id > b.id {
			return -1
		}

		return 1
	})

	want := make([]uint64, 0, len(links))
	for _, link := range links {
		want = append(want, link.id)
	}

	var got []uint64

	for n := uint32(1); n <= 3; n++ {
		rows, total := tab.list(t, sellingA, &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID}, n, 10)
		if total != 25 {
			t.Fatalf("page %d counts %d, want 25", n, total)
		}

		got = append(got, linkIDs(rows)...)
	}

	if !slices.Equal(got, want) {
		t.Fatalf("the pages read %v, want %v", got, want)
	}

	rows, total := tab.list(t, sellingA, &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID}, 9, 10)
	if len(rows) != 0 || total != 25 {
		t.Fatalf("a page past the end = %d rows of %d, want none of 25", len(rows), total)
	}
}

// Tim, then Toko (the-products-tab-filters-by-team-and-store): one team's products; one store's; or only those bought
// with no store. A link of a deleted store hides with it (a-store-delete-is-soft-too); another supplier's never shows.
func TestSupplierProductList_FiltersByTeamAndStore(t *testing.T) {
	tab := newProductTab(t)

	sumber := insertSupplier(t, tab.db, sellingA, "PT Sumber Makmur")
	other := insertSupplier(t, tab.db, sellingB, "CV Lain")
	shopee := insertChannel(t, tab.db, sumber.ID, "shopee", "Sumber Shopee")
	tokped := insertChannel(t, tab.db, sumber.ID, "tokopedia", "Sumber Tokopedia")
	closed := insertChannel(t, tab.db, sumber.ID, "lazada", "Sumber Lazada")
	elsewhere := insertChannel(t, tab.db, other.ID, "shopee", "Lain Shopee")
	softDelete(t, tab.db, &supplier_service_models.SupplierChannel{}, closed.ID)

	aShopee := insertLink(t, tab.db, sumber.ID, shopee.ID, 801, sellingA, 5, 1)
	bShopee := insertLink(t, tab.db, sumber.ID, shopee.ID, 802, sellingB, 5, 2)
	aTokped := insertLink(t, tab.db, sumber.ID, tokped.ID, 803, sellingA, 5, 3)
	bStall := insertLink(t, tab.db, sumber.ID, 0, 804, sellingB, 5, 4)
	insertLink(t, tab.db, sumber.ID, closed.ID, 805, sellingA, 5, 0)
	insertLink(t, tab.db, other.ID, elsewhere.ID, 806, sellingA, 5, 0)

	cases := []struct {
		name   string
		filter *supplierv1.SupplierProductListFilter
		want   []uint64
	}{
		{"every product", &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID}, []uint64{aShopee.ID, bShopee.ID, aTokped.ID, bStall.ID}},
		{"team A", &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, ProductTeamId: sellingA}, []uint64{aShopee.ID, aTokped.ID}},
		{"the Shopee store", &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, StoreId: shopee.ID}, []uint64{aShopee.ID, bShopee.ID}},
		{"no store", &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, NoStore: true}, []uint64{bStall.ID}},
		{"team B at Shopee", &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, ProductTeamId: sellingB, StoreId: shopee.ID}, []uint64{bShopee.ID}},
		{"the deleted store", &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, StoreId: closed.ID}, nil},
		{"another supplier's store", &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, StoreId: elsewhere.ID}, nil},
	}

	for _, c := range cases {
		rows, total := tab.list(t, sellingA, c.filter, 1, 20)
		if !slices.Equal(linkIDs(rows), c.want) || total != uint64(len(c.want)) {
			t.Fatalf("%s = %v of %d, want %v", c.name, linkIDs(rows), total, c.want)
		}
	}
}

// The search (the-products-tab-searches-and-pages): the product's name or SKU — asked of product_service among THIS
// supplier's products the other filters keep, never the catalogue — or the store's name.
func TestSupplierProductList_SearchesTheProductOrTheStore(t *testing.T) {
	tab := newProductTab(t)

	sumber := insertSupplier(t, tab.db, sellingA, "PT Sumber Makmur")
	other := insertSupplier(t, tab.db, sellingB, "CV Lain")
	official := insertChannel(t, tab.db, sumber.ID, "shopee", "Grosir Official")
	wa := insertChannel(t, tab.db, sumber.ID, "other", "Pesan WA")
	elsewhere := insertChannel(t, tab.db, other.ID, "shopee", "Lain Shopee")

	tab.catalog.cards[801] = supplier_v1.ProductCard{Name: "Kain Katun Jepang", Code: "KTN-JP-01"}
	tab.catalog.cards[802] = supplier_v1.ProductCard{Name: "Benang Polyester", Code: "BNG-PL-40"}
	tab.catalog.cards[803] = supplier_v1.ProductCard{Name: "Kain Rayon", Code: "RYN-01"}
	tab.catalog.cards[809] = supplier_v1.ProductCard{Name: "Kain Lain", Code: "KTN-LAIN"}

	katun := insertLink(t, tab.db, sumber.ID, official.ID, 801, sellingA, 5, 1)
	benang := insertLink(t, tab.db, sumber.ID, wa.ID, 802, sellingA, 5, 2)
	rayon := insertLink(t, tab.db, sumber.ID, 0, 803, sellingB, 5, 3)
	insertLink(t, tab.db, other.ID, elsewhere.ID, 809, sellingA, 5, 0)

	cases := []struct {
		name   string
		filter *supplierv1.SupplierProductListFilter
		want   []uint64
	}{
		{"by name", &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, Q: "kain"}, []uint64{katun.ID, rayon.ID}},
		{"by SKU", &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, Q: "bng-pl"}, []uint64{benang.ID}},
		{"by store", &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, Q: "official"}, []uint64{katun.ID}},
		{"by name, one team", &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, Q: "kain", ProductTeamId: sellingB}, []uint64{rayon.ID}},
		{"nothing", &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, Q: "zzz"}, nil},
		{"another supplier's product", &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, Q: "ktn-lain"}, nil},
	}

	for _, c := range cases {
		tab.catalog.matchCalls = nil

		rows, total := tab.list(t, sellingA, c.filter, 1, 20)
		if !slices.Equal(linkIDs(rows), c.want) || total != uint64(len(c.want)) {
			t.Fatalf("%s = %v of %d, want %v", c.name, linkIDs(rows), total, c.want)
		}

		// ONE search, among this supplier's products the other filters keep.
		if len(tab.catalog.matchCalls) != 1 || slices.Contains(tab.catalog.matchCalls[0], 809) {
			t.Fatalf("%s asked product_service %v — want one search among the supplier's own products", c.name, tab.catalog.matchCalls)
		}
	}

	// One team picked: only that team's products are candidates.
	tab.catalog.matchCalls = nil
	tab.list(t, sellingA, &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, Q: "kain", ProductTeamId: sellingB}, 1, 20)

	if !slices.Equal(tab.catalog.matchCalls[0], []uint64{803}) {
		t.Fatalf("candidates under team B = %v, want [803]", tab.catalog.matchCalls[0])
	}
}

// ONE product_service call and ONE inventory call per page, for exactly the page's products and (store, product) pairs —
// never one per row; an empty page asks neither.
func TestSupplierProductList_OneCallOfEachPerPage(t *testing.T) {
	tab := newProductTab(t)

	sumber := insertSupplier(t, tab.db, sellingA, "PT Sumber Makmur")
	shopee := insertChannel(t, tab.db, sumber.ID, "shopee", "Sumber Shopee")
	tokped := insertChannel(t, tab.db, sumber.ID, "tokopedia", "Sumber Tokopedia")

	for i := range 12 {
		store := shopee.ID
		if i%3 == 0 {
			store = tokped.ID
		}

		// Product 700 is bought at both stores: two rows, one product to name.
		product := uint64(700 + i)
		if i == 1 {
			product = 700
		}

		insertLink(t, tab.db, sumber.ID, store, product, sellingA, 30, i)
	}

	rows, _ := tab.list(t, sellingA, &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID}, 1, 5)

	if len(tab.catalog.cardCalls) != 1 || len(tab.goods.asked) != 1 {
		t.Fatalf("product_service asked %d times, inventory %d — want one each", len(tab.catalog.cardCalls), len(tab.goods.asked))
	}

	var wantPairs []supplier_v1.StoreProduct
	var wantProducts []uint64

	for _, row := range rows {
		wantPairs = append(wantPairs, supplier_v1.StoreProduct{StoreID: row.GetChannelId(), ProductID: row.GetProductId()})
		if !slices.Contains(wantProducts, row.GetProductId()) {
			wantProducts = append(wantProducts, row.GetProductId())
		}
	}

	if !slices.Equal(tab.goods.asked[0], wantPairs) || !slices.Equal(tab.catalog.cardCalls[0], wantProducts) {
		t.Fatalf("asked pairs %v, products %v — want the page's %v, %v", tab.goods.asked[0], tab.catalog.cardCalls[0], wantPairs, wantProducts)
	}

	tab.list(t, sellingA, &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID}, 7, 5)

	if len(tab.catalog.cardCalls) != 1 || len(tab.goods.asked) != 1 {
		t.Fatalf("an empty page asked again: product_service %d, inventory %d", len(tab.catalog.cardCalls), len(tab.goods.asked))
	}
}

// EVERY SELLING TEAM READS THE SAME ROWS AND FIGURES — the team that keeps the supplier, another team on Discover
// (another-team-sees-everything-of-a-supplier, every-selling-team-sees-every-teams-figures): `team_id` authorizes and
// never narrows. And no row can carry money — not one field of a row or its figures is a price, a cost or a value.
func TestSupplierProductList_EveryTeamReadsTheSameAndNeverACost(t *testing.T) {
	tab := newProductTab(t)

	sumber := insertSupplier(t, tab.db, sellingA, "PT Sumber Makmur")
	shopee := insertChannel(t, tab.db, sumber.ID, "shopee", "Sumber Shopee")
	tab.catalog.cards[801] = supplier_v1.ProductCard{Name: "Kain Katun", Code: "KTN"}
	tab.goods.figures[supplier_v1.StoreProduct{StoreID: shopee.ID, ProductID: 802}] = supplier_v1.StoreGoods{Sold: 5, Orders: 2, Ready: 9}

	insertLink(t, tab.db, sumber.ID, shopee.ID, 801, sellingA, 5, 1)
	insertLink(t, tab.db, sumber.ID, shopee.ID, 802, sellingB, 5, 2)

	filter := &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID}
	own, _ := tab.list(t, sellingA, filter, 1, 10)
	discover, _ := tab.list(t, sellingB, filter, 1, 10)

	if fmt.Sprint(own) != fmt.Sprint(discover) || len(own) != 2 || discover[1].GetFigures().GetReadyUnits() != 9 {
		t.Fatalf("the keeping team read %v, another team %v — they must read the same rows and figures", own, discover)
	}

	for _, name := range []string{"warehouse.supplier.v1.SupplierProduct", "warehouse.supplier.v1.SupplierProductFigures"} {
		desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(name))
		if err != nil {
			t.Fatal(err)
		}

		fields := desc.(protoreflect.MessageDescriptor).Fields()
		for i := range fields.Len() {
			f := fields.Get(i)
			money := f.Kind() == protoreflect.DoubleKind || f.Kind() == protoreflect.FloatKind
			for _, word := range []string{"price", "cost", "valuation", "value", "total"} {
				money = money || strings.Contains(string(f.Name()), word)
			}

			if money {
				t.Fatalf("%s.%s reads as money — a supplier's product row never carries a price or a cost", name, f.Name())
			}
		}
	}
}

// A deleted or unknown supplier is NotFound, as every read answers it; a seam that cannot answer is an error, never a
// page of nameless or figureless rows.
func TestSupplierProductList_RefusalsAndUnansweredSeams(t *testing.T) {
	tab := newProductTab(t)

	gone := insertSupplier(t, tab.db, sellingA, "Tutup")
	softDelete(t, tab.db, &supplier_service_models.Supplier{}, gone.ID)

	for _, id := range []uint64{gone.ID, 987654} {
		_, _, err := tab.ask(sellingA, &supplierv1.SupplierProductListFilter{SupplierId: id}, 1, 10)
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("supplier %d: err = %v, want NotFound", id, err)
		}
	}

	sumber := insertSupplier(t, tab.db, sellingA, "PT Sumber Makmur")
	insertLink(t, tab.db, sumber.ID, 0, 801, sellingA, 5, 1)
	filter := &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID}

	down := errors.New("down")

	tab.catalog.err = down
	if _, _, err := tab.ask(sellingA, filter, 1, 10); connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("product_service down: err = %v, want Internal", err)
	}

	tab.catalog.err = nil
	tab.goods.err = down

	if _, _, err := tab.ask(sellingA, filter, 1, 10); connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("inventory down: err = %v, want Internal", err)
	}

	// A reader that cannot answer per store and product, or no product_service at all.
	for name, svc := range map[string]*supplier_v1.Service{
		"no ProductGoods": supplier_v1.NewService(tab.db, nil, nil, &fakeGoods{}, nil, tab.catalog),
		"no catalogue":    supplier_v1.NewService(tab.db, nil, nil, &productGoods{}, nil, nil),
	} {
		_, err := svc.SupplierProductList(context.Background(), connect.NewRequest(&supplierv1.SupplierProductListRequest{
			TeamId: sellingA, Filter: filter, Page: page(1, 10),
		}))
		if connect.CodeOf(err) != connect.CodeInternal {
			t.Fatalf("%s: err = %v, want Internal", name, err)
		}
	}
}

// Who reads the tab: the selling side and Root/the Administrator — inventory's SupplierGoods' readers, since a row carries
// figures — never a warehouse role; and it is a read, so the admin team's monitor and an agent may call it.
func TestSupplierProductList_Policy(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.supplier.v1.SupplierProductListRequest")
	if err != nil {
		t.Fatal(err)
	}

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_SELLING_CS,
	}
	if got := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor)).GetRoles(); !slices.Equal(got, want) {
		t.Fatalf("roles = %v, want %v", got, want)
	}

	m, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.supplier.v1.SupplierChannelService.SupplierProductList")
	if err != nil {
		t.Fatal(err)
	}

	options, _ := m.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if options.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("SupplierProductList is a read — it must be marked NO_SIDE_EFFECTS")
	}
}

// THE GUDANG TERKAIT CHIP NARROWS THE PRODUK TAB (a-supplier-page-is-scoped-by-its-warehouses): only the links whose
// (store, product) had goods of the supplier received at the chip's warehouse — asked of inventory ONCE, before the count
// and the page — each with THAT warehouse's Terjual and Siap; Terakhir dibeli stays the link's own. Katun bought at the
// Shopee store sits at both warehouses (a store with goods at both, its figures split); Benang (Shopee) only at 1, Rayon
// (Tokopedia, team B's) only at 2, Kancing (a stall — no store) only at 1. Another team reads the same rows.
func TestSupplierProductList_TheWarehouseChipKeepsItsRows(t *testing.T) {
	tab := newProductTab(t)

	sumber := insertSupplier(t, tab.db, sellingA, "PT Sumber Makmur")
	shopee := insertChannel(t, tab.db, sumber.ID, "shopee", "Sumber Shopee")
	tokped := insertChannel(t, tab.db, sumber.ID, "tokopedia", "Sumber Tokopedia")

	katun := insertLink(t, tab.db, sumber.ID, shopee.ID, 801, sellingA, 30, 1)
	benang := insertLink(t, tab.db, sumber.ID, shopee.ID, 802, sellingA, 30, 2)
	rayon := insertLink(t, tab.db, sumber.ID, tokped.ID, 803, sellingB, 30, 3)
	kancing := insertLink(t, tab.db, sumber.ID, 0, 804, sellingA, 30, 4)

	katunAt := supplier_v1.StoreProduct{StoreID: shopee.ID, ProductID: 801}
	benangAt := supplier_v1.StoreProduct{StoreID: shopee.ID, ProductID: 802}
	rayonAt := supplier_v1.StoreProduct{StoreID: tokped.ID, ProductID: 803}
	kancingAt := supplier_v1.StoreProduct{StoreID: 0, ProductID: 804}

	tab.goods.pairsAt = map[uint64][]supplier_v1.StoreProduct{
		chipWarehouse1: {kancingAt, katunAt, benangAt},
		chipWarehouse2: {katunAt, rayonAt},
	}
	tab.goods.figures[katunAt] = supplier_v1.StoreGoods{Sold: 12, Orders: 4, Ready: 9}
	tab.goods.figuresAt = map[uint64]map[supplier_v1.StoreProduct]supplier_v1.StoreGoods{
		chipWarehouse1: {katunAt: {Sold: 10, Orders: 3, Ready: 2}, benangAt: {Ready: 5}, kancingAt: {Sold: 1, Orders: 1}},
		chipWarehouse2: {katunAt: {Sold: 2, Orders: 1, Ready: 7}, rayonAt: {Ready: 4}},
	}

	cases := []struct {
		name      string
		warehouse uint64
		want      []uint64
	}{
		{"no chip — every link", 0, []uint64{katun.ID, benang.ID, rayon.ID, kancing.ID}},
		{"warehouse 1 — Katun, Benang and the stall's Kancing", chipWarehouse1, []uint64{katun.ID, benang.ID, kancing.ID}},
		{"warehouse 2 — Katun and team B's Rayon", chipWarehouse2, []uint64{katun.ID, rayon.ID}},
		{"warehouse 3 — none", chipWarehouse3, nil},
	}

	for _, c := range cases {
		tab.goods.chipAsked, tab.goods.askedAt = nil, nil

		filter := &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, WarehouseId: c.warehouse}

		rows, total := tab.list(t, sellingA, filter, 1, 20)
		if !slices.Equal(linkIDs(rows), c.want) || total != uint64(len(c.want)) {
			t.Fatalf("%s = %v of %d, want %v", c.name, linkIDs(rows), total, c.want)
		}

		wantAsked := []uint64{c.warehouse}
		if c.warehouse == 0 {
			wantAsked = nil
		}

		if !slices.Equal(tab.goods.chipAsked, wantAsked) {
			t.Fatalf("%s asked inventory for the chip %v — want %v", c.name, tab.goods.chipAsked, wantAsked)
		}

		// The figures are the chip's warehouse's (an empty page asks for none).
		if len(rows) > 0 && !slices.Equal(tab.goods.askedAt, []uint64{c.warehouse}) {
			t.Fatalf("%s read the figures under %v — want the chip's %d", c.name, tab.goods.askedAt, c.warehouse)
		}

		theirs, _ := tab.list(t, sellingB, filter, 1, 20)
		if fmt.Sprint(theirs) != fmt.Sprint(rows) {
			t.Fatalf("%s: team B reads %v, team A %v — every team reads the same", c.name, linkIDs(theirs), linkIDs(rows))
		}
	}

	// Katun under each chip: that warehouse's figures; its Terakhir dibeli is the link's, whatever the chip.
	at := func(warehouse uint64) *supplierv1.SupplierProduct {
		t.Helper()

		rows, _ := tab.list(t, sellingA, &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, WarehouseId: warehouse}, 1, 20)

		return rows[0]
	}

	for _, c := range []struct {
		warehouse         uint64
		sold, orders, rdy int64
	}{{0, 12, 4, 9}, {chipWarehouse1, 10, 3, 2}, {chipWarehouse2, 2, 1, 7}} {
		row := at(c.warehouse)
		f := row.GetFigures()

		if row.GetId() != katun.ID || f.GetSoldUnits() != c.sold || f.GetOrders() != c.orders || f.GetReadyUnits() != c.rdy {
			t.Fatalf("Katun under warehouse %d = %+v, want %d sold on %d, %d ready", c.warehouse, f, c.sold, c.orders, c.rdy)
		}

		if row.GetLastRestockedUnix() != spBase.AddDate(0, 0, -1).Unix() {
			t.Fatalf("Katun under warehouse %d restocked last %d — the link's own date stays", c.warehouse, row.GetLastRestockedUnix())
		}
	}

	// Narrowed BEFORE the count and the page: two a page under chip 1 counts all three.
	rows, total := tab.list(t, sellingA, &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, WarehouseId: chipWarehouse1}, 2, 2)
	if !slices.Equal(linkIDs(rows), []uint64{kancing.ID}) || total != 3 {
		t.Fatalf("chip 1, page 2 of two = %v of %d, want [%d] of 3", linkIDs(rows), total, kancing.ID)
	}
}

// The chip with the tab's own filters: the store, no store, the team — and the search, which asks product_service only
// among the products the chip keeps.
func TestSupplierProductList_TheChipWithTheTabsFilters(t *testing.T) {
	tab := newProductTab(t)

	sumber := insertSupplier(t, tab.db, sellingA, "PT Sumber Makmur")
	shopee := insertChannel(t, tab.db, sumber.ID, "shopee", "Sumber Shopee")

	tab.catalog.cards[801] = supplier_v1.ProductCard{Name: "Kain Katun", Code: "KTN"}
	tab.catalog.cards[802] = supplier_v1.ProductCard{Name: "Kain Rayon", Code: "RYN"}
	tab.catalog.cards[803] = supplier_v1.ProductCard{Name: "Kain Linen", Code: "LNN"}

	katun := insertLink(t, tab.db, sumber.ID, shopee.ID, 801, sellingA, 30, 1)
	rayon := insertLink(t, tab.db, sumber.ID, 0, 802, sellingB, 30, 2)
	insertLink(t, tab.db, sumber.ID, shopee.ID, 803, sellingA, 30, 3) // Linen — never at warehouse 1

	tab.goods.pairsAt = map[uint64][]supplier_v1.StoreProduct{
		chipWarehouse1: {{StoreID: 0, ProductID: 802}, {StoreID: shopee.ID, ProductID: 801}},
	}

	cases := []struct {
		name   string
		filter *supplierv1.SupplierProductListFilter
		want   []uint64
	}{
		{"chip 1 + the Shopee store", &supplierv1.SupplierProductListFilter{StoreId: shopee.ID}, []uint64{katun.ID}},
		{"chip 1 + no store", &supplierv1.SupplierProductListFilter{NoStore: true}, []uint64{rayon.ID}},
		{"chip 1 + team B", &supplierv1.SupplierProductListFilter{ProductTeamId: sellingB}, []uint64{rayon.ID}},
		{"chip 1 + q=kain", &supplierv1.SupplierProductListFilter{Q: "kain"}, []uint64{katun.ID, rayon.ID}},
		{"chip 1 + q=linen", &supplierv1.SupplierProductListFilter{Q: "linen"}, nil},
	}

	for _, c := range cases {
		tab.catalog.matchCalls = nil
		c.filter.SupplierId = sumber.ID
		c.filter.WarehouseId = chipWarehouse1

		rows, total := tab.list(t, sellingA, c.filter, 1, 20)
		if !slices.Equal(linkIDs(rows), c.want) || total != uint64(len(c.want)) {
			t.Fatalf("%s = %v of %d, want %v", c.name, linkIDs(rows), total, c.want)
		}

		// A search asks among the chip's products only — Linen was never received at warehouse 1.
		if c.filter.GetQ() != "" && (len(tab.catalog.matchCalls) != 1 || slices.Contains(tab.catalog.matchCalls[0], 803)) {
			t.Fatalf("%s asked product_service %v — want one search among the chip's products", c.name, tab.catalog.matchCalls)
		}
	}
}

// Under a chip, a reader that cannot say what was received at the warehouse is an error — never a tab of every row.
func TestSupplierProductList_TheChipNeedsInventory(t *testing.T) {
	tab := newProductTab(t)

	sumber := insertSupplier(t, tab.db, sellingA, "PT Sumber Makmur")
	insertLink(t, tab.db, sumber.ID, 0, 801, sellingA, 5, 1)

	filter := &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, WarehouseId: chipWarehouse1}

	tab.goods.err = errors.New("down")

	_, _, err := tab.ask(sellingA, filter, 1, 10)
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("inventory down under a chip: err = %v, want Internal", err)
	}

	bare := supplier_v1.NewService(tab.db, nil, nil, nil, nil, tab.catalog)

	_, err = bare.SupplierProductList(context.Background(), connect.NewRequest(&supplierv1.SupplierProductListRequest{
		TeamId: sellingA, Filter: filter, Page: page(1, 10),
	}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("no inventory under a chip: err = %v, want Internal", err)
	}
}
