package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/order_import_readers"
)

// TiktokOrderImport reads one TikTok shop's order export and moves each order it names along customer service's moves
// after handover (the-import-moves-only-after-handover). Same stream, same shape as Shopee's; only the reader differs.
func (s *Service) TiktokOrderImport(
	ctx context.Context,
	req *connect.Request[sellingv1.TiktokOrderImportRequest],
	stream *connect.ServerStream[sellingv1.TiktokOrderImportResponse],
) error {
	logger := newOrderImportLogger(func(m orderImportMessage) error {
		return stream.Send(&sellingv1.TiktokOrderImportResponse{
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
		platform: san_marketplace.Tiktok,
		label:    "TikTok",
		read:     order_import_readers.ReadTiktok,
		content:  req.Msg.GetFileContent(),
	}, logger)
}
