package financial_account_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// FinancialAccountList is the team's accounts — name, provider, number, holder, status. NO BALANCE: balances
// are FinancialAccountOverview's, so who sees them can narrow later without touching this
// (seeing-is-team-wide-moving-is-admin-and-up).
//
// Active only unless asked — every picker reads this, and an archived account is out of every picker.
// Default order: active before archived, then by name, case-blind.
func (s *Service) FinancialAccountList(
	ctx context.Context,
	req *connect.Request[financial_accountv1.FinancialAccountListRequest],
) (*connect.Response[financial_accountv1.FinancialAccountListResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()
	db := s.db.WithContext(ctx)

	query := db.Model(&m.FinancialAccount{}).Where("financial_accounts.team_id = ?", msg.GetTeamId())

	if !filter.GetIncludeArchived() {
		query = query.Where("financial_accounts.status = ?", m.StatusActive)
	}

	if filter.GetOperationalOnly() {
		query = query.Where("EXISTS (SELECT 1 FROM operational_accounts o WHERE o.account_id = financial_accounts.id)")
	}

	if len(filter.GetTypes()) > 0 {
		types := make([]string, 0, len(filter.GetTypes()))
		for _, t := range filter.GetTypes() {
			types = append(types, typeText[t])
		}

		query = query.Where("financial_accounts.type IN ?", types)
	}

	if filter.GetShopId() != 0 {
		query = query.Where("EXISTS (SELECT 1 FROM shop_accounts sa WHERE sa.account_id = financial_accounts.id AND sa.shop_id = ?)", filter.GetShopId())
	}

	q := strings.TrimSpace(filter.GetQ())
	if q != "" {
		like := "%" + strings.ToLower(q) + "%"
		query = query.Where(
			"(lower(financial_accounts.name) LIKE ? OR lower(financial_accounts.holder_name) LIKE ? OR financial_accounts.account_number LIKE ?)",
			like, like, like,
		)
	}

	var total int64

	err := query.Session(&gorm.Session{}).Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	limit, offset := pageWindow(msg.GetPage().GetPage(), msg.GetPage().GetLimit())

	rows := []m.FinancialAccount{}

	err = query.Order(listOrder(msg.GetSort())).Limit(limit).Offset(offset).Find(&rows).Error
	if err != nil {
		return nil, dbError(err)
	}

	ids := make([]uint64, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}

	items, err := accountSlices(db, rows, listWants(msg.GetDataRequest()))
	if err != nil {
		return nil, err
	}

	out := make([]*financial_accountv1.FinancialAccountListResponseItem, 0, len(items))
	for _, item := range items {
		switch d := item.(type) {
		case *commonv1.GeneralMapItem:
			out = append(out, &financial_accountv1.FinancialAccountListResponseItem{
				D: &financial_accountv1.FinancialAccountListResponseItem_General{General: d},
			})
		case *financial_accountv1.FinancialAccountRowMapItem:
			out = append(out, &financial_accountv1.FinancialAccountListResponseItem{
				D: &financial_accountv1.FinancialAccountListResponseItem_Account{Account: d},
			})
		}
	}

	return connect.NewResponse(&financial_accountv1.FinancialAccountListResponse{
		Items: out,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: max(msg.GetPage().GetPage(), 1),
			TotalPage:   totalPages(total, uint32(limit)),
			TotalItems:  uint64(total),
		},
	}), nil
}

// listOrder is the requested sort, with id as the tie-break so a page never shuffles.
func listOrder(sort *financial_accountv1.FinancialAccountListFilterSort) string {
	direction := "ASC"
	if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_DESC {
		direction = "DESC"
	}

	switch s := sort.GetS().(type) {
	case *financial_accountv1.FinancialAccountListFilterSort_General:
		if s.General == commonv1.GeneralSort_GENERAL_SORT_NAME {
			return "lower(financial_accounts.name) " + direction + ", financial_accounts.id"
		}
	case *financial_accountv1.FinancialAccountListFilterSort_Account:
		switch s.Account {
		case financial_accountv1.FinancialAccountRowSort_FINANCIAL_ACCOUNT_ROW_SORT_NAME:
			return "lower(financial_accounts.name) " + direction + ", financial_accounts.id"
		case financial_accountv1.FinancialAccountRowSort_FINANCIAL_ACCOUNT_ROW_SORT_PROVIDER:
			return "financial_accounts.provider " + direction + ", lower(financial_accounts.name), financial_accounts.id"
		case financial_accountv1.FinancialAccountRowSort_FINANCIAL_ACCOUNT_ROW_SORT_CREATED_AT:
			return "financial_accounts.created_at " + direction + ", financial_accounts.id"
		}
	}

	// The default: active before archived ('active' < 'archived'), then by name.
	return "financial_accounts.status, lower(financial_accounts.name), financial_accounts.id"
}

// sliceWants is which of the two slices a caller asked for. Neither asked defaults to the ACCOUNT slice.
type sliceWants struct {
	general bool
	account bool
}

func listWants(requested []financial_accountv1.FinancialAccountListDataType) sliceWants {
	w := sliceWants{}

	for _, r := range requested {
		switch r {
		case financial_accountv1.FinancialAccountListDataType_FINANCIAL_ACCOUNT_LIST_DATA_TYPE_GENERAL:
			w.general = true
		case financial_accountv1.FinancialAccountListDataType_FINANCIAL_ACCOUNT_LIST_DATA_TYPE_ACCOUNT:
			w.account = true
		}
	}

	if !w.general && !w.account {
		w.account = true
	}

	return w
}

// accountSlices builds the columnar slices the caller asked for — a *commonv1.GeneralMapItem and/or a
// *FinancialAccountRowMapItem — shared by List and ByIds.
func accountSlices(db *gorm.DB, rows []m.FinancialAccount, wants sliceWants) ([]any, error) {
	out := []any{}

	if wants.general {
		general := &commonv1.GeneralMapItem{MapData: map[uint64]*commonv1.GeneralItem{}}
		for _, r := range rows {
			general.MapData[r.ID] = &commonv1.GeneralItem{Id: r.ID, Name: r.Name}
		}

		out = append(out, general)
	}

	if wants.account {
		ids := make([]uint64, 0, len(rows))
		for _, r := range rows {
			ids = append(ids, r.ID)
		}

		extras, err := extrasOf(db, ids)
		if err != nil {
			return nil, err
		}

		accounts := &financial_accountv1.FinancialAccountRowMapItem{MapData: map[uint64]*financial_accountv1.FinancialAccount{}}
		for _, r := range rows {
			accounts.MapData[r.ID] = accountToProto(r, extras[r.ID])
		}

		out = append(out, accounts)
	}

	return out, nil
}
