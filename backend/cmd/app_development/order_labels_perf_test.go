//go:build perfaudit

// Performance audit for OrderLabels printing a full page of labels at once (a-warehouse-prints-the-labels-of-orders-it-ships,
// the audit-rpc-performance skill): 50 orders, each with a real marketplace label, merged into one PDF through the REAL
// linker, the REAL document_service over its local store, on one probed database seeded with 20 000 other label rows.
//
//	go test -tags perfaudit -p 1 -run TestPerf_OrderLabels_FiftyMerged -v ./backend/cmd/app_development/
package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/docstore"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

func TestPerf_OrderLabels_FiftyMerged(t *testing.T) {
	const (
		seller    uint64 = 9_000_060
		warehouse uint64 = 9_000_061
		labels           = 50
		others           = 20_000
	)

	db, probe := san_perf.Wrap(san_testdb.DB(t))
	ctx := context.Background()

	cfg := docstore.DefaultConfig(docstore.Config{Dir: t.TempDir(), BaseURL: "http://test.local/files", TokenSecret: "test"})
	documents := document_v1.NewService(db, cfg)
	svc := selling_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, NewOrderLabelLinker(documents), nil, nil)

	samples, err := filepath.Glob("../../../examples/receipt_file_samples/*.pdf")
	if err != nil || len(samples) == 0 {
		t.Skipf("no label samples: %v", err)
	}

	sort.Strings(samples)

	// 20 000 other label rows of many teams — the documents table the IN lookup reads.
	rows := make([]document_service_models.Document, 0, others+labels)
	for i := range others {
		team := strconv.Itoa(i % 400)
		rows = append(rows, document_service_models.Document{
			ID: "other-" + strconv.Itoa(i), TeamID: uint64(5_000 + i%400), ResourceType: "order_receipt",
			ObjectKey: "assets/teams/" + team + "/other-" + strconv.Itoa(i) + ".pdf", MimeType: "application/pdf",
			SizeBytes: 50_000, Filename: "resi.pdf", Status: "active",
		})
	}

	inBytes := 0

	for i := range labels {
		id := "perf-label-" + strconv.Itoa(i)
		key := "assets/teams/" + strconv.FormatUint(seller, 10) + "/" + id + ".pdf"

		content, readErr := os.ReadFile(samples[i%len(samples)])
		if readErr != nil {
			t.Fatal(readErr)
		}

		inBytes += len(content)

		err = docstore.NewLocalStore(cfg).Put(key, bytes.NewReader(content))
		if err != nil {
			t.Fatal(err)
		}

		rows = append(rows, document_service_models.Document{
			ID: id, TeamID: seller, ResourceType: "order_receipt", ObjectKey: key, MimeType: "application/pdf",
			SizeBytes: int64(len(content)), Filename: filepath.Base(samples[i%len(samples)]), Status: "active",
		})
	}

	san_perf.SeedRows(t, db, rows)

	shop := selling_service_models.Shop{TeamID: seller, Name: "Toko Perf", ShopCode: "LBL-PERF", Marketplace: "shopee"}

	err = db.Create(&shop).Error
	if err != nil {
		t.Fatal(err)
	}

	ids := make([]uint64, 0, labels)

	for i := range labels {
		order := selling_service_models.Order{
			IdempotencyKey: newOrderKey(), TeamID: seller, ShopID: shop.ID, WarehouseID: warehouse, Status: "processed",
			Address:           &selling_service_models.OrderAddress{CustomerName: "Budi"},
			ReceiptDocumentID: "perf-label-" + strconv.Itoa(i),
		}

		err = db.Create(&order).Error
		if err != nil {
			t.Fatal(err)
		}

		ids = append(ids, order.ID)
	}

	call := func() error {
		res, callErr := svc.OrderLabels(ctx, connect.NewRequest(&sellingv1.OrderLabelsRequest{TeamId: warehouse, OrderIds: ids}))
		if callErr == nil {
			for _, result := range res.Msg.GetResults() {
				if !result.GetIncluded() {
					t.Fatalf("order %d refused: %v", result.GetOrderId(), result.GetReason())
				}
			}
		}

		return callErr
	}

	err = call()
	if err != nil {
		t.Fatalf("warm-up: %v", err)
	}

	walls := make([]time.Duration, 0, 5)

	for range 5 {
		probe.Reset()

		wall, dbTime := probe.Measure(func() { err = call() })
		if err != nil {
			t.Fatal(err)
		}

		walls = append(walls, wall)
		t.Logf("OrderLabels %d merged: wall=%v db=%v queries=%d", labels, wall, dbTime, probe.Count())
	}

	t.Logf("OrderLabels %d merged (%.1f KB of labels): MEDIAN wall %v", labels, float64(inBytes)/1024, san_perf.Median(walls))

	for _, q := range probe.Queries() {
		if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
			continue
		}

		t.Log(san_perf.Explain(t, db, q.SQL))
	}
}
