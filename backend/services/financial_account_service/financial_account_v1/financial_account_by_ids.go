package financial_account_v1

import (
	"context"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// FinancialAccountByIds resolves accounts a caller already holds the id of — a restock names which account
// paid. ARCHIVED ACCOUNTS ARE RETURNED, so an old row still names its account. Another team's id, or one
// that never existed, is simply absent. No balance, as on the list.
func (s *Service) FinancialAccountByIds(
	ctx context.Context,
	req *connect.Request[financial_accountv1.FinancialAccountByIdsRequest],
) (*connect.Response[financial_accountv1.FinancialAccountByIdsResponse], error) {
	msg := req.Msg
	db := s.db.WithContext(ctx)

	rows := []m.FinancialAccount{}

	err := db.Where("team_id = ? AND id IN ?", msg.GetTeamId(), msg.GetFilter().GetIds()).Find(&rows).Error
	if err != nil {
		return nil, dbError(err)
	}

	wants := sliceWants{}
	for _, r := range msg.GetDataRequest() {
		switch r {
		case financial_accountv1.FinancialAccountByIdsDataType_FINANCIAL_ACCOUNT_BY_IDS_DATA_TYPE_GENERAL:
			wants.general = true
		case financial_accountv1.FinancialAccountByIdsDataType_FINANCIAL_ACCOUNT_BY_IDS_DATA_TYPE_ACCOUNT:
			wants.account = true
		}
	}

	if !wants.general && !wants.account {
		wants.account = true
	}

	slices, err := accountSlices(db, rows, wants)
	if err != nil {
		return nil, err
	}

	// Keyed per id: each id gets the slices narrowed to its own row, so a caller looks one id up directly.
	items := map[uint64]*financial_accountv1.FinancialAccountByIdsResponseList{}

	for _, r := range rows {
		list := &financial_accountv1.FinancialAccountByIdsResponseList{}

		for _, slice := range slices {
			switch d := slice.(type) {
			case *commonv1.GeneralMapItem:
				list.Items = append(list.Items, &financial_accountv1.FinancialAccountByIdsResponseItem{
					D: &financial_accountv1.FinancialAccountByIdsResponseItem_General{
						General: &commonv1.GeneralMapItem{MapData: map[uint64]*commonv1.GeneralItem{r.ID: d.MapData[r.ID]}},
					},
				})
			case *financial_accountv1.FinancialAccountRowMapItem:
				list.Items = append(list.Items, &financial_accountv1.FinancialAccountByIdsResponseItem{
					D: &financial_accountv1.FinancialAccountByIdsResponseItem_Account{
						Account: &financial_accountv1.FinancialAccountRowMapItem{
							MapData: map[uint64]*financial_accountv1.FinancialAccount{r.ID: d.MapData[r.ID]},
						},
					},
				})
			}
		}

		items[r.ID] = list
	}

	return connect.NewResponse(&financial_accountv1.FinancialAccountByIdsResponse{Items: items}), nil
}
