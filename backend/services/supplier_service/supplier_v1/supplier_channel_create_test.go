package supplier_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// custom-is-labelled-other: the owner's `custom` is MARKETPLACE_OTHER, stored as the shared code `other`.
func TestSupplierChannelCreate_AddsAStore(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mine := insertSupplier(t, db, sellingA, "Sumber")

	resp, err := svc.SupplierChannelCreate(context.Background(), connect.NewRequest(&supplierv1.SupplierChannelCreateRequest{
		TeamId:      sellingA,
		SupplierId:  mine.ID,
		ChannelType: marketplacev1.Marketplace_MARKETPLACE_OTHER,
		Name:        "Website",
		Uri:         "https://sumber.example",
		Description: "order by WhatsApp",
	}))
	if err != nil {
		t.Fatalf("SupplierChannelCreate: %v", err)
	}

	got := resp.Msg.GetChannel()
	if got.GetId() == 0 || got.GetSupplierId() != mine.ID || got.GetChannelType() != marketplacev1.Marketplace_MARKETPLACE_OTHER ||
		got.GetName() != "Website" || got.GetUri() != "https://sumber.example" || got.GetDescription() != "order by WhatsApp" {
		t.Fatalf("unexpected store: %+v", got)
	}

	if row := loadChannel(t, db, got.GetId()); row.ChannelType != "other" {
		t.Fatalf("stored channel_type = %q, want the shared code \"other\"", row.ChannelType)
	}
}

// Writes stay with the team that keeps the supplier; a deleted supplier takes no new store.
func TestSupplierChannelCreate_AnotherTeamsOrDeletedSupplierIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	theirs := insertSupplier(t, db, sellingB, "Theirs")
	gone := insertSupplier(t, db, sellingA, "Gone")
	softDelete(t, db, &supplier_service_models.Supplier{}, gone.ID)

	for _, id := range []uint64{theirs.ID, gone.ID} {
		_, err := svc.SupplierChannelCreate(context.Background(), connect.NewRequest(&supplierv1.SupplierChannelCreateRequest{
			TeamId: sellingA, SupplierId: id, ChannelType: marketplacev1.Marketplace_MARKETPLACE_SHOPEE, Name: "Store",
		}))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("create on supplier %d = %v, want NotFound", id, connect.CodeOf(err))
		}
	}

	if n := countRows(t, db, &supplier_service_models.SupplierChannel{}); n != 0 {
		t.Fatalf("a refused create wrote %d stores", n)
	}
}
