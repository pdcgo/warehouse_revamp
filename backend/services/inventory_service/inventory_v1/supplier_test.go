package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// insertSupplier seeds an active supplier directly and returns its id.
func insertSupplier(t *testing.T, db *gorm.DB, teamID uint64, name, code string) uint64 {
	t.Helper()

	s := inventory_service_models.Supplier{TeamID: teamID, Name: name, Code: code}

	err := db.Create(&s).Error
	if err != nil {
		t.Fatalf("insert supplier: %v", err)
	}

	return s.ID
}

func TestSupplierCreate_CreatesInTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	resp, err := svc.SupplierCreate(context.Background(), connect.NewRequest(&inventoryv1.SupplierCreateRequest{
		TeamId: 2, Code: "SUP-1", Name: "My Supplier",
		Contact: "0812", Province: "West Java", City: "Bandung", Address: "Jl. 1", Description: "a supplier",
	}))
	if err != nil {
		t.Fatalf("SupplierCreate: %v", err)
	}

	got := resp.Msg.GetSupplier()
	if got.GetId() == 0 || got.GetTeamId() != 2 || got.GetCode() != "SUP-1" || got.GetName() != "My Supplier" {
		t.Fatalf("unexpected supplier: %+v", got)
	}
	if got.GetContact() != "0812" || got.GetProvince() != "West Java" || got.GetCity() != "Bandung" ||
		got.GetAddress() != "Jl. 1" || got.GetDescription() != "a supplier" {
		t.Fatalf("fields did not round-trip: %+v", got)
	}
}

// code is unique per team among active suppliers.
func TestSupplierCreate_DuplicateCodeRejected(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	req := func() *connect.Request[inventoryv1.SupplierCreateRequest] {
		return connect.NewRequest(&inventoryv1.SupplierCreateRequest{TeamId: 2, Name: "First", Code: "DUP"})
	}

	_, err := svc.SupplierCreate(context.Background(), req())
	if err != nil {
		t.Fatalf("first create: %v", err)
	}

	_, err = svc.SupplierCreate(context.Background(), req())
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("duplicate code = %v, want AlreadyExists", connect.CodeOf(err))
	}
}

// The same code is fine in a DIFFERENT team.
func TestSupplierCreate_SameCodeDifferentTeamOk(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.SupplierCreate(context.Background(), connect.NewRequest(&inventoryv1.SupplierCreateRequest{
		TeamId: 2, Name: "A", Code: "SHARED",
	}))
	if err != nil {
		t.Fatalf("team 2 create: %v", err)
	}

	_, err = svc.SupplierCreate(context.Background(), connect.NewRequest(&inventoryv1.SupplierCreateRequest{
		TeamId: 3, Name: "B", Code: "SHARED",
	}))
	if err != nil {
		t.Fatalf("team 3 create with same code should succeed: %v", err)
	}
}

func TestSupplierList_ScopedAndSearchable(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertSupplier(t, db, 2, "Alpha Trading", "A1")
	insertSupplier(t, db, 2, "Beta Trading", "B1")
	insertSupplier(t, db, 3, "Other Team Supplier", "C1") // different team — must not appear

	// Team 2 sees only its own two suppliers.
	resp, err := svc.SupplierList(context.Background(), connect.NewRequest(&inventoryv1.SupplierListRequest{
		TeamId: 2, Page: &commonv1.PageFilter{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("SupplierList: %v", err)
	}
	if len(resp.Msg.GetSuppliers()) != 2 {
		t.Fatalf("team 2 suppliers = %d, want 2", len(resp.Msg.GetSuppliers()))
	}

	// `q` filters by name or code.
	resp, err = svc.SupplierList(context.Background(), connect.NewRequest(&inventoryv1.SupplierListRequest{
		TeamId: 2, Q: "alpha", Page: &commonv1.PageFilter{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("SupplierList (q): %v", err)
	}
	if len(resp.Msg.GetSuppliers()) != 1 || resp.Msg.GetSuppliers()[0].GetName() != "Alpha Trading" {
		t.Fatalf("search result = %+v", resp.Msg.GetSuppliers())
	}
}

func TestSupplierList_Paginates(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertSupplier(t, db, 2, "One", "P1")
	insertSupplier(t, db, 2, "Two", "P2")
	insertSupplier(t, db, 2, "Three", "P3")

	// Page 1 of 2 returns two rows; the page info reports the full total.
	resp, err := svc.SupplierList(context.Background(), connect.NewRequest(&inventoryv1.SupplierListRequest{
		TeamId: 2, Page: &commonv1.PageFilter{Page: 1, Limit: 2},
	}))
	if err != nil {
		t.Fatalf("SupplierList page 1: %v", err)
	}
	if len(resp.Msg.GetSuppliers()) != 2 {
		t.Fatalf("page 1 rows = %d, want 2", len(resp.Msg.GetSuppliers()))
	}
	if resp.Msg.GetPageInfo().GetTotalItems() != 3 || resp.Msg.GetPageInfo().GetTotalPage() != 2 {
		t.Fatalf("page info = %+v, want total 3 / 2 pages", resp.Msg.GetPageInfo())
	}

	// Page 2 returns the last row.
	resp, err = svc.SupplierList(context.Background(), connect.NewRequest(&inventoryv1.SupplierListRequest{
		TeamId: 2, Page: &commonv1.PageFilter{Page: 2, Limit: 2},
	}))
	if err != nil {
		t.Fatalf("SupplierList page 2: %v", err)
	}
	if len(resp.Msg.GetSuppliers()) != 1 {
		t.Fatalf("page 2 rows = %d, want 1", len(resp.Msg.GetSuppliers()))
	}
}

func TestSupplierDetail_Returns(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertSupplier(t, db, 2, "Detail Supplier", "D1")

	resp, err := svc.SupplierDetail(context.Background(), connect.NewRequest(&inventoryv1.SupplierDetailRequest{
		TeamId: 2, SupplierId: id,
	}))
	if err != nil {
		t.Fatalf("SupplierDetail: %v", err)
	}

	got := resp.Msg.GetSupplier()
	if got.GetName() != "Detail Supplier" || got.GetCode() != "D1" {
		t.Fatalf("unexpected supplier: %+v", got)
	}
}

// A supplier belongs to team 2; team 3 must not read it via its own scope.
func TestSupplierDetail_CrossTeamIsolation(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertSupplier(t, db, 2, "Team 2 supplier", "T2")

	_, err := svc.SupplierDetail(context.Background(), connect.NewRequest(&inventoryv1.SupplierDetailRequest{
		TeamId: 3, SupplierId: id,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team detail code = %v, want NotFound", connect.CodeOf(err))
	}
}

func TestSupplierUpdate_ChangesFields(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertSupplier(t, db, 2, "Old name", "S1")

	resp, err := svc.SupplierUpdate(context.Background(), connect.NewRequest(&inventoryv1.SupplierUpdateRequest{
		TeamId: 2, SupplierId: id, Name: proto.String("New name"), City: proto.String("Surabaya"),
	}))
	if err != nil {
		t.Fatalf("SupplierUpdate: %v", err)
	}

	got := resp.Msg.GetSupplier()
	if got.GetName() != "New name" || got.GetCode() != "S1" || got.GetCity() != "Surabaya" {
		t.Fatalf("unexpected after update: %+v", got)
	}
}

func TestSupplierUpdate_UnknownIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.SupplierUpdate(context.Background(), connect.NewRequest(&inventoryv1.SupplierUpdateRequest{
		TeamId: 2, SupplierId: 9999, Name: proto.String("x"),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}

// A supplier belongs to team 2; team 3 must not update it via its own scope.
func TestSupplierUpdate_CrossTeamIsolation(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertSupplier(t, db, 2, "Team 2 supplier", "S2")

	_, err := svc.SupplierUpdate(context.Background(), connect.NewRequest(&inventoryv1.SupplierUpdateRequest{
		TeamId: 3, SupplierId: id, Name: proto.String("hijacked"),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team update code = %v, want NotFound", connect.CodeOf(err))
	}
}

func TestSupplierDelete_SoftDeletesAndDropsFromList(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertSupplier(t, db, 2, "Doomed", "DEL")

	_, err := svc.SupplierDelete(context.Background(), connect.NewRequest(&inventoryv1.SupplierDeleteRequest{
		TeamId: 2, SupplierId: id,
	}))
	if err != nil {
		t.Fatalf("SupplierDelete: %v", err)
	}

	// Gone from the list (SupplierList excludes deleted = true).
	resp, err := svc.SupplierList(context.Background(), connect.NewRequest(&inventoryv1.SupplierListRequest{
		TeamId: 2, Page: &commonv1.PageFilter{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("SupplierList: %v", err)
	}
	if len(resp.Msg.GetSuppliers()) != 0 {
		t.Fatalf("deleted supplier still listed: %+v", resp.Msg.GetSuppliers())
	}
}

// A supplier belongs to team 2; team 3 must not delete it via its own scope.
func TestSupplierDelete_CrossTeamIsolation(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertSupplier(t, db, 2, "Team 2 supplier", "S3")

	_, err := svc.SupplierDelete(context.Background(), connect.NewRequest(&inventoryv1.SupplierDeleteRequest{
		TeamId: 3, SupplierId: id,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team delete code = %v, want NotFound", connect.CodeOf(err))
	}
}
