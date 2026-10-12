package settlement_importer_v1

import (
	"context"

	"connectrpc.com/connect"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
)

// TiktokSettlementImport imports a TikTok settlement export — its Order details and Withdrawal records —
// as one streamed call (the-import-is-one-streamed-call). The access interceptor has already checked the
// request's team (a-server-stream-is-authorized-on-its-request); the team is read off the request, since
// a stream's ctx carries no scope.
func (s *Service) TiktokSettlementImport(
	ctx context.Context,
	req *connect.Request[settlement_importerv1.TiktokSettlementImportRequest],
	stream *connect.ServerStream[settlement_importerv1.TiktokSettlementImportResponse],
) error {
	sink := newStreamSink(func(p progress) error {
		return stream.Send(&settlement_importerv1.TiktokSettlementImportResponse{
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
		platform: marketplacev1.Marketplace_MARKETPLACE_TIKTOK,
		read:     readTiktok,
	}, sink)
}
