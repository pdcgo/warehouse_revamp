package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/order_import_readers"
)

// ShopeeOrderImport reads one Shopee shop's order export and moves each order it names along customer service's moves
// after handover (the-import-moves-only-after-handover). Same stream, same shape as TikTok's; only the reader differs.
func (s *Service) ShopeeOrderImport(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopeeOrderImportRequest],
	stream *connect.ServerStream[sellingv1.ShopeeOrderImportResponse],
) error {
	logger := newOrderImportLogger(func(m orderImportMessage) error {
		return stream.Send(&sellingv1.ShopeeOrderImportResponse{
			Level:   m.level,
			Message: m.message,
			Step:    m.step,
			Count:   m.count,
			Tally:   m.tally,
		})
	})

	return s.importOrders(ctx, orderImportRun{
		teamID:   req.Msg.GetTeamId(),
		shopID:   req.Msg.GetShopId(),
		platform: san_marketplace.Shopee,
		label:    "Shopee",
		read:     order_import_readers.ReadShopee,
		content:  req.Msg.GetFileContent(),
	}, logger)
}
