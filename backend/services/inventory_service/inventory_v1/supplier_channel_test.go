package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

const (
	chOnline  = inventoryv1.SupplierChannelType_SUPPLIER_CHANNEL_TYPE_ONLINE
	chOffline = inventoryv1.SupplierChannelType_SUPPLIER_CHANNEL_TYPE_OFFLINE
	mpUnset   = marketplacev1.Marketplace_MARKETPLACE_UNSPECIFIED
	mpShopee  = marketplacev1.Marketplace_MARKETPLACE_SHOPEE
	mpTokped  = marketplacev1.Marketplace_MARKETPLACE_TOKOPEDIA
)

// An online channel round-trips its marketplace + url; an offline one stores no marketplace even if
// one is (wrongly) supplied.
func TestSupplierChannel_CreateOnlineAndOffline(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	supplierID := insertSupplier(t, db, 2, "Vendor", "V1")

	online, err := svc.SupplierChannelCreate(context.Background(), connect.NewRequest(&inventoryv1.SupplierChannelCreateRequest{
		TeamId: 2, SupplierId: supplierID, Type: chOnline, Marketplace: mpShopee,
		Name: "Vendor Official", Url: "https://shopee.co.id/vendor",
	}))
	if err != nil {
		t.Fatalf("create online: %v", err)
	}
	got := online.Msg.GetChannel()
	if got.GetType() != chOnline || got.GetMarketplace() != mpShopee ||
		got.GetName() != "Vendor Official" || got.GetUrl() != "https://shopee.co.id/vendor" {
		t.Fatalf("online channel did not round-trip: %+v", got)
	}

	// Offline: a marketplace on the request is ignored (an offline channel has none).
	offline, err := svc.SupplierChannelCreate(context.Background(), connect.NewRequest(&inventoryv1.SupplierChannelCreateRequest{
		TeamId: 2, SupplierId: supplierID, Type: chOffline, Marketplace: mpShopee,
		Name: "Physical Shop", Contact: "0812", Location: "Jl. Pasar 1",
	}))
	if err != nil {
		t.Fatalf("create offline: %v", err)
	}
	off := offline.Msg.GetChannel()
	if off.GetType() != chOffline || off.GetMarketplace() != mpUnset ||
		off.GetContact() != "0812" || off.GetLocation() != "Jl. Pasar 1" {
		t.Fatalf("offline channel wrong: %+v", off)
	}
}

// An online channel with no marketplace is rejected before it is stored.
func TestSupplierChannel_OnlineNeedsMarketplace(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	supplierID := insertSupplier(t, db, 2, "Vendor", "V1")

	_, err := svc.SupplierChannelCreate(context.Background(), connect.NewRequest(&inventoryv1.SupplierChannelCreateRequest{
		TeamId: 2, SupplierId: supplierID, Type: chOnline, Name: "no marketplace",
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("online-without-marketplace code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}

// Channels are scoped to a supplier through its team: another team cannot add to, or list, this
// supplier's channels.
func TestSupplierChannel_TeamScoped(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	supplierID := insertSupplier(t, db, 2, "Vendor", "V1")
	otherSupplier := insertSupplier(t, db, 2, "Other Vendor", "V2")

	// Two channels on the first supplier, one on the second.
	mustCreate(t, svc, 2, supplierID, chOnline, mpShopee, "A")
	mustCreate(t, svc, 2, supplierID, chOffline, mpUnset, "B")
	mustCreate(t, svc, 2, otherSupplier, chOnline, mpTokped, "C")

	list, err := svc.SupplierChannelList(context.Background(), connect.NewRequest(&inventoryv1.SupplierChannelListRequest{
		TeamId: 2, SupplierId: supplierID, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list.Msg.GetChannels()) != 2 {
		t.Fatalf("supplier channels = %d, want 2", len(list.Msg.GetChannels()))
	}

	// A team that does not own the supplier reads it as NotFound (create and list alike).
	_, err = svc.SupplierChannelList(context.Background(), connect.NewRequest(&inventoryv1.SupplierChannelListRequest{
		TeamId: 3, SupplierId: supplierID, Page: page1(),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team list code = %v, want NotFound", connect.CodeOf(err))
	}

	_, err = svc.SupplierChannelCreate(context.Background(), connect.NewRequest(&inventoryv1.SupplierChannelCreateRequest{
		TeamId: 3, SupplierId: supplierID, Type: chOnline, Marketplace: mpShopee, Name: "hijack",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team create code = %v, want NotFound", connect.CodeOf(err))
	}
}

// Update: rename + change marketplace; switching online→offline clears the marketplace; switching
// back to online with no marketplace is rejected; another team cannot update it.
func TestSupplierChannel_Update(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	supplierID := insertSupplier(t, db, 2, "Vendor", "V1")
	id := mustCreate(t, svc, 2, supplierID, chOnline, mpShopee, "A")

	mp := mpTokped
	upd, err := svc.SupplierChannelUpdate(context.Background(), connect.NewRequest(&inventoryv1.SupplierChannelUpdateRequest{
		TeamId: 2, ChannelId: id, Name: proto.String("B"), Marketplace: &mp,
	}))
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if got := upd.Msg.GetChannel(); got.GetName() != "B" || got.GetMarketplace() != mpTokped {
		t.Fatalf("after update: %+v", got)
	}

	// Switch to offline — the marketplace is cleared.
	off := chOffline
	upd, err = svc.SupplierChannelUpdate(context.Background(), connect.NewRequest(&inventoryv1.SupplierChannelUpdateRequest{
		TeamId: 2, ChannelId: id, Type: &off, Contact: proto.String("0899"),
	}))
	if err != nil {
		t.Fatalf("update to offline: %v", err)
	}
	if got := upd.Msg.GetChannel(); got.GetType() != chOffline || got.GetMarketplace() != mpUnset || got.GetContact() != "0899" {
		t.Fatalf("after offline switch: %+v", got)
	}

	// Switching back to online without giving a marketplace is rejected.
	on := chOnline
	_, err = svc.SupplierChannelUpdate(context.Background(), connect.NewRequest(&inventoryv1.SupplierChannelUpdateRequest{
		TeamId: 2, ChannelId: id, Type: &on,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("online-switch-without-marketplace code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	// Another team cannot update it.
	_, err = svc.SupplierChannelUpdate(context.Background(), connect.NewRequest(&inventoryv1.SupplierChannelUpdateRequest{
		TeamId: 3, ChannelId: id, Name: proto.String("z"),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team update code = %v, want NotFound", connect.CodeOf(err))
	}
}

// Delete removes the channel; another team cannot delete it.
func TestSupplierChannel_Delete(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	supplierID := insertSupplier(t, db, 2, "Vendor", "V1")
	id := mustCreate(t, svc, 2, supplierID, chOnline, mpShopee, "A")

	// Another team cannot delete it.
	_, err := svc.SupplierChannelDelete(context.Background(), connect.NewRequest(&inventoryv1.SupplierChannelDeleteRequest{
		TeamId: 3, ChannelId: id,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team delete code = %v, want NotFound", connect.CodeOf(err))
	}

	// The owning team deletes it, and it drops from the list.
	_, err = svc.SupplierChannelDelete(context.Background(), connect.NewRequest(&inventoryv1.SupplierChannelDeleteRequest{
		TeamId: 2, ChannelId: id,
	}))
	if err != nil {
		t.Fatalf("delete: %v", err)
	}

	list, err := svc.SupplierChannelList(context.Background(), connect.NewRequest(&inventoryv1.SupplierChannelListRequest{
		TeamId: 2, SupplierId: supplierID, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("list after delete: %v", err)
	}
	if len(list.Msg.GetChannels()) != 0 {
		t.Fatalf("deleted channel still listed: %+v", list.Msg.GetChannels())
	}
}

// mustCreate adds a channel and returns its id, failing the test on error.
func mustCreate(
	t *testing.T,
	svc *inventory_v1.Service,
	teamID, supplierID uint64,
	chType inventoryv1.SupplierChannelType,
	marketplace marketplacev1.Marketplace,
	name string,
) uint64 {
	t.Helper()

	resp, err := svc.SupplierChannelCreate(context.Background(), connect.NewRequest(&inventoryv1.SupplierChannelCreateRequest{
		TeamId: teamID, SupplierId: supplierID, Type: chType, Marketplace: marketplace, Name: name,
	}))
	if err != nil {
		t.Fatalf("create channel %q: %v", name, err)
	}

	return resp.Msg.GetChannel().GetId()
}
