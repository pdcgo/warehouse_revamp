package main

import (
	"context"

	"connectrpc.com/connect"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1/documentv1connect"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// ── a supplier tab's export — the file, and the names its rows need (each-supplier-tab-exports-its-own-table) ──────

// supplierExports is supplier_service's ExportStore, on OrderExport's store (one-export-is-the-list-as-a-file): the file
// goes to document_service through the same two-phase upload, AS THE CALLER (the client forwards their token), as a
// private TABLE_EXPORT document behind an expiring link carrying its name; the teams are named by the same forwarding
// team_service read. The PRODUCTS are named in-process from product_service's own handler, as productCatalog does —
// the export's policy already ran at its door, and ProductByIds names any team's product by id.
type supplierExports struct {
	documents documentv1connect.DocumentServiceClient
	http      *internalHTTPClient
	teams     teamv1connect.TeamServiceClient
	products  *product_v1.Service
}

func NewSupplierExportStore(
	cfg *Config,
	client *internalHTTPClient,
	documents documentv1connect.DocumentServiceClient,
	products *product_v1.Service,
) supplier_v1.ExportStore {
	return &supplierExports{
		documents: documents,
		http:      client,
		teams:     teamv1connect.NewTeamServiceClient(client, cfg.InternalBaseURL, connect.WithInterceptors(san_auth.ForwardBearer())),
		products:  products,
	}
}

// Store uploads the file as a TABLE_EXPORT and returns its expiring signed link.
func (a *supplierExports) Store(ctx context.Context, teamID uint64, filename string, content []byte) (string, error) {
	return storeTableExport(ctx, a.documents, a.http, teamID, filename, content)
}

// TeamNames is OrderExport's team naming — TeamByIds as the caller.
func (a *supplierExports) TeamNames(ctx context.Context, ids []uint64) (map[uint64]string, error) {
	return (&orderExports{teams: a.teams}).TeamNames(ctx, ids)
}

func (a *supplierExports) ProductNames(ctx context.Context, teamID uint64, ids []uint64) (map[uint64]supplier_v1.ExportProduct, error) {
	out := map[uint64]supplier_v1.ExportProduct{}
	if len(ids) == 0 {
		return out, nil
	}

	res, err := a.products.ProductByIds(ctx, connect.NewRequest(&productv1.ProductByIdsRequest{
		TeamId:      teamID,
		Filter:      &productv1.ProductByIdsFilter{Ids: ids},
		DataRequest: []productv1.ProductByIdsDataType{productv1.ProductByIdsDataType_PRODUCT_BY_IDS_DATA_TYPE_PRODUCT},
	}))
	if err != nil {
		return nil, err
	}

	for id, list := range res.Msg.GetItems() {
		for _, item := range list.GetItems() {
			row := item.GetProduct().GetMapData()[id]
			if row == nil {
				continue
			}

			out[id] = supplier_v1.ExportProduct{Name: row.GetName(), Code: row.GetProductCode(), TeamID: row.GetTeamId()}
		}
	}

	return out, nil
}

// storeTableExport is the two-phase upload of a screen table's file as a private TABLE_EXPORT, then its expiring link —
// OrderExport's Store with the table's own resource type.
func storeTableExport(
	ctx context.Context,
	documents documentv1connect.DocumentServiceClient,
	client *internalHTTPClient,
	teamID uint64,
	filename string,
	content []byte,
) (string, error) {
	documentID, err := uploadDocument(ctx, documents, client, documentUpload{
		teamID:       teamID,
		resourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_TABLE_EXPORT,
		contentType:  xlsxType,
		filename:     filename,
		content:      content,
	})
	if err != nil {
		return "", err
	}

	link, err := documents.GetDownloadUrl(ctx, connect.NewRequest(&documentv1.GetDownloadUrlRequest{
		TeamId:     teamID,
		DocumentId: documentID,
	}))
	if err != nil {
		return "", err
	}

	return link.Msg.GetUrl(), nil
}
