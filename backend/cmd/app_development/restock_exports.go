package main

import (
	"context"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1/documentv1connect"
	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// ── the selling restock list's export — the file, and the names its rows need (the-restock-list-exports-and-filters-by-courier) ──

// restockExports is inventory's ExportStore, on the stores the other exports already use: the file goes to
// document_service through the supplier tabs' two-phase upload (storeTableExport), AS THE CALLER, as a private
// TABLE_EXPORT document behind an expiring link carrying its name; the warehouses, couriers and people are named by
// OrderExport's forwarding team, shipment and user clients (orderExports); the lines' suppliers and stores by the
// supplier_service clients inventory already asks whether a supplier is live (SupplierClients) — every read the one the
// screen names its rows with, under the caller's token.
type restockExports struct {
	names     *orderExports
	suppliers SupplierClients
}

func NewRestockExportStore(
	cfg *Config,
	client *internalHTTPClient,
	documents documentv1connect.DocumentServiceClient,
	suppliers SupplierClients,
) inventory_v1.ExportStore {
	return &restockExports{names: newOrderExports(cfg, client, documents), suppliers: suppliers}
}

// Store uploads the file as a TABLE_EXPORT and returns its expiring signed link.
func (a *restockExports) Store(ctx context.Context, teamID uint64, filename string, content []byte) (string, error) {
	return storeTableExport(ctx, a.names.documents, a.names.http, teamID, filename, content)
}

// TeamNames is OrderExport's team naming — TeamByIds as the caller.
func (a *restockExports) TeamNames(ctx context.Context, ids []uint64) (map[uint64]string, error) {
	return a.names.TeamNames(ctx, ids)
}

// UserNames is OrderExport's people naming — UserByIDs as the caller.
func (a *restockExports) UserNames(ctx context.Context, ids []uint64) (map[uint64]string, error) {
	return a.names.UserNames(ctx, ids)
}

// ChannelNames names the couriers by their NAME, as the row's badge reads it — ShipmentChannelByIds, deleted channels
// included (a-deleted-channel-still-resolves-by-id), over OrderExport's shipment client.
func (a *restockExports) ChannelNames(ctx context.Context, ids []uint64) (map[uint64]string, error) {
	out := map[uint64]string{}
	if len(ids) == 0 {
		return out, nil
	}

	resp, err := a.names.shipment.ShipmentChannelByIds(ctx, connect.NewRequest(&shipmentv1.ShipmentChannelByIdsRequest{
		Filter:      &shipmentv1.ShipmentChannelByIdsFilter{Ids: ids},
		DataRequest: []shipmentv1.ShipmentChannelByIdsDataType{shipmentv1.ShipmentChannelByIdsDataType_SHIPMENT_CHANNEL_BY_IDS_DATA_TYPE_CHANNEL},
	}))
	if err != nil {
		return nil, err
	}

	for _, list := range resp.Msg.GetItems() {
		for _, item := range list.GetItems() {
			for id, channel := range item.GetChannel().GetMapData() {
				out[id] = channel.GetName()
			}
		}
	}

	return out, nil
}

// SupplierNames names the lines' suppliers with SupplierByIds — any team's, a deleted one included, as the row's cell
// names them (useSuppliersByIds).
func (a *restockExports) SupplierNames(ctx context.Context, teamID uint64, ids []uint64) (map[uint64]string, error) {
	out := map[uint64]string{}
	if len(ids) == 0 {
		return out, nil
	}

	resp, err := a.suppliers.Suppliers.SupplierByIds(ctx, connect.NewRequest(&supplierv1.SupplierByIdsRequest{
		TeamId: teamID,
		Filter: &supplierv1.SupplierByIdsFilter{Ids: ids},
	}))
	if err != nil {
		return nil, err
	}

	for id, list := range resp.Msg.GetItems() {
		for _, item := range list.GetItems() {
			if supplier := item.GetSupplier().GetMapData()[id]; supplier != nil {
				out[id] = supplier.GetName()
			}
		}
	}

	return out, nil
}

// StoreNames names the lines' stores with SupplierChannelByIds — deleted stores included (useSupplierChannelsByIds).
func (a *restockExports) StoreNames(ctx context.Context, teamID uint64, ids []uint64) (map[uint64]string, error) {
	out := map[uint64]string{}
	if len(ids) == 0 {
		return out, nil
	}

	resp, err := a.suppliers.Channels.SupplierChannelByIds(ctx, connect.NewRequest(&supplierv1.SupplierChannelByIdsRequest{
		TeamId: teamID,
		Ids:    ids,
	}))
	if err != nil {
		return nil, err
	}

	for id, store := range resp.Msg.GetChannels() {
		out[id] = store.GetName()
	}

	return out, nil
}
