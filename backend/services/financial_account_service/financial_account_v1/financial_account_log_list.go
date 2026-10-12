package financial_account_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// FinancialAccountLogList is one account's statement — newest first by default, in ENTRY order, the order
// `balance_after` runs in (the-log-says-balance-after). Filtered by type and by the Jakarta day the money
// moved.
//
// Another team's account is NotFound — the statement is read through its account, so the scope check is the
// account's.
func (s *Service) FinancialAccountLogList(
	ctx context.Context,
	req *connect.Request[financial_accountv1.FinancialAccountLogListRequest],
) (*connect.Response[financial_accountv1.FinancialAccountLogListResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()
	db := s.db.WithContext(ctx)

	var account m.FinancialAccount

	err := db.Select("id").Where("id = ? AND team_id = ?", filter.GetAccountId(), msg.GetTeamId()).Take(&account).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errAccountNotFound
	}

	if err != nil {
		return nil, dbError(err)
	}

	query := db.Model(&m.FinancialAccountLog{}).Where("account_id = ?", account.ID)

	if len(filter.GetChangeTypes()) > 0 {
		types := make([]string, 0, len(filter.GetChangeTypes()))
		for _, t := range filter.GetChangeTypes() {
			types = append(types, changeTypeText[t])
		}

		query = query.Where("change_type IN ?", types)
	}

	// A day is a Jakarta day: from its 00:00 WIB to the next day's.
	if filter.GetOccurredFrom() != "" {
		from, err := time.ParseInLocation(dateLayout, filter.GetOccurredFrom(), jakarta)
		if err != nil {
			return nil, errBadDay
		}

		query = query.Where("occurred_at >= ?", from)
	}

	if filter.GetOccurredTo() != "" {
		to, err := time.ParseInLocation(dateLayout, filter.GetOccurredTo(), jakarta)
		if err != nil {
			return nil, errBadDay
		}

		query = query.Where("occurred_at < ?", to.AddDate(0, 0, 1))
	}

	var total int64

	err = query.Session(&gorm.Session{}).Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	limit, offset := pageWindow(msg.GetPage().GetPage(), msg.GetPage().GetLimit())

	rows := []m.FinancialAccountLog{}

	err = query.Order(logOrder(msg.GetSort())).Limit(limit).Offset(offset).Find(&rows).Error
	if err != nil {
		return nil, dbError(err)
	}

	ids := make([]uint64, 0, len(rows))
	logs := &financial_accountv1.FinancialAccountLogMapItem{MapData: map[uint64]*financial_accountv1.FinancialAccountLog{}}

	for _, r := range rows {
		ids = append(ids, r.ID)
		logs.MapData[r.ID] = logToProto(r)
	}

	return connect.NewResponse(&financial_accountv1.FinancialAccountLogListResponse{
		Items: []*financial_accountv1.FinancialAccountLogListResponseItem{
			{D: &financial_accountv1.FinancialAccountLogListResponseItem_Log{Log: logs}},
		},
		Ids: ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: max(msg.GetPage().GetPage(), 1),
			TotalPage:   totalPages(total, uint32(limit)),
			TotalItems:  uint64(total),
		},
	}), nil
}

// logOrder — entry order, newest first, unless asked otherwise.
func logOrder(sort *financial_accountv1.FinancialAccountLogListFilterSort) string {
	direction := "DESC"
	if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_ASC {
		direction = "ASC"
	}

	if sort.GetLog() == financial_accountv1.FinancialAccountLogSort_FINANCIAL_ACCOUNT_LOG_SORT_OCCURRED_AT {
		return "occurred_at " + direction + ", id " + direction
	}

	return "id " + direction
}
