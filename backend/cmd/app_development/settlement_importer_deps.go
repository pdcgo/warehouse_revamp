package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"

	"connectrpc.com/connect"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1/documentv1connect"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1/settlementv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	settlement_importer_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_v1"
)

// THE SETTLEMENT IMPORTER's four dependencies, each a Connect client under the UPLOADER's own token
// (san_auth.ForwardBearer) — so every call it makes is authorized as the person who uploaded, and every
// row it posts is theirs. The importer declares the interfaces; these adapters are the whole dependency
// between it and the four services, and where a service moves — the shop to its own service
// (the-shop-gets-its-own-service) — only its adapter changes.

// NewOrderClient is selling's OrderService, as another service calls it.
func NewOrderClient(cfg *Config, client *internalHTTPClient) sellingv1connect.OrderServiceClient {
	return sellingv1connect.NewOrderServiceClient(client, cfg.InternalBaseURL,
		connect.WithInterceptors(san_auth.ForwardBearer()))
}

// NewDocumentClient is document_service, as another service calls it.
func NewDocumentClient(cfg *Config, client *internalHTTPClient) documentv1connect.DocumentServiceClient {
	return documentv1connect.NewDocumentServiceClient(client, cfg.InternalBaseURL,
		connect.WithInterceptors(san_auth.ForwardBearer()))
}

// NewSettlementWriteClient is SettlementPost, as another service calls it.
func NewSettlementWriteClient(cfg *Config, client *internalHTTPClient) settlementv1connect.SettlementWriteServiceClient {
	return settlementv1connect.NewSettlementWriteServiceClient(client, cfg.InternalBaseURL,
		connect.WithInterceptors(san_auth.ForwardBearer()))
}

// ── the shop — ShopAccessCheck ──────────────────────────────────────────────────────────────────────

type importerShops struct {
	shops sellingv1connect.ShopServiceClient
}

func NewImporterShopChecker(shops sellingv1connect.ShopServiceClient) settlement_importer_v1.ShopChecker {
	return &importerShops{shops: shops}
}

func (a *importerShops) CheckShop(ctx context.Context, teamID, shopID, userID uint64) (settlement_importer_v1.ShopCheck, error) {
	resp, err := a.shops.ShopAccessCheck(ctx, connect.NewRequest(&sellingv1.ShopAccessCheckRequest{
		TeamId: teamID,
		ShopId: shopID,
		UserId: userID,
	}))
	if err != nil {
		return settlement_importer_v1.ShopCheck{}, err
	}

	shop := resp.Msg.GetShop()

	return settlement_importer_v1.ShopCheck{
		ID:            shop.GetId(),
		Name:          shop.GetName(),
		Marketplace:   shop.GetMarketplace(),
		PrimaryUserID: resp.Msg.GetPrimaryUserId(),
		HasAccess:     resp.Msg.GetIsHaveAccess(),
	}, nil
}

// ── orders — OrderByExternalRefs ────────────────────────────────────────────────────────────────────

// orderRefBatch is the RPC's max_items — a statement with more distinct refs asks in batches.
const orderRefBatch = 2000

type importerOrders struct {
	orders sellingv1connect.OrderServiceClient
}

func NewImporterOrderFinder(orders sellingv1connect.OrderServiceClient) settlement_importer_v1.OrderFinder {
	return &importerOrders{orders: orders}
}

func (a *importerOrders) OrdersByRefs(ctx context.Context, teamID uint64, refs []string) (map[string][]settlement_importer_v1.OrderRef, error) {
	out := map[string][]settlement_importer_v1.OrderRef{}

	for start := 0; start < len(refs); start += orderRefBatch {
		end := min(start+orderRefBatch, len(refs))

		resp, err := a.orders.OrderByExternalRefs(ctx, connect.NewRequest(&sellingv1.OrderByExternalRefsRequest{
			TeamId: teamID,
			Filter: &sellingv1.OrderByExternalRefsFilter{Refs: refs[start:end]},
		}))
		if err != nil {
			return nil, err
		}

		for ref, list := range resp.Msg.GetItems() {
			for _, item := range list.GetItems() {
				for _, order := range item.GetOrderRef().GetMapData() {
					out[ref] = append(out[ref], settlement_importer_v1.OrderRef{
						OrderID:         order.GetOrderId(),
						ShopID:          order.GetShopId(),
						CreatedByUserID: order.GetCreatedByUserId(),
						Cancelled:       order.GetStatus() == sellingv1.OrderStatus_ORDER_STATUS_CANCELLED,
					})
				}
			}
		}
	}

	return out, nil
}

// ── documents — the two-phase upload, as its client ─────────────────────────────────────────────────

// xlsxType is what a statement is stored as.
const xlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

type importerStatements struct {
	documents documentv1connect.DocumentServiceClient
	http      *internalHTTPClient
}

func NewImporterStatementStore(
	documents documentv1connect.DocumentServiceClient,
	client *internalHTTPClient,
) settlement_importer_v1.StatementStore {
	return &importerStatements{documents: documents, http: client}
}

// StoreStatement is RequestUpload → PUT → ConfirmUpload, exactly as a browser runs it — the importer is
// document_service's client, never a second door into its storage.
func (a *importerStatements) StoreStatement(ctx context.Context, teamID uint64, filename string, content []byte) (string, error) {
	upload, err := a.documents.RequestUpload(ctx, connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId:       teamID,
		ResourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_SETTLEMENT_STATEMENT,
		ContentType:  xlsxType,
		SizeBytes:    int64(len(content)),
		Filename:     filename,
	}))
	if err != nil {
		return "", err
	}

	put, err := http.NewRequestWithContext(ctx, upload.Msg.GetMethod(), upload.Msg.GetUploadUrl(), bytes.NewReader(content))
	if err != nil {
		return "", err
	}

	for name, value := range upload.Msg.GetHeaders() {
		put.Header.Set(name, value)
	}

	resp, err := a.http.Do(put)
	if err != nil {
		return "", fmt.Errorf("uploading the statement: %w", err)
	}

	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()

	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("uploading the statement: the store answered %s", resp.Status)
	}

	confirmed, err := a.documents.ConfirmUpload(ctx, connect.NewRequest(&documentv1.ConfirmUploadRequest{
		UploadToken: upload.Msg.GetUploadToken(),
	}))
	if err != nil {
		return "", err
	}

	return confirmed.Msg.GetDocument().GetId(), nil
}

// ── the ledger — SettlementPost, source importer ────────────────────────────────────────────────────

type importerLedger struct {
	settlement settlementv1connect.SettlementWriteServiceClient
}

func NewImporterLedger(settlement settlementv1connect.SettlementWriteServiceClient) settlement_importer_v1.Ledger {
	return &importerLedger{settlement: settlement}
}

func (a *importerLedger) Post(ctx context.Context, post settlement_importer_v1.LedgerPost) (settlement_importer_v1.LedgerResult, error) {
	resp, err := a.settlement.SettlementPost(ctx, connect.NewRequest(&settlementv1.SettlementPostRequest{
		TeamId:          post.TeamID,
		OrderId:         post.OrderID,
		ShopId:          post.ShopID,
		UniqueId:        post.UniqueID,
		SettlementType:  post.SettlementType,
		SourceType:      settlementv1.SourceType_SOURCE_TYPE_IMPORTER,
		Change:          post.Change,
		OccurredOn:      post.OccurredOn,
		Note:            post.Note,
		CreatedByUserId: post.CreatedByUserID,
	}))
	if err != nil {
		return settlement_importer_v1.LedgerResult{}, err
	}

	return settlement_importer_v1.LedgerResult{
		LogID:   resp.Msg.GetEntry().GetId(),
		Created: resp.Msg.GetCreated(),
	}, nil
}
