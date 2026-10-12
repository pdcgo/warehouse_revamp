package settlement_importer_v1

import (
	"context"

	"connectrpc.com/connect"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
)

// ShopeeSettlementImport imports a Shopee "Transaction Report" — its Rincian Transaksi — as one streamed
// call. Same stream, same shape as TikTok's; only the reader differs.
func (s *Service) ShopeeSettlementImport(
	ctx context.Context,
	req *connect.Request[settlement_importerv1.ShopeeSettlementImportRequest],
	stream *connect.ServerStream[settlement_importerv1.ShopeeSettlementImportResponse],
) error {
	sink := newStreamSink(func(p progress) error {
		return stream.Send(&settlement_importerv1.ShopeeSettlementImportResponse{
			Level:   p.level,
			Message: p.message,
			Step:    p.step,
			Count:   p.count,
			File:    p.file,
		})
	})

	return s.importStatement(ctx, importRequest{
		teamID:   req.Msg.GetTeamId(),
		shopID:   req.Msg.GetShopId(),
		content:  req.Msg.GetFileContent(),
		platform: marketplacev1.Marketplace_MARKETPLACE_SHOPEE,
		read:     readShopee,
	}, sink)
}
