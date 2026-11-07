package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ONE ADDRESS ROW PER ORDER, NAMES ONLY (one-address-per-order-and-per-draft, an-address-is-plain-names): OrderCreate
// writes exactly one order_addresses row in the order's own transaction — the customer, the four names, the postcode
// and the line — and no region code reaches it.
func TestOrderCreate_WritesTheOrdersOneAddressRow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	req := feeOrderReq(shop)
	req.CustomerName = "Bu Ani"
	req.CustomerPhone = "0812-0001"
	req.Address = &sellingv1.OrderAddress{
		ProvinsiCode: "11", ProvinsiName: "Aceh",
		KabupatenCode: "11.01", KabupatenName: "Kabupaten Aceh Selatan",
		KecamatanCode: "11.01.01", KecamatanName: "Bakongan",
		DesaCode: "11.01.01.2001", DesaName: "Keude Bakongan",
		KodePos: "23773", AddressLine: "Jl. Test 1",
	}

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	var rows []selling_service_models.OrderAddress

	err = db.Where("order_id = ?", created.Msg.GetOrder().GetId()).Find(&rows).Error
	if err != nil {
		t.Fatalf("read the address rows: %v", err)
	}

	if len(rows) != 1 {
		t.Fatalf("%d address rows, want exactly one", len(rows))
	}

	got := rows[0]
	if got.CustomerName != "Bu Ani" || got.CustomerPhone != "0812-0001" || got.ProvinsiName != "Aceh" ||
		got.DesaName != "Keude Bakongan" || got.PostalCode != "23773" || got.AddressLine != "Jl. Test 1" {
		t.Fatalf("address row = %+v", got)
	}

	// The response names the buyer from that row.
	if created.Msg.GetOrder().GetCustomerName() != "Bu Ani" || created.Msg.GetOrder().GetAddress().GetDesaName() != "Keude Bakongan" {
		t.Fatalf("response = %+v", created.Msg.GetOrder())
	}
}

// A SECOND ROW FOR ONE ORDER IS REFUSED (order_addresses_order_unique), and so is a row with no customer name
// (order_addresses_customer_present) — the guarantee orders_customer_present carried before 00045.
func TestOrderAddresses_OneRowPerOrderAndANamedCustomer(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(feeOrderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	orderID := created.Msg.GetOrder().GetId()

	err = db.Exec("SAVEPOINT second_row").Error
	if err != nil {
		t.Fatalf("savepoint: %v", err)
	}

	err = db.Create(&selling_service_models.OrderAddress{OrderID: orderID, CustomerName: "Someone Else"}).Error
	if err == nil {
		t.Fatalf("a second address row for order %d was accepted, want refused", orderID)
	}

	err = db.Exec("ROLLBACK TO SAVEPOINT second_row").Error
	if err != nil {
		t.Fatalf("rollback to savepoint: %v", err)
	}

	var other selling_service_models.Order

	err = db.Where("id = ?", orderID).First(&other).Error
	if err != nil {
		t.Fatalf("re-read: %v", err)
	}

	other.ID = 0
	other.IdempotencyKey = newOrderKey()

	err = db.Omit("Address", "Items", "TimelineLogs").Create(&other).Error
	if err != nil {
		t.Fatalf("seed a second order: %v", err)
	}

	err = db.Create(&selling_service_models.OrderAddress{OrderID: other.ID, CustomerName: ""}).Error
	if err == nil {
		t.Fatalf("an address row with no customer name was accepted, want refused")
	}
}

// THE LIST SEARCHES THE BUYER ON THE ADDRESS ROW: a name and a phone find the order through order_addresses.
func TestOrderList_SearchesTheCustomerOnTheAddressRow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	sari := feeOrderReq(shop)
	sari.CustomerName = "Sari Wulandari"
	sari.CustomerPhone = "0813-777"

	other := feeOrderReq(shop)
	other.CustomerName = "Budi"

	for _, req := range []*sellingv1.OrderCreateRequest{sari, other} {
		_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
		if err != nil {
			t.Fatalf("create: %v", err)
		}
	}

	for _, term := range []string{"wulan", "0813-777"} {
		got := orderRows(listFiltered(t, svc, 2, &sellingv1.OrderListFilter{Search: term}))
		if len(got) != 1 || got[0].GetCustomerName() != "Sari Wulandari" {
			t.Fatalf("search %q found %d orders (%v), want Sari's one", term, len(got), got)
		}
	}
}
