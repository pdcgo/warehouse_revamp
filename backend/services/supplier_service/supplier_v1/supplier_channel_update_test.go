package supplier_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

func TestSupplierChannelUpdate_WritesOnlyWhatIsSent(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	s := insertSupplier(t, db, sellingA, "Sumber")
	store := insertChannel(t, db, s.ID, "shopee", "Sumber Official")

	resp, err := svc.SupplierChannelUpdate(context.Background(), connect.NewRequest(&supplierv1.SupplierChannelUpdateRequest{
		TeamId:      sellingA,
		ChannelId:   store.ID,
		ChannelType: marketplacev1.Marketplace_MARKETPLACE_TOKOPEDIA.Enum(),
		Description: proto.String("moved to Tokopedia"),
	}))
	if err != nil {
		t.Fatalf("SupplierChannelUpdate: %v", err)
	}

	got := resp.Msg.GetChannel()
	if got.GetChannelType() != marketplacev1.Marketplace_MARKETPLACE_TOKOPEDIA || got.GetName() != "Sumber Official" ||
		got.GetDescription() != "moved to Tokopedia" {
		t.Fatalf("unexpected store after update: %+v", got)
	}
}

func TestSupplierChannelUpdate_AnotherTeamsOrDeletedStoreIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	theirs := insertSupplier(t, db, sellingB, "Theirs")
	theirStore := insertChannel(t, db, theirs.ID, "shopee", "Theirs")

	mine := insertSupplier(t, db, sellingA, "Mine")
	deadStore := insertChannel(t, db, mine.ID, "shopee", "Dead")
	softDelete(t, db, &supplier_service_models.SupplierChannel{}, deadStore.ID)

	goneSupplier := insertSupplier(t, db, sellingA, "Gone")
	orphan := insertChannel(t, db, goneSupplier.ID, "shopee", "Orphan")
	softDelete(t, db, &supplier_service_models.Supplier{}, goneSupplier.ID)

	for _, id := range []uint64{theirStore.ID, deadStore.ID, orphan.ID} {
		_, err := svc.SupplierChannelUpdate(context.Background(), connect.NewRequest(&supplierv1.SupplierChannelUpdateRequest{
			TeamId: sellingA, ChannelId: id, Name: proto.String("Hijacked"),
		}))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("update of store %d = %v, want NotFound", id, connect.CodeOf(err))
		}

		if row := loadChannel(t, db, id); row.Name == "Hijacked" {
			t.Fatalf("a refused update renamed store %d", id)
		}
	}
}
