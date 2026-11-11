package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/pdfcpu/pdfcpu/pkg/api"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
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
	orders := selling_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, NewOrderLabelLinker(documents), nil, nil)

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
		IdempotencyKey: newOrderKey(),
		TeamID:         seller, ShopID: shop.ID, WarehouseID: warehouse, Status: "processed", Address: &selling_service_models.OrderAddress{CustomerName: "Budi"},
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

// SEVERAL LABELS THROUGH THE REAL WIRING: two real marketplace labels and one order with none, printed together — the
// order service reads the seller's files through the linker, merges them, and document_service stores the PDF as an
// ORDER_LABELS document of the WAREHOUSE, which the warehouse then reads as its own; the seller's labels stay unshared.
func TestOrderLabelLinker_TheWarehouseMergesTheSellersLabels(t *testing.T) {
	const (
		seller    uint64 = 9_000_050
		warehouse uint64 = 9_000_051
	)

	db := san_testdb.DB(t)
	ctx := context.Background()

	cfg := docstore.DefaultConfig(docstore.Config{Dir: t.TempDir(), BaseURL: "http://test.local/files", TokenSecret: "test"})
	documents := document_v1.NewService(db, cfg)
	orders := selling_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, NewOrderLabelLinker(documents), nil, nil)

	shop := selling_service_models.Shop{TeamID: seller, Name: "Toko Label", ShopCode: "LBL-MERGE", Marketplace: "shopee"}

	err := db.Create(&shop).Error
	if err != nil {
		t.Fatalf("insert shop: %v", err)
	}

	want := 0
	ids := make([]uint64, 0, 3)

	for _, name := range []string{"shopee_reg_01.pdf", "", "lazada_lex_01.pdf"} {
		order := selling_service_models.Order{
			IdempotencyKey: newOrderKey(),
			TeamID:         seller, ShopID: shop.ID, WarehouseID: warehouse, Status: "processed",
			Address: &selling_service_models.OrderAddress{CustomerName: "Budi"},
		}

		if name != "" {
			content, readErr := os.ReadFile(filepath.Join("../../../examples/receipt_file_samples", name))
			if readErr != nil {
				t.Skipf("label sample: %v", readErr)
			}

			pages, countErr := api.PageCount(bytes.NewReader(content), nil)
			if countErr != nil {
				t.Fatal(countErr)
			}

			want += pages
			order.ReceiptDocumentID = uploadSellerLabel(t, documents, cfg, seller, name, content)
		}

		err = db.Create(&order).Error
		if err != nil {
			t.Fatalf("insert order: %v", err)
		}

		ids = append(ids, order.ID)
	}

	res, err := orders.OrderLabels(ctx, connect.NewRequest(&sellingv1.OrderLabelsRequest{TeamId: warehouse, OrderIds: ids}))
	if err != nil {
		t.Fatalf("OrderLabels: %v", err)
	}

	got := res.Msg.GetResults()
	if !got[0].GetIncluded() || got[1].GetReason() != sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NO_LABEL || !got[2].GetIncluded() {
		t.Fatalf("results = %v", got)
	}

	var sheets []document_service_models.Document

	err = db.Where("team_id = ? AND resource_type = ?", warehouse, "order_labels").Find(&sheets).Error
	if err != nil || len(sheets) != 1 {
		t.Fatalf("stored sheets = %v, %v — want one under the warehouse", sheets, err)
	}

	if !strings.Contains(res.Msg.GetUrl(), sheets[0].ObjectKey) || res.Msg.GetExpiresAtUnix() == 0 {
		t.Fatalf("link %q does not point at the stored sheet %q", res.Msg.GetUrl(), sheets[0].ObjectKey)
	}

	merged, err := os.ReadFile(filepath.Join(cfg.Dir, filepath.FromSlash(sheets[0].ObjectKey)))
	if err != nil {
		t.Fatal(err)
	}

	pages, err := api.PageCount(bytes.NewReader(merged), nil)
	if err != nil || pages != want {
		t.Fatalf("the stored PDF has %d pages (%v), want %d", pages, err, want)
	}

	// The warehouse reads its own print through the ordinary door…
	_, err = documents.GetDownloadUrl(ctx, connect.NewRequest(&documentv1.GetDownloadUrlRequest{TeamId: warehouse, DocumentId: sheets[0].ID}))
	if err != nil {
		t.Fatalf("GetDownloadUrl of its own print: %v", err)
	}

	// …and the seller's labels were read, never shared.
	var shares int64

	err = db.Table("document_shares").Count(&shares).Error
	if err != nil || shares != 0 {
		t.Fatalf("document_shares = %d (%v) — a label must never be shared", shares, err)
	}
}

// uploadSellerLabel is the seller's real two-phase upload of one label.
func uploadSellerLabel(t *testing.T, documents *document_v1.Service, cfg docstore.Config, seller uint64, name string, content []byte) string {
	t.Helper()

	ctx := context.Background()

	up, err := documents.RequestUpload(ctx, connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId:       seller,
		ResourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_ORDER_RECEIPT,
		ContentType:  "application/pdf",
		SizeBytes:    int64(len(content)),
		Filename:     name,
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

	err = os.WriteFile(path, content, 0o644)
	if err != nil {
		t.Fatal(err)
	}

	conf, err := documents.ConfirmUpload(ctx, connect.NewRequest(&documentv1.ConfirmUploadRequest{UploadToken: up.Msg.GetUploadToken()}))
	if err != nil {
		t.Fatalf("ConfirmUpload: %v", err)
	}

	return conf.Msg.GetDocument().GetId()
}
