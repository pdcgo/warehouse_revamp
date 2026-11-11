package settlement_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// ShopSettlementEntryList implements [settlementv1connect.SettlementServiceHandler] — Shop Entries
// (the-shop-entries-page-is-accepted): the rows addressed to a SHOP and no order (an-entry-names-an-order-or-a-shop),
// which fold into the report like an order's and were listed on no screen.
//
// THE WINDOW IS THE LEARNED DAY — `posted_on`, a DATE the session stamps in Jakarta time
// (posted-on-buckets-the-report) — so the filter compares calendar days, never instants, and a shop's entries add up to
// what the report folded for it. The totals are the WHOLE filtered set, the report's own Received (every row but the
// withdrawals) and Withdrawn (−Σ withdrawals) — the-report-headline-is-position-to-date.
//
// Each row carries what the screen draws beside it: the row that reversed it (a row is reversed once,
// a-shop-entry-reverses-inline — the write is SettlementPost), the statement it came from (asked of the importer,
// StatementSources) and the poster's and uploader's names (UserNames). The root team reads every team's rows, as the
// report's reads do (scopeOf).
func (s *Service) ShopSettlementEntryList(
	ctx context.Context,
	req *connect.Request[settlementv1.ShopSettlementEntryListRequest],
) (*connect.Response[settlementv1.ShopSettlementEntryListResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()

	types := make([]string, 0, len(filter.GetSettlementTypes()))

	for _, kind := range filter.GetSettlementTypes() {
		text, ok := settlementTypeText[kind]
		// The sale and its cancel need an order — never a shop row (the proto refuses them; a direct caller too).
		if !ok || isInitialType(text) {
			return nil, connect.NewError(connect.CodeInvalidArgument, errUnknownType)
		}

		types = append(types, text)
	}

	// A fresh statement per query: the totals and the page must not share one GORM statement.
	scope := func() *gorm.DB {
		query := s.db.
			WithContext(ctx).
			Model(&settlement_service_models.SettlementLog{}).
			Where("order_id IS NULL")

		if msg.GetTeamId() != san_auth.RootTeamID {
			query = query.Where("team_id = ?", msg.GetTeamId())
		}

		if filter.GetShopId() != 0 {
			query = query.Where("shop_id = ?", filter.GetShopId())
		}

		if len(types) > 0 {
			query = query.Where("settlement_type IN ?", types)
		}

		if raw := filter.GetPostedFrom(); raw != "" {
			query = query.Where("posted_on >= ?", raw)
		}

		if raw := filter.GetPostedTo(); raw != "" {
			query = query.Where("posted_on <= ?", raw)
		}

		return query
	}

	for _, raw := range []string{filter.GetPostedFrom(), filter.GetPostedTo()} {
		if raw == "" {
			continue
		}

		_, err := parseDate(raw)
		if err != nil {
			return nil, err
		}
	}

	// ONE PASS for the three figures over the whole filtered set — never the page.
	var totals struct {
		Entries   int64
		Received  float64
		Withdrawn float64
	}

	err := scope().
		Select(
			"COUNT(*) AS entries, " +
				"COALESCE(SUM(change) FILTER (WHERE settlement_type <> '" + typeWithdrawal + "'), 0) AS received, " +
				"COALESCE(-SUM(change) FILTER (WHERE settlement_type = '" + typeWithdrawal + "'), 0) AS withdrawn",
		).
		Scan(&totals).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	page := msg.GetPage()
	limit := page.GetLimit()
	offset := (page.GetPage() - 1) * limit

	var rows []settlement_service_models.SettlementLog

	if totals.Entries > 0 {
		// Newest learned first; the id breaks a day's ties, so a page never reshuffles.
		err = scope().
			Order("posted_on DESC").
			Order("id DESC").
			Limit(int(limit)).
			Offset(int(offset)).
			Find(&rows).
			Error
		if err != nil {
			return nil, dbError(err)
		}
	}

	entries, err := s.shopEntries(ctx, msg.GetTeamId(), rows)
	if err != nil {
		return nil, err
	}

	ids := make([]uint64, 0, len(rows))
	for i := range rows {
		ids = append(ids, rows[i].ID)
	}

	return connect.NewResponse(&settlementv1.ShopSettlementEntryListResponse{
		// One slice: a caller that asked for nothing still gets the rows, as OrderSettlementList answers.
		Items: []*settlementv1.ShopSettlementEntryListResponseItem{{
			D: &settlementv1.ShopSettlementEntryListResponseItem_Entry{
				Entry: &settlementv1.ShopSettlementEntryMapItem{MapData: entries},
			},
		}},
		Ids: ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(totals.Entries, limit),
			TotalItems:  uint64(totals.Entries),
		},
		TotalReceived:  totals.Received,
		TotalWithdrawn: totals.Withdrawn,
	}), nil
}

// shopEntries dresses a page of rows: who reversed each (one read by `reverses_id`), the statement each came from (one
// ask of the importer) and every name (one ask of the user read).
func (s *Service) shopEntries(
	ctx context.Context,
	teamID uint64,
	rows []settlement_service_models.SettlementLog,
) (map[uint64]*settlementv1.ShopSettlementEntry, error) {
	out := make(map[uint64]*settlementv1.ShopSettlementEntry, len(rows))
	if len(rows) == 0 {
		return out, nil
	}

	ids := make([]uint64, 0, len(rows))
	for i := range rows {
		ids = append(ids, rows[i].ID)
	}

	var reversals []struct {
		ID         uint64
		ReversesID uint64
	}

	err := s.db.
		WithContext(ctx).
		Model(&settlement_service_models.SettlementLog{}).
		Select("id, reverses_id").
		Where("reverses_id IN ?", ids).
		Scan(&reversals).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	reversedBy := make(map[uint64]uint64, len(reversals))
	for _, r := range reversals {
		reversedBy[r.ReversesID] = r.ID
	}

	// Only an imported row has a line to ask about.
	imported := make([]uint64, 0, len(rows))

	for i := range rows {
		if rows[i].SourceType == sourceImporter {
			imported = append(imported, rows[i].ID)
		}
	}

	lines := map[uint64]StatementLine{}

	if len(imported) > 0 {
		lines, err = s.statements.StatementLines(ctx, teamID, imported)
		if err != nil {
			return nil, connect.NewError(connect.CodeUnavailable, err)
		}
	}

	people := map[uint64]bool{}

	for i := range rows {
		people[rows[i].ActorID] = true
	}

	for _, line := range lines {
		people[line.UploadedBy] = true
	}

	delete(people, 0)

	wanted := make([]uint64, 0, len(people))
	for id := range people {
		wanted = append(wanted, id)
	}

	names := map[uint64]string{}

	if len(wanted) > 0 {
		names, err = s.users.UserNames(ctx, wanted)
		if err != nil {
			return nil, connect.NewError(connect.CodeUnavailable, err)
		}
	}

	for i := range rows {
		row := &rows[i]
		entry := &settlementv1.ShopSettlementEntry{
			Entry:        entryToProto(row, names[row.ActorID]),
			ReversedById: reversedBy[row.ID],
		}

		if line, ok := lines[row.ID]; ok {
			entry.Statement = &settlementv1.ShopEntryStatement{
				UploadedFileId:       line.UploadedFileID,
				Platform:             line.Platform,
				PeriodFrom:           line.PeriodFrom,
				PeriodTo:             line.PeriodTo,
				Sheet:                line.Sheet,
				Description:          line.Description,
				OrderRef:             line.OrderRef,
				Reason:               statementReason(line.Reason),
				FoundOrderIds:        line.FoundOrderIDs,
				UploadedByUserId:     line.UploadedBy,
				UploadedByName:       names[line.UploadedBy],
				UploadedByIsOverride: line.UploadedByIsOverride,
			}
		}

		out[row.ID] = entry
	}

	return out, nil
}

// statementReason reads the importer's reason text: a ref that found nothing or several orders, else a line that names
// no order.
func statementReason(text string) settlementv1.ShopEntryStatementReason {
	switch text {
	case "no_order":
		return settlementv1.ShopEntryStatementReason_SHOP_ENTRY_STATEMENT_REASON_NO_ORDER
	case "several_orders":
		return settlementv1.ShopEntryStatementReason_SHOP_ENTRY_STATEMENT_REASON_SEVERAL_ORDERS
	default:
		return settlementv1.ShopEntryStatementReason_SHOP_ENTRY_STATEMENT_REASON_SHOP_LINE
	}
}
