package supplier_v1

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_export"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// channelExportColumns are the Toko tab's columns, as the screen heads them (the-detail-tabs-show-sold-and-ready):
// the store in two cells — its name, then its type, the badge under the name on screen — and each figure beside the
// date under it. The row's actions are not data and stay out.
var channelExportColumns = []string{
	"Toko pemasok", "Jenis toko", "Tautan", "Deskripsi", "Terjual", "Pesanan terakhir", "Siap", "Restok terakhir",
}

// SupplierChannelExport writes the Toko tab as a file (each-supplier-tab-exports-its-own-table, on
// one-export-is-the-list-as-a-file): exactly the stores SupplierChannelList holds with this filter and order —
// channelListQuery, the same set — every page of them, Terjual and Siap with their dates beside each, as .xlsx. A server
// stream: every step a message with the progress, the link on the last.
//
// The figures are inventory's, per store (GoodsReader.StoreGoods — EVERY team's goods, every-selling-team-sees-every-
// teams-figures), read once: a supplier has few stores. A store none of whose goods arrived reads empty cells, as the
// tab's dash. The Gudang terkait chip narrows no tab yet (a-supplier-page-is-scoped-by-its-warehouses, ⚠ dropped), so
// the file — the tab — is not narrowed by it either.
func (s *Service) SupplierChannelExport(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierChannelExportRequest],
	stream *connect.ServerStream[supplierv1.SupplierChannelExportResponse],
) error {
	if s.exports == nil {
		return connect.NewError(connect.CodeUnimplemented, errNoExportStore)
	}

	msg := req.Msg
	filter := msg.GetFilter()
	db := s.db.WithContext(ctx)

	// A deleted or unknown supplier is NotFound, as the list answers it.
	_, err := liveSupplier(db, filter.GetSupplierId())
	if err != nil {
		return err
	}

	progress := san_export.NewProgress(func(message string, done, total int64) error {
		return stream.Send(&supplierv1.SupplierChannelExportResponse{Message: message, Done: done, Total: total})
	})

	err = channelListQuery(db, filter).Count(&progress.Total).Error
	if err != nil {
		return internal(err)
	}

	progress.Info("exporting supplier stores", "rows", progress.Total)

	goods, err := s.goods.StoreGoods(ctx, filter.GetSupplierId())
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("reading the stores' figures: %w", err))
	}

	book, err := san_export.NewWorkbook()
	if err != nil {
		return internal(err)
	}
	defer book.Close()

	sheet, err := book.Sheet("Toko", channelExportColumns)
	if err != nil {
		return internal(err)
	}

	order := channelOrderClause(msg.GetSort())

	// The list's own order, a step of rows at a time: the same pages the tab turns through, end to end.
	for offset := 0; ; offset += san_export.Batch {
		var channels []supplier_service_models.SupplierChannel

		err = channelListQuery(db, filter).
			Order(order).
			Offset(offset).
			Limit(san_export.Batch).
			Find(&channels).
			Error
		if err != nil {
			return internal(err)
		}

		if len(channels) == 0 {
			break
		}

		for i := range channels {
			err = sheet.Row(channelExportRow(&channels[i], goods)...)
			if err != nil {
				return internal(fmt.Errorf("writing the file: %w", err))
			}
		}

		progress.Done += int64(len(channels))
		progress.Info("rows written", "done", progress.Done, "of", progress.Total)

		err = progress.Err()
		if err != nil {
			return err
		}

		if len(channels) < san_export.Batch {
			break
		}
	}

	content, err := book.Bytes()
	if err != nil {
		return internal(fmt.Errorf("writing the file: %w", err))
	}

	filename := san_export.Filename("toko-pemasok", time.Now())

	url, err := s.exports.Store(ctx, msg.GetTeamId(), filename, content)
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("storing the file: %w", err))
	}

	return stream.Send(&supplierv1.SupplierChannelExportResponse{
		Message:     "the file is ready",
		Done:        progress.Done,
		Total:       progress.Total,
		DownloadUrl: url,
		Filename:    filename,
	})
}

// channelExportRow is one store, as its tab row reads: text cells for what it is, the units as numbers, each date the
// Jakarta day under its figure on screen — empty where the screen draws a dash or no date.
func channelExportRow(ch *supplier_service_models.SupplierChannel, goods map[uint64]StoreGoods) []any {
	row := []any{ch.Name, marketplaceLabel(san_marketplace.FromText(ch.ChannelType)), ch.URI, ch.Description}

	figures, found := goods[ch.ID]
	if !found {
		return append(row, "", "", "", "")
	}

	return append(row,
		figures.Sold,
		san_export.DayOfUnix(figures.LastOrderUnix),
		figures.Ready,
		san_export.DayOfUnix(figures.LastRestockUnix),
	)
}

// marketplaceLabel is the store type's badge text, as the screen prints it (MarketplaceBadge's marketplaceLabel).
func marketplaceLabel(m marketplacev1.Marketplace) string {
	switch m {
	case marketplacev1.Marketplace_MARKETPLACE_SHOPEE:
		return "Shopee"
	case marketplacev1.Marketplace_MARKETPLACE_TOKOPEDIA:
		return "Tokopedia"
	case marketplacev1.Marketplace_MARKETPLACE_LAZADA:
		return "Lazada"
	case marketplacev1.Marketplace_MARKETPLACE_TIKTOK:
		return "TikTok"
	case marketplacev1.Marketplace_MARKETPLACE_BLIBLI:
		return "Blibli"
	case marketplacev1.Marketplace_MARKETPLACE_BUKALAPAK:
		return "Bukalapak"
	case marketplacev1.Marketplace_MARKETPLACE_OTHER:
		return "Other"
	default:
		return ""
	}
}
