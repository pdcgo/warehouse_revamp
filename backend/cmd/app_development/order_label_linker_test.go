package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"connectrpc.com/connect"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// A WAREHOUSE OPENS A SELLER'S LABEL THROUGH THE REAL WIRING (a-warehouse-prints-the-labels-of-orders-it-ships): the
// seller uploads the label under its own team, selling checks the order ships from the warehouse, and the composition
// root's linker has document_service sign it for the seller as its owner — while GetDownloadUrl under the warehouse
// stays NotFound. The only place the two halves meet a database together.
func TestOrderLabelLinker_TheShippingWarehouseOpensTheSellersLabel(t *testing.T) {
	const (
		seller    uint64 = 9_000_040
		warehouse uint64 = 9_000_041
		elsewhere uint64 = 9_000_042
	)

	db := san_testdb.DB(t)
	ctx := context.Background()

	cfg := docstore.DefaultConfig(docstore.Config{Dir: t.TempDir(), BaseURL: "http://test.local/files", TokenSecret: "test"})
	documents := document_v1.NewService(db, cfg)
	orders := selling_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, NewOrderLabelLinker(documents))

	// The seller's upload — the real two-phase flow.
	up, err := documents.RequestUpload(ctx, connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId:       seller,
		ResourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT,
		ContentType:  "application/pdf",
		SizeBytes:    10,
		Filename:     "resi.pdf",
	}))
	if err != nil {
		t.Fatalf("RequestUpload: %v", err)
	}

	key := strings.TrimPrefix(up.Msg.GetUploadUrl(), cfg.BaseURL+"/")
	if i := strings.Index(key, "?"); i >= 0 {
		key = key[:i]
	}

	path := filepath.Join(cfg.Dir, filepath.FromSlash(key))

	err = os.MkdirAll(filepath.Dir(path), 0o755)
	if err != nil {
		t.Fatal(err)
	}

	err = os.WriteFile(path, []byte("%PDF-label"), 0o644)
	if err != nil {
		t.Fatal(err)
	}

	conf, err := documents.ConfirmUpload(ctx, connect.NewRequest(&documentv1.ConfirmUploadRequest{UploadToken: up.Msg.GetUploadToken()}))
	if err != nil {
		t.Fatalf("ConfirmUpload: %v", err)
	}

	shop := selling_service_models.Shop{TeamID: seller, Name: "Toko Label", ShopCode: "LBL-WIRE", Marketplace: "shopee"}

	err = db.Create(&shop).Error
	if err != nil {
		t.Fatalf("insert shop: %v", err)
	}

	order := selling_service_models.Order{
		TeamID: seller, ShopID: shop.ID, WarehouseID: warehouse, Status: "processed", CustomerName: "Budi",
		ReceiptDocumentID: conf.Msg.GetDocument().GetId(), ReceiptFilename: "resi.pdf", ReceiptMimeType: "application/pdf",
	}

	err = db.Create(&order).Error
	if err != nil {
		t.Fatalf("insert order: %v", err)
	}

	res, err := orders.OrderLabels(ctx, connect.NewRequest(&sellingv1.OrderLabelsRequest{TeamId: warehouse, OrderIds: []uint64{order.ID}}))
	if err != nil {
		t.Fatalf("OrderLabels: %v", err)
	}

	if !res.Msg.GetResults()[0].GetIncluded() || !strings.Contains(res.Msg.GetUrl(), "resi.pdf") || res.Msg.GetExpiresAtUnix() == 0 {
		t.Fatalf("the shipping warehouse's answer = %v", res.Msg)
	}

	other, err := orders.OrderLabels(ctx, connect.NewRequest(&sellingv1.OrderLabelsRequest{TeamId: elsewhere, OrderIds: []uint64{order.ID}}))
	if err != nil || other.Msg.GetResults()[0].GetReason() != sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NOT_SHIPPED_HERE {
		t.Fatalf("another warehouse = %v, %v", other, err)
	}

	_, err = documents.GetDownloadUrl(ctx, connect.NewRequest(&documentv1.GetDownloadUrlRequest{
		TeamId: warehouse, DocumentId: order.ReceiptDocumentID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("GetDownloadUrl as the warehouse = %v — no share may have been made", err)
	}
}
