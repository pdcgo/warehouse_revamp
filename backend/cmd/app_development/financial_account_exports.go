package main

import (
	"context"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1/documentv1connect"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// ── the account report's export — the file, and the shop names its rows need (a-report-export-is-the-whole-view-as-a-file) ──

// financialAccountExports is financial_account's ExportStore, on the supplier tabs' store: the file goes to
// document_service through the same two-phase upload, AS THE CALLER, as a private TABLE_EXPORT document behind an
// expiring link carrying its name. The SHOPS an account is shown by are named by selling's ShopByIds, over the shop
// client that forwards the caller's token (NewShopClient) — the same client the account's ShopChecker asks.
type financialAccountExports struct {
	documents documentv1connect.DocumentServiceClient
	http      *internalHTTPClient
	shops     sellingv1connect.ShopServiceClient
}

func NewFinancialAccountExportStore(
	client *internalHTTPClient,
	documents documentv1connect.DocumentServiceClient,
	shops sellingv1connect.ShopServiceClient,
) financial_account_v1.ExportStore {
	return &financialAccountExports{documents: documents, http: client, shops: shops}
}

// Store uploads the file as a TABLE_EXPORT and returns its expiring signed link.
func (a *financialAccountExports) Store(ctx context.Context, teamID uint64, filename string, content []byte) (string, error) {
	return storeTableExport(ctx, a.documents, a.http, teamID, filename, content)
}

// ShopNames is ShopByIds' BASIC slice — any signed-in caller may name a shop by id; the export asks only for the shops
// its own team's accounts name. At most 200 ids, as ShopByIds takes.
func (a *financialAccountExports) ShopNames(ctx context.Context, ids []uint64) (map[uint64]string, error) {
	out := map[uint64]string{}
	if len(ids) == 0 {
		return out, nil
	}

	res, err := a.shops.ShopByIds(ctx, connect.NewRequest(&sellingv1.ShopByIdsRequest{
		Filter:      &sellingv1.ShopByIdsFilter{Ids: ids},
		DataRequest: []sellingv1.ShopByIdsDataType{sellingv1.ShopByIdsDataType_SHOP_BY_IDS_DATA_TYPE_BASIC},
	}))
	if err != nil {
		return nil, err
	}

	for id, list := range res.Msg.GetItems() {
		for _, item := range list.GetItems() {
			shop := item.GetBasic().GetMapData()[id]
			if shop != nil && shop.GetName() != "" {
				out[id] = shop.GetName()
			}
		}
	}

	return out, nil
}
